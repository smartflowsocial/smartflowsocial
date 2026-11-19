/**
 * Boots the production web server and worker from ./build and publishes
 * signed notes through the internal publisher to a loopback relay.
 *
 * No Cloudflare publisher URL, API token, or cache worker is set.
 * Postgres and Redis must be loopback. The database name must look disposable
 * (`cleanroom`, `test`, or `acceptance`). Port 6379 is refused unless CI or
 * CLEAN_ROOM_REDIS=isolated says this Redis has no other worker.
 *
 *   pnpm build
 *   pnpm test:self-host-acceptance --up
 *
 * `--up` starts docker-compose.clean-room.yml and then overrides DATABASE_URL
 * and REDIS_URL to that stack. Without `--up`, export those URLs yourself.
 */
import "dotenv/config";

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { connect as connectNet, createServer } from "node:net";
import path from "node:path";

import { finalizeEvent, getPublicKey } from "nostr-tools";
import WebSocket from "ws";

import { startEphemeralRelay } from "./ephemeral-relay.mjs";
import {
  databaseNameAccepted,
  redisIsolationProblem,
} from "./self-host-acceptance-guards.mjs";
import { isLoopbackHost } from "./self-host-clean-room.mjs";
import { effectiveCampaignFinalizationFeeRateBps } from "~/features/payments/campaign-fee-policy";
import { readPublicDeployment } from "~/features/payments/entitlements/deployment-mode";
import { parseDatabaseTarget } from "~/lib/test-database-target";

const COMPOSE_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:5434/cleanroom";
const COMPOSE_REDIS_URL = "redis://127.0.0.1:6380";

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(line: string): never {
  throw new Error(line);
}

function redact(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://redacted");
}

function tcpReachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connectNet({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(2000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function signedNote(content: string) {
  const secretKey = randomBytes(32);
  const event = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content,
    },
    secretKey
  );
  return { pubkey: getPublicKey(secretKey), event };
}

function readFromRelay(
  url: string,
  eventId: string
): Promise<{ content?: string } | null> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("timed out reading the event back from the relay"));
    }, 4000);
    socket.on("error", () => undefined);
    socket.on("open", () => {
      socket.send(JSON.stringify(["REQ", "readback", { ids: [eventId] }]));
    });
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as unknown[];
      if (
        message[0] === "EVENT" &&
        message[2] &&
        typeof message[2] === "object"
      ) {
        const event = message[2] as { id?: string; content?: string };
        if (event.id === eventId) {
          clearTimeout(timer);
          socket.close();
          resolve(event);
        }
      }
      if (message[0] === "EOSE") {
        clearTimeout(timer);
        socket.close();
        resolve(null);
      }
    });
  });
}

function attachLogs(child: ChildProcess, bucket: string[]): void {
  const push = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (!line) continue;
      bucket.push(line);
      if (bucket.length > 200) bucket.shift();
    }
  };
  child.stdout?.on("data", push);
  child.stderr?.on("data", push);
}

function startNode(
  script: string,
  env: NodeJS.ProcessEnv,
  logs: string[]
): ChildProcess {
  const child = spawn(process.execPath, [script], {
    env,
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  attachLogs(child, logs);
  return child;
}

async function stopProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitFor(
  label: string,
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  logs: string[]
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`${label} timed out\n${redact(logs.slice(-40).join("\n"))}`);
}

function assertAlive(child: ChildProcess, name: string, logs: string[]): void {
  if (child.exitCode !== null) {
    fail(
      `${name} exited (${child.exitCode})\n${redact(logs.slice(-40).join("\n"))}`
    );
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--up")) {
    execFileSync(
      "docker",
      [
        "compose",
        "-p",
        "sfs-cleanroom",
        "-f",
        "docker-compose.clean-room.yml",
        "up",
        "-d",
        "--wait",
      ],
      { stdio: "inherit" }
    );
    process.env["DATABASE_URL"] = COMPOSE_DATABASE_URL;
    process.env["REDIS_URL"] = COMPOSE_REDIS_URL;
  }

  const databaseUrl = process.env["DATABASE_URL"]?.trim() ?? "";
  const redisUrl = process.env["REDIS_URL"]?.trim() ?? "";
  const database = parseDatabaseTarget(databaseUrl);
  if (!database || !isLoopbackHost(database.host)) {
    fail(
      "DATABASE_URL must be a loopback Postgres. This script writes rows and will not use a remote database."
    );
  }
  if (!databaseNameAccepted(database.database)) {
    fail(
      `Refusing database "${database.database}". Use a name containing test, cleanroom, or acceptance. pnpm test:self-host-acceptance --up starts one.`
    );
  }
  const redisProblem = redisIsolationProblem(redisUrl, process.env);
  if (redisProblem) fail(redisProblem);
  const redis = new URL(redisUrl);
  if (!isLoopbackHost(redis.hostname)) {
    fail("REDIS_URL must be a loopback Redis.");
  }
  if (!(await tcpReachable(redis.hostname, Number(redis.port || 6379)))) {
    fail("Redis is not accepting connections.");
  }
  if (
    !existsSync(path.resolve("build/server.js")) ||
    !existsSync(path.resolve("build/worker.js"))
  ) {
    fail("build/server.js is missing. Run pnpm build first.");
  }

  delete process.env["NOSTR_PUBLISHER_URL"];
  delete process.env["NOSTR_PUBLISHER_API_TOKEN"];
  delete process.env["NOSTR_PUBLISHER_ALLOW_UNAUTHENTICATED"];
  delete process.env["PRIMAL_CACHING_URL"];
  process.env["NODE_ENV"] = "production";
  process.env["SFS_DEPLOYMENT_MODE"] = "self_hosted";
  process.env["SELF_HOSTED"] = "true";
  process.env["NOSTR_PUBLISHER_BACKEND"] = "internal";
  process.env["NOSTR_READ_BACKEND"] = "internal";
  process.env["NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS"] = "true";
  process.env["REFERRAL_PAYOUTS_ENABLED"] = "false";
  process.env["SESSION_SECRET"] = "self-host-acceptance-session-secret-32";
  process.env["CRON_SECRET"] = "self-host-acceptance-cron-secret-32ch";
  delete process.env["E2E_TEST"];
  process.env["DATABASE_URL"] = databaseUrl;
  process.env["REDIS_URL"] = redisUrl;
  const deployment = readPublicDeployment(process.env);
  for (const plan of [
    "free",
    "starter",
    "creator",
    "pro",
    "teams",
    "founder",
  ] as const) {
    const rate = effectiveCampaignFinalizationFeeRateBps(plan, deployment);
    if (rate !== 0) {
      fail(`${plan} platform commission is ${rate} bps in self-host mode`);
    }
  }
  write("self-host platform commission is 0% on every plan");

  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: {
      PATH: process.env["PATH"],
      HOME: process.env["HOME"],
      DATABASE_URL: databaseUrl,
      PRISMA_HIDE_UPDATE_MESSAGE: "1",
    },
  });

  const relay = await startEphemeralRelay();
  const httpPort = await freePort();
  const metricsPort = await freePort();
  const workerMetricsPort = await freePort();
  let sourceCommit = "";
  try {
    sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    sourceCommit = "";
  }

  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env["PATH"],
    HOME: process.env["HOME"],
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(httpPort),
    METRICS_PORT: String(metricsPort),
    WORKER_METRICS_PORT: String(workerMetricsPort),
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    SESSION_SECRET: process.env["SESSION_SECRET"],
    CRON_SECRET: process.env["CRON_SECRET"],
    SFS_DEPLOYMENT_MODE: "self_hosted",
    SELF_HOSTED: "true",
    NOSTR_PUBLISHER_BACKEND: "internal",
    NOSTR_READ_BACKEND: "internal",
    NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS: "true",
    REFERRAL_PAYOUTS_ENABLED: "false",
    SOURCE_COMMIT: sourceCommit,
  };

  const serverLogs: string[] = [];
  const workerLogs: string[] = [];
  let server: ChildProcess | null = null;
  let worker: ChildProcess | null = null;

  const { prisma } = await import("~/lib/prisma.server");
  const { enqueuePostJob } =
    await import("~/infra/queue/queue-operations.server");
  const { Queue } = await import("bullmq");
  const { default: Redis } = await import("ioredis");
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    connectTimeout: 5000,
  });
  const queue = new Queue("scheduled-posts", { connection });

  let userId = "";
  try {
    server = startNode(path.resolve("build/server.js"), childEnv, serverLogs);
    worker = startNode(path.resolve("build/worker.js"), childEnv, workerLogs);
    await waitFor(
      "healthcheck",
      async () => {
        if (!server || !worker) return false;
        assertAlive(server, "web server", serverLogs);
        assertAlive(worker, "worker", workerLogs);
        try {
          const response = await fetch(
            `http://127.0.0.1:${httpPort}/healthcheck`,
            { headers: { accept: "application/json" } }
          );
          if (!response.ok) return false;
          const body = (await response.json()) as {
            status?: string;
            deploymentMode?: string;
            publisherBackend?: string;
            nostrReadBackend?: string;
            sourceCommit?: string | null;
          };
          if (body.status !== "ok") return false;
          if (body.deploymentMode !== "self-hosted") {
            fail(
              `healthcheck deploymentMode is ${String(body.deploymentMode)}`
            );
          }
          if (body.publisherBackend !== "internal") {
            fail(
              `healthcheck publisherBackend is ${String(body.publisherBackend)}`
            );
          }
          if (body.nostrReadBackend !== "internal") {
            fail(
              `healthcheck nostrReadBackend is ${String(body.nostrReadBackend)}`
            );
          }
          if (sourceCommit && body.sourceCommit !== sourceCommit) {
            fail(
              `healthcheck source commit is ${String(body.sourceCommit)}, expected ${sourceCommit}`
            );
          }
          return true;
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message.startsWith("healthcheck") ||
              error.message.includes("exited"))
          ) {
            throw error;
          }
          return false;
        }
      },
      90_000,
      [...serverLogs, ...workerLogs]
    );

    const webMetrics = await fetch(`http://127.0.0.1:${metricsPort}/metrics`);
    const workerMetrics = await fetch(
      `http://127.0.0.1:${workerMetricsPort}/metrics`
    );
    const webBody = await webMetrics.text();
    const workerBody = await workerMetrics.text();
    if (
      !webMetrics.ok ||
      !workerMetrics.ok ||
      !webBody.includes("process_") ||
      !workerBody.includes("process_")
    ) {
      fail(
        `metrics were not both available (web ${webMetrics.status}, worker ${workerMetrics.status})`
      );
    }

    const good = signedNote("SmartFlowSocial self-host acceptance");
    const user = await prisma.user.create({
      data: {
        npub: good.pubkey,
        isEnabled: true,
        publishRelaySource: "app",
        userRelays: [relay.url],
      },
    });
    userId = user.id;

    async function createPost(
      note: ReturnType<typeof signedNote>,
      relays: string[]
    ): Promise<string> {
      await prisma.user.update({
        where: { id: userId },
        data: { userRelays: relays },
      });
      const post = await prisma.post.create({
        data: {
          userId,
          currentState: "SCHEDULED",
          content: note.event.content,
          postType: "TEXT",
          postKind: "POST",
          signingState: "signed",
          dependencyMode: "standalone",
          signedEvent: note.event,
          scheduledAtUtc: new Date(Date.now() - 60_000),
        },
      });
      await enqueuePostJob(post.id, userId, note.event, 0);
      return post.id;
    }

    async function stateOf(postId: string): Promise<string | null> {
      const row = await prisma.post.findUnique({
        where: { id: postId },
        select: { currentState: true, nostrEventId: true },
      });
      return row?.currentState ?? null;
    }

    const publishedId = await createPost(good, [relay.url]);
    await waitFor(
      "worker delivery",
      async () => {
        if (!worker) return false;
        assertAlive(worker, "worker", workerLogs);
        return (await stateOf(publishedId)) === "PUBLISHED";
      },
      30_000,
      workerLogs
    );
    const readBack = await readFromRelay(relay.url, good.event.id);
    if (readBack?.content !== good.event.content) {
      fail("The relay did not return the published event.");
    }
    if (relay.events.size !== 1) {
      fail(`Expected one stored event, found ${relay.events.size}.`);
    }
    write(`published event=${good.event.id} relay=${relay.url}`);

    await stopProcess(worker);
    const queued = signedNote(
      "SmartFlowSocial queued while the worker is down"
    );
    const queuedId = await createPost(queued, [relay.url]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (
      (await stateOf(queuedId)) === "PUBLISHED" ||
      relay.events.has(queued.event.id)
    ) {
      fail("A note was published while the worker was stopped.");
    }
    worker = startNode(path.resolve("build/worker.js"), childEnv, workerLogs);
    await waitFor(
      "delivery after worker start",
      async () => {
        if (!worker) return false;
        assertAlive(worker, "worker", workerLogs);
        return (await stateOf(queuedId)) === "PUBLISHED";
      },
      30_000,
      workerLogs
    );
    const queuedRead = await readFromRelay(relay.url, queued.event.id);
    if (queuedRead?.content !== queued.event.content) {
      fail("The queued note was not readable from the relay.");
    }

    await stopProcess(worker);
    await new Promise((resolve) => setTimeout(resolve, 500));
    worker = startNode(path.resolve("build/worker.js"), childEnv, workerLogs);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (!worker) fail("worker was not restarted");
    assertAlive(worker, "worker", workerLogs);
    if (
      relay.events.size !== 2 ||
      (await stateOf(publishedId)) !== "PUBLISHED" ||
      (await stateOf(queuedId)) !== "PUBLISHED"
    ) {
      fail("Restarting the worker changed published notes.");
    }

    const existing = await queue.getJob(publishedId);
    if (existing) await existing.remove();
    const sizeBeforeDuplicate = relay.events.size;
    await enqueuePostJob(publishedId, userId, good.event, 0);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    if (relay.events.size !== sizeBeforeDuplicate) {
      fail("A second job for a published note wrote another event.");
    }

    const outage = signedNote("SmartFlowSocial relay outage");
    const outageId = await createPost(outage, ["ws://127.0.0.1:1"]);
    await waitFor(
      "retryable relay outage",
      async () => {
        if (!worker) return false;
        assertAlive(worker, "worker", workerLogs);
        const bullJob = await queue.getJob(outageId);
        const attempts = bullJob?.attemptsMade ?? 0;
        const state = await stateOf(outageId);
        return attempts >= 1 && state === "SCHEDULED";
      },
      40_000,
      workerLogs
    );
    if (relay.events.has(outage.event.id)) {
      fail("The outage note was stored before the relay recovered.");
    }
    await prisma.user.update({
      where: { id: userId },
      data: { userRelays: [relay.url] },
    });
    await waitFor(
      "delivery after the relay recovered",
      async () => (await stateOf(outageId)) === "PUBLISHED",
      40_000,
      workerLogs
    );
    const recovered = await readFromRelay(relay.url, outage.event.id);
    if (
      recovered?.content !== outage.event.content ||
      relay.events.size !== 3
    ) {
      fail(
        `Relay recovery did not store exactly one new event (stored=${relay.events.size}).`
      );
    }

    write(
      `self-host acceptance passed events=${relay.events.size} port=${httpPort}`
    );
  } finally {
    await stopProcess(worker);
    await stopProcess(server);
    if (userId) {
      await prisma.user
        .delete({ where: { id: userId } })
        .catch(() => undefined);
    }
    await queue.close().catch(() => undefined);
    await connection.quit().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    await relay.close().catch(() => undefined);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`self-host acceptance failed: ${redact(message)}\n`);
    process.exit(1);
  });
