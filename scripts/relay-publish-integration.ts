/**
 * Release check: a scheduled signed event reaches a local Nostr relay.
 *
 * `pnpm smoke:publish` stays the fast check. It stops at a signature-checking
 * HTTP stub. This script starts a loopback relay and publishes through the
 * internal Nostr publisher.
 *
 * Requires Postgres and Redis (`pnpm docker`) and a schema (`pnpm exec prisma
 * migrate deploy`). It creates an ephemeral key. It does not use a public relay, a
 * personal key, or a Lightning wallet.
 *
 *   pnpm test:relay-publish
 *
 * CI runs this on the test job after the disposable schema push. Postgres and
 * Redis must be loopback addresses.
 *
 * Covered here: successful delivery and an independent relay read, relay
 * recovery, a second job for the same published post, an invalid signature,
 * and a relay that is not running.
 */
import "dotenv/config";

import { randomBytes } from "node:crypto";
import { connect as connectNet } from "node:net";

import Redis from "ioredis";
import { finalizeEvent, getPublicKey } from "nostr-tools";
import WebSocket from "ws";

import { startEphemeralRelay } from "./ephemeral-relay.mjs";
import { canonicalRelayKey } from "~/infra/publishers/relay-target";
import {
  isLoopbackHost,
  parseDatabaseTarget,
} from "~/lib/test-database-target";

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(line: string): never {
  process.stderr.write(`${line}\n`);
  process.exit(1);
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
  return { secretKey, pubkey: getPublicKey(secretKey), event };
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
    }, 3000);
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

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"]?.trim() ?? "";
  const redisUrl = process.env["REDIS_URL"]?.trim() ?? "";
  if (!databaseUrl.startsWith("postgres")) {
    fail("DATABASE_URL is missing. Copy example.env and run pnpm docker.");
  }
  const database = parseDatabaseTarget(databaseUrl);
  if (!database || !isLoopbackHost(database.host)) {
    fail(
      "DATABASE_URL must be a loopback Postgres. This script creates and deletes a user and will not use a remote database."
    );
  }
  if (!redisUrl.startsWith("redis://")) {
    fail("REDIS_URL is missing. pnpm docker starts Redis on 127.0.0.1:6379.");
  }
  const redis = new URL(redisUrl);
  if (!isLoopbackHost(redis.hostname)) {
    fail("REDIS_URL must be a loopback Redis.");
  }
  if (!(await tcpReachable(redis.hostname, Number(redis.port || 6379)))) {
    fail("Redis is not accepting connections. Run pnpm docker.");
  }

  const sessionSecret = process.env["SESSION_SECRET"]?.trim() ?? "";
  process.env["NODE_ENV"] = "test";
  process.env["E2E_TEST"] = "true";
  process.env["SFS_DEPLOYMENT_MODE"] = "self_hosted";
  process.env["NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS"] = "true";
  for (const removed of [
    "SELF_HOSTED",
    "LOCAL_PUBLISHER_PORT",
    "LOCAL_PUBLISHER_TOKEN",
    "NOSTR_PUBLISHER_ALLOW_UNAUTHENTICATED",
    "NOSTR_PUBLISHER_API_TOKEN",
    "NOSTR_PUBLISHER_BACKEND",
    "NOSTR_PUBLISHER_URL",
    "NOSTR_READ_BACKEND",
    "PRIMAL_CACHING_URL",
    "PRIMAL_HTTP_MAX_RETRIES",
    "PRIMAL_HTTP_TIMEOUT_MS",
    "APP_URL",
    "COOLIFY_URL",
  ]) {
    delete process.env[removed];
  }
  process.env["SESSION_SECRET"] =
    sessionSecret.length >= 32
      ? sessionSecret
      : "relay-publish-integration-secret-32";

  const relay = await startEphemeralRelay();

  const { prisma } = await import("~/lib/prisma.server");
  const { runScheduledPostJob } =
    await import("~/features/posts/queue-handlers/post-job.server");
  const { releasePostPublishLease } =
    await import("~/infra/publishing/publish-lease.server");

  const good = signedNote("SmartFlowSocial relay integration");
  let userId = "";

  async function runJob(postId: string, event: unknown, jobId: string) {
    const ctx: { lease: { lockId: string; expiresAt: Date } | null } = {
      lease: null,
    };
    try {
      return await runScheduledPostJob({
        job: {
          id: jobId,
          attemptsMade: 0,
          data: {
            postId,
            userId,
            signedEvent: event,
            correlationId: jobId,
          },
        } as never,
        startTime: Date.now(),
        ctx: ctx as never,
      });
    } catch (error) {
      if (ctx.lease) {
        await releasePostPublishLease({
          postId,
          userId,
          lockId: ctx.lease.lockId,
        });
      }
      throw error;
    }
  }

  try {
    const user = await prisma.user.create({
      data: {
        npub: good.pubkey,
        isEnabled: true,
        publishRelaySource: "app",
        userRelays: [relay.url],
      },
    });
    userId = user.id;

    const downPost = await prisma.post.create({
      data: {
        userId,
        currentState: "SCHEDULED",
        content: good.event.content,
        postType: "TEXT",
        postKind: "POST",
        signingState: "signed",
        dependencyMode: "standalone",
        signedEvent: good.event,
        scheduledAtUtc: new Date(Date.now() - 60_000),
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { userRelays: ["ws://127.0.0.1:1"] },
    });
    let relayDownFirst = false;
    try {
      await runJob(downPost.id, good.event, "relay-down-first");
    } catch {
      relayDownFirst = true;
    }
    if (!relayDownFirst || relay.events.has(good.event.id)) {
      fail("Relay-down case did not fail closed.");
    }
    await prisma.user.update({
      where: { id: userId },
      data: { userRelays: [relay.url] },
    });
    await prisma.post.update({
      where: { id: downPost.id },
      data: { currentState: "SCHEDULED" },
    });

    const recovered = await runJob(
      downPost.id,
      good.event,
      "relay-publisher-recovered"
    );
    const stored = await prisma.post.findUnique({
      where: { id: downPost.id },
      select: { currentState: true, nostrEventId: true },
    });
    const readBack = await readFromRelay(relay.url, good.event.id);
    const redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: false,
    });
    const ackKey = `nostr-publish:v1:${good.event.id}:${canonicalRelayKey(relay.url)}`;
    const ack = await redisClient.get(ackKey);
    await redisClient.del(ackKey);
    await redisClient.quit();
    if (
      recovered.skipped ||
      stored?.currentState !== "PUBLISHED" ||
      stored.nostrEventId !== good.event.id ||
      relay.events.get(good.event.id)?.content !== good.event.content ||
      readBack?.content !== good.event.content ||
      ack !== "1"
    ) {
      fail(
        `Relay delivery failed. skipped=${String(recovered.skipped)} state=${stored?.currentState ?? "missing"} eventIdRecorded=${String(stored?.nostrEventId === good.event.id)} eventStored=${String(relay.events.has(good.event.id))} readBack=${readBack?.content ?? "missing"} ledgerAck=${ack ?? "missing"}`
      );
    }

    const duplicate = await runJob(
      downPost.id,
      good.event,
      "relay-duplicate-job"
    );
    if (!duplicate.skipped || relay.events.size !== 1) {
      fail("A second job for a published post was not ignored.");
    }

    const tampered = signedNote("tampered");
    const badPost = await prisma.post.create({
      data: {
        userId,
        currentState: "SCHEDULED",
        content: "changed after signing",
        postType: "TEXT",
        postKind: "POST",
        signingState: "signed",
        dependencyMode: "standalone",
        signedEvent: { ...tampered.event, content: "changed after signing" },
        scheduledAtUtc: new Date(Date.now() - 60_000),
      },
    });
    let badSignatureThrew = false;
    try {
      await runJob(badPost.id, badPost.signedEvent, "relay-bad-signature");
    } catch {
      badSignatureThrew = true;
    }
    if (!badSignatureThrew || relay.events.has(tampered.event.id)) {
      fail("Invalid signature was accepted.");
    }

    await prisma.user.update({
      where: { id: userId },
      data: { userRelays: ["ws://127.0.0.1:1"] },
    });
    const relayDown = signedNote("relay down");
    const relayDownPost = await prisma.post.create({
      data: {
        userId,
        currentState: "SCHEDULED",
        content: relayDown.event.content,
        postType: "TEXT",
        postKind: "POST",
        signingState: "signed",
        dependencyMode: "standalone",
        signedEvent: relayDown.event,
        scheduledAtUtc: new Date(Date.now() - 60_000),
      },
    });
    let relayDownThrew = false;
    try {
      await runJob(relayDownPost.id, relayDown.event, "relay-down");
    } catch {
      relayDownThrew = true;
    }
    const relayDownStored = await prisma.post.findUnique({
      where: { id: relayDownPost.id },
      select: { currentState: true },
    });
    if (
      !relayDownThrew ||
      relayDownStored?.currentState === "PUBLISHED" ||
      relay.events.has(relayDown.event.id)
    ) {
      fail("Relay-down case was marked published.");
    }

    write(
      `relay publish integration passed post=${downPost.id} relay=${relay.url} events=${relay.events.size}`
    );
  } finally {
    if (userId) {
      await prisma.user
        .delete({ where: { id: userId } })
        .catch(() => undefined);
    }
    await Promise.race([
      Promise.all([prisma.$disconnect(), relay.close()]),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
  process.exit(0);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`relay publish integration failed: ${message}\n`);
  process.exit(1);
});
