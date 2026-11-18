/**
 * Application paths through the real internal publisher and a loopback relay.
 *
 * Requires the disposable test database and Redis. SKIP_DATABASE_TESTS=true
 * skips the file. It uses an ephemeral delete-signing key and does not call a
 * public relay.
 */
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sessionHolder = vi.hoisted(() => ({
  userId: "",
  pubkey: "",
}));

vi.mock("~/features/auth/auth.server", () => ({
  requireSession: vi.fn(async () => ({
    userId: sessionHolder.userId,
    pubkey: sessionHolder.pubkey,
    sessionId: "internal-publisher-session",
  })),
  requireUserId: vi.fn(async () => sessionHolder.userId),
}));

import {
  createValidSignedEvent,
  getTestPublicKey,
} from "../utils/nostr-test-helpers";
import {
  readRelayEvent,
  startScriptedRelay,
  type ScriptedRelay,
} from "../utils/scripted-relay";

import { KIND_RELAY_LIST_NIP65 } from "~/features/nostr/nostr-event-kinds";
import { runScheduledPostJob } from "~/features/posts/queue-handlers/post-job.server";
import { processOutboxEvent } from "~/infra/outbox/outbox-handlers.server";
import { InternalNostrPublisher } from "~/infra/publishers/internal-nostr-publisher.server";
import {
  resetNostrPublisherForTests,
  setNostrPublisher,
} from "~/infra/publishers/nostr-publisher.server";
import { createMemoryPublishLedger } from "~/infra/publishers/publisher-ledger";
import { releasePostPublishLease } from "~/infra/publishing/publish-lease.server";
import { getRelayHealth } from "~/infra/relays/relay-health.server";
import { env } from "~/lib/env.server";
import { nostrAdapter } from "~/lib/nostr-adapter.server";
import { prisma } from "~/lib/prisma.server";
import { action } from "~/routes/api.publish";

const SHOULD_SKIP = process.env["SKIP_DATABASE_TESTS"] === "true";

describe.skipIf(SHOULD_SKIP)("internal publisher application paths", () => {
  let relay: ScriptedRelay;
  let userId = "";
  const pubkey = getTestPublicKey();

  beforeAll(async () => {
    relay = await startScriptedRelay();
    const user = await prisma.user.create({
      data: {
        npub: pubkey,
        isEnabled: true,
        publishRelaySource: "app",
        userRelays: [relay.url],
      },
    });
    userId = user.id;
    sessionHolder.userId = userId;
    sessionHolder.pubkey = pubkey;
    setNostrPublisher(
      new InternalNostrPublisher({
        allowPrivateRelays: true,
        connectTimeoutMs: 500,
        ackTimeoutMs: 500,
        totalTimeoutMs: 2000,
        transientRetries: 0,
        ledger: createMemoryPublishLedger(),
      })
    );
  });

  afterAll(async () => {
    resetNostrPublisherForTests();
    if (userId) {
      await prisma.publishRelayAck
        .deleteMany({ where: { userId } })
        .catch(() => undefined);
      await prisma.postStateTransition
        .deleteMany({ where: { post: { userId } } })
        .catch(() => undefined);
      await prisma.post
        .deleteMany({ where: { userId } })
        .catch(() => undefined);
      await prisma.user
        .delete({ where: { id: userId } })
        .catch(() => undefined);
    }
    if (relay) await relay.close();
  });

  async function scheduledPost(content: string, kind = 1) {
    const event = createValidSignedEvent({ content, kind });
    const post = await prisma.post.create({
      data: {
        userId,
        currentState: "SCHEDULED",
        content,
        postType: "TEXT",
        postKind: "POST",
        signingState: "signed",
        dependencyMode: "standalone",
        signedEvent: event,
        scheduledAtUtc: new Date(Date.now() - 60_000),
      },
    });
    return { post, event };
  }

  async function runJob(postId: string, event: unknown, jobId: string) {
    const ctx: { lease: { lockId: string; expiresAt: Date } | null } = {
      lease: null,
    };
    const job = {
      id: jobId,
      attemptsMade: 0,
      data: {
        postId,
        userId,
        signedEvent: event,
        correlationId: jobId,
      },
    };
    try {
      return await runScheduledPostJob({
        job: job as never,
        startTime: Date.now(),
        ctx: ctx,
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

  async function publishApi(event: unknown) {
    const request = new Request("http://127.0.0.1:3000/api/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, relays: ["wss://ignored.example"] }),
    });
    return action({
      request,
      params: {},
      context: new RouterContextProvider(),
      url: new URL(request.url),
      pattern: "*",
    });
  }

  it("publishes a scheduled post and records the relay acknowledgement", async () => {
    const { post, event } = await scheduledPost("scheduled internal publish");
    const outcome = await runJob(post.id, event, "internal-scheduled");
    const stored = await prisma.post.findUnique({
      where: { id: post.id },
      select: { currentState: true, nostrEventId: true },
    });
    const acks = await prisma.publishRelayAck.findMany({
      where: { userId, eventId: event.id },
    });
    const readBack = await readRelayEvent(relay.url, event.id);

    expect(outcome.skipped).toBeFalsy();
    expect(stored).toMatchObject({
      currentState: "PUBLISHED",
      nostrEventId: event.id,
    });
    expect(acks).toEqual([
      expect.objectContaining({ relayUrl: relay.url, status: "ACCEPTED" }),
    ]);
    expect(readBack?.content).toBe(event.content);
    expect(getRelayHealth(relay.url)?.successCount).toBeGreaterThan(0);
  });

  it("does not mark a post published when every relay fails", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { userRelays: ["ws://127.0.0.1:1"] },
    });
    try {
      const { post, event } = await scheduledPost("scheduled relay down");
      await expect(
        runJob(post.id, event, "internal-relay-down")
      ).rejects.toThrow(/Publish failed on all relays/);
      const stored = await prisma.post.findUnique({
        where: { id: post.id },
        select: { currentState: true },
      });
      const acks = await prisma.publishRelayAck.findMany({
        where: { userId, eventId: event.id },
      });
      expect(stored?.currentState).not.toBe("PUBLISHED");
      expect(acks[0]?.status).not.toBe("ACCEPTED");
      expect(relay.events.has(event.id)).toBe(false);
    } finally {
      await prisma.user.update({
        where: { id: userId },
        data: { userRelays: [relay.url] },
      });
    }
  });

  it("publishes an immediate note and a relay list through /api/publish", async () => {
    const note = createValidSignedEvent({ content: "api publish" });
    const relayList = createValidSignedEvent({
      kind: KIND_RELAY_LIST_NIP65,
      content: "",
      tags: [["r", "wss://relay.damus.io"]],
    });

    const noteResponse = await publishApi(note);
    const listResponse = await publishApi(relayList);
    const noteBody = (await noteResponse.json()) as { success?: boolean };
    const listBody = (await listResponse.json()) as { success?: boolean };
    const noteAck = await prisma.publishRelayAck.findFirst({
      where: { userId, eventId: note.id },
    });
    const listAck = await prisma.publishRelayAck.findFirst({
      where: { userId, eventId: relayList.id },
    });

    expect(noteResponse.ok).toBe(true);
    expect(noteBody.success).toBe(true);
    expect(listResponse.ok).toBe(true);
    expect(listBody.success).toBe(true);
    expect(noteAck?.status).toBe("ACCEPTED");
    expect(listAck?.status).toBe("ACCEPTED");
    expect((await readRelayEvent(relay.url, note.id))?.content).toBe(
      note.content
    );
    expect((await readRelayEvent(relay.url, relayList.id))?.kind).toBe(
      KIND_RELAY_LIST_NIP65
    );
  });

  it("publishes a poll-shaped scheduled event", async () => {
    const { post, event } = await scheduledPost("which fruit?", 1068);
    await runJob(post.id, event, "internal-poll");
    const readBack = await readRelayEvent(relay.url, event.id);
    expect(readBack?.kind).toBe(1068);
    expect(readBack?.content).toBe("which fruit?");
  });

  it("publishes an outbox delete through the internal publisher", async () => {
    const { post } = await scheduledPost("delete me");
    const secret = nostrAdapter.encodeNsec("11".repeat(32));
    expect(secret).toBeTruthy();
    const signerPubkey = nostrAdapter.getPublicKey(secret!);
    const previous = env.NOSTR_NSEC;
    env.NOSTR_NSEC = secret!;
    try {
      await processOutboxEvent({
        id: `outbox-${post.id}`,
        eventType: "POST_DELETE_REQUESTED",
        aggregateId: post.id,
        payload: {
          postId: post.id,
          userId,
          originalEventId: "ab".repeat(32),
          originalEventPubkey: signerPubkey,
          schemaVersion: "1.0",
          correlationId: `delete-${post.id}`,
        },
        createdAt: new Date(),
        scheduledFor: null,
      });
    } finally {
      env.NOSTR_NSEC = previous;
    }

    const stored = [...relay.events.values()].find(
      (event) => event.kind === 5 && event.pubkey === signerPubkey
    );
    expect(stored?.id).toBeTruthy();
    const ack = await prisma.publishRelayAck.findFirst({
      where: { userId, eventId: stored?.id },
    });
    expect(ack?.status).toBe("ACCEPTED");
    expect((await readRelayEvent(relay.url, stored!.id))?.kind).toBe(5);
  });
});
