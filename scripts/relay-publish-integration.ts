/**
 * Release check: a scheduled signed event reaches a local Nostr relay.
 *
 * `pnpm smoke:publish` stays the fast check. It stops at a signature-checking
 * publisher. This script starts a loopback relay and a publisher that actually
 * writes the event there.
 *
 * Requires Postgres and Redis (`pnpm docker`) and a schema (`pnpm exec prisma
 * db push`). It creates an ephemeral key. It does not use a public relay, a
 * personal key, or a Lightning wallet.
 *
 *   pnpm test:relay-publish
 *
 * Covered here: successful delivery, publisher down then recovery, a second
 * job for the same published post, an invalid signature, and a relay that is
 * not running. A wrong publisher token is covered by
 * tests/integration/relay-publisher.contract.test.ts because the app reads
 * the token once at startup.
 */
import "dotenv/config";

import { randomBytes } from "node:crypto";
import { connect as connectNet } from "node:net";

import { finalizeEvent, getPublicKey } from "nostr-tools";

import { startEphemeralRelay } from "./ephemeral-relay.mjs";
import { createRelayPublisher } from "./relay-publisher.mjs";

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

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"]?.trim() ?? "";
  const redisUrl = process.env["REDIS_URL"]?.trim() ?? "";
  if (!databaseUrl.startsWith("postgres")) {
    fail("DATABASE_URL is missing. Copy example.env and run pnpm docker.");
  }
  if (!redisUrl.startsWith("redis://")) {
    fail("REDIS_URL is missing. pnpm docker starts Redis on 127.0.0.1:6379.");
  }
  const redis = new URL(redisUrl);
  if (!(await tcpReachable(redis.hostname, Number(redis.port || 6379)))) {
    fail("Redis is not accepting connections. Run pnpm docker.");
  }

  const sessionSecret = process.env["SESSION_SECRET"]?.trim() ?? "";
  process.env["NODE_ENV"] = "test";
  process.env["E2E_TEST"] = "true";
  process.env["SESSION_SECRET"] =
    sessionSecret.length >= 32
      ? sessionSecret
      : "relay-publish-integration-secret-32";

  const relay = await startEphemeralRelay();
  const token = "relay-publish-integration-token";
  const publisher = createRelayPublisher({ token });
  const port = await publisher.listen(0, "127.0.0.1");
  await publisher.close();
  process.env["NOSTR_PUBLISHER_URL"] = `http://127.0.0.1:${port}/publish`;
  process.env["NOSTR_PUBLISHER_API_TOKEN"] = token;

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

    let publisherDownThrew = false;
    try {
      await runJob(downPost.id, good.event, "relay-publisher-down");
    } catch {
      publisherDownThrew = true;
    }
    if (!publisherDownThrew || relay.events.has(good.event.id)) {
      fail("Publisher-down case did not fail closed.");
    }
    await prisma.post.update({
      where: { id: downPost.id },
      data: { currentState: "SCHEDULED" },
    });

    await publisher.listen(port, "127.0.0.1");
    const recovered = await runJob(
      downPost.id,
      good.event,
      "relay-publisher-recovered"
    );
    const stored = await prisma.post.findUnique({
      where: { id: downPost.id },
      select: { currentState: true, nostrEventId: true },
    });
    if (
      recovered.skipped ||
      stored?.currentState !== "PUBLISHED" ||
      stored.nostrEventId !== good.event.id ||
      relay.events.get(good.event.id)?.content !== good.event.content
    ) {
      fail(
        `Relay delivery failed. state=${stored?.currentState ?? "missing"} eventStored=${String(relay.events.has(good.event.id))}`
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
      Promise.all([prisma.$disconnect(), publisher.close(), relay.close()]),
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
