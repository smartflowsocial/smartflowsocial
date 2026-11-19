import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const envState = vi.hoisted(() => {
  const state: { ENABLE_NOSTR_DELETE_EVENTS: string | undefined } = {
    ENABLE_NOSTR_DELETE_EVENTS: undefined,
  };
  return state;
});

const prismaMock = vi.hoisted(() => {
  const post = {
    create: vi.fn(
      (_args: { data: Record<string, unknown> }): Promise<unknown> =>
        Promise.resolve({ id: "post-1", userId: "user-1" })
    ),
    update: vi.fn(
      (_args: {
        where: { id: string; userId: string };
        data: Record<string, unknown>;
      }): Promise<unknown> =>
        Promise.resolve({ id: "post-1", userId: "user-1" })
    ),
    delete: vi.fn(
      (_args: { where: { id: string; userId: string } }): Promise<unknown> =>
        Promise.resolve({ id: "post-1", userId: "user-1" })
    ),
    findUnique: vi.fn(
      (_args: { where: { id: string; userId: string } }): Promise<unknown> =>
        Promise.resolve(null)
    ),
    findFirst: vi.fn(
      (_args: { where: Record<string, unknown> }): Promise<unknown> =>
        Promise.resolve(null)
    ),
  };
  const postStateTransition = {
    create: vi.fn(
      (_args: { data: Record<string, unknown> }): Promise<unknown> =>
        Promise.resolve({ id: "transition-1" })
    ),
  };
  const tx = { post, postStateTransition };
  const $transaction = vi.fn(
    (fn: (client: typeof tx) => Promise<unknown>): Promise<unknown> => fn(tx)
  );
  return { post, postStateTransition, tx, $transaction };
});

const outbox = vi.hoisted(() => ({
  createOutboxEventInTransaction: vi.fn(
    (
      _tx: unknown,
      _eventType: string,
      _aggregateId: string,
      _aggregateType: string,
      _payload: unknown,
      _availableAt?: Date,
      _idempotencyKey?: string,
      _correlationId?: string
    ): Promise<void> => Promise.resolve()
  ),
  createOutboxEvent: vi.fn(
    (
      _eventType: string,
      _aggregateId: string,
      _aggregateType: string,
      _payload: unknown
    ): Promise<void> => Promise.resolve()
  ),
}));

const drafts = vi.hoisted(() => ({
  checkDraftCapacity: vi.fn(
    (_userId: string, _additional: number): Promise<string | null> =>
      Promise.resolve(null)
  ),
}));

const logger = vi.hoisted(() => ({
  logError: vi.fn(
    (_error: Error, _context: Record<string, unknown>): void => undefined
  ),
  logInfo: vi.fn(
    (_message: string, _context: Record<string, unknown>): void => undefined
  ),
}));

vi.mock("~/lib/env.server", () => ({
  env: {
    get ENABLE_NOSTR_DELETE_EVENTS() {
      return envState.ENABLE_NOSTR_DELETE_EVENTS;
    },
    NODE_ENV: "test",
  },
}));
vi.mock("~/lib/error-logger.server", () => ({
  logError: logger.logError,
  logInfo: logger.logInfo,
}));
vi.mock("~/lib/prisma.server", () => ({
  prisma: {
    post: prismaMock.post,
    $transaction: prismaMock.$transaction,
  },
}));
vi.mock("~/infra/outbox/outbox.server", () => outbox);
vi.mock(
  "~/features/payments/entitlements/draft-template-cap.server",
  () => drafts
);

import type { NostrEvent, SignedEvent } from "~/features/nostr/types";
import {
  cloneDraftPost,
  createPost,
  createPostWithOutbox,
  deletePost,
  reschedulePost,
  updatePost,
} from "~/features/posts/data/post.commands.server";
import type { CreatePostData } from "~/features/posts/data/post.types";
import { BRAND_DELETE_REASON } from "~/lib/brand";
import { generateEnqueueIdempotencyKey } from "~/lib/idempotency.server";

const USER_ID = "user-1";
const POST_ID = "post-1";
const UNIX = 1_781_000_000;
const SCHEDULED_AT = new Date(UNIX * 1000);

function asDate(value: unknown): Date {
  return value as Date;
}

function asSigned(value: unknown): SignedEvent {
  return value as SignedEvent;
}

function signedEvent(id = "evt-1"): SignedEvent {
  return {
    id,
    pubkey: "a".repeat(64),
    created_at: UNIX,
    kind: 1,
    tags: [],
    content: "hello",
    sig: "b".repeat(128),
  };
}

function nostrEvent(): NostrEvent {
  return {
    content: "hello",
    created_at: UNIX,
    kind: 1,
    tags: [],
  };
}

function postInput(overrides: Partial<CreatePostData> = {}): CreatePostData {
  return {
    userId: USER_ID,
    content: "hello",
    fileUrl: [],
    postType: "TEXT",
    tags: [],
    ...overrides,
  };
}

function createdData(): Record<string, unknown> {
  const data = prismaMock.post.create.mock.calls.at(-1)?.[0].data;
  if (!data) throw new Error("expected post.create");
  return data;
}

function updatedData(): Record<string, unknown> {
  const data = prismaMock.post.update.mock.calls.at(-1)?.[0].data;
  if (!data) throw new Error("expected post.update");
  return data;
}

function transitionData(): Record<string, unknown> {
  const data =
    prismaMock.postStateTransition.create.mock.calls.at(-1)?.[0].data;
  if (!data) throw new Error("expected state transition");
  return data;
}

function outboxTypes(): string[] {
  return outbox.createOutboxEventInTransaction.mock.calls.map(
    (call) => call[1]
  );
}

function existingPost(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: POST_ID,
    userId: USER_ID,
    signedEvent: null,
    nostrEvent: null,
    nostrEventId: null,
    ...overrides,
  };
}

function failDeleteRequest(error: unknown): void {
  outbox.createOutboxEventInTransaction.mockImplementation(
    (_tx: unknown, eventType: string): Promise<void> => {
      if (eventType === "POST_DELETE_REQUESTED") {
        return Promise.reject(error);
      }
      return Promise.resolve();
    }
  );
}

function errorWithCause(
  cause: { originalCode?: string; message?: string } | undefined,
  message = "insert failed"
): Error {
  const error = new Error(message);
  if (cause !== undefined) {
    Object.assign(error, { cause });
  }
  return error;
}

describe("post command branches", () => {
  beforeEach(() => {
    envState.ENABLE_NOSTR_DELETE_EVENTS = undefined;
    prismaMock.post.create.mockReset();
    prismaMock.post.create.mockResolvedValue({
      id: POST_ID,
      userId: USER_ID,
    });
    prismaMock.post.update.mockReset();
    prismaMock.post.update.mockResolvedValue({
      id: POST_ID,
      userId: USER_ID,
    });
    prismaMock.post.delete.mockReset();
    prismaMock.post.delete.mockResolvedValue({
      id: POST_ID,
      userId: USER_ID,
    });
    prismaMock.post.findUnique.mockReset();
    prismaMock.post.findUnique.mockResolvedValue(null);
    prismaMock.post.findFirst.mockReset();
    prismaMock.post.findFirst.mockResolvedValue(null);
    prismaMock.postStateTransition.create.mockReset();
    prismaMock.postStateTransition.create.mockResolvedValue({
      id: "transition-1",
    });
    prismaMock.$transaction.mockReset();
    prismaMock.$transaction.mockImplementation((fn) => fn(prismaMock.tx));
    outbox.createOutboxEventInTransaction.mockReset();
    outbox.createOutboxEventInTransaction.mockResolvedValue(undefined);
    outbox.createOutboxEvent.mockReset();
    outbox.createOutboxEvent.mockResolvedValue(undefined);
    drafts.checkDraftCapacity.mockReset();
    drafts.checkDraftCapacity.mockResolvedValue(null);
    logger.logError.mockReset();
    logger.logInfo.mockReset();
  });

  describe("createPost", () => {
    it("creates a draft when no schedule is provided", async () => {
      const created = await createPost(
        postInput({
          threadGroupId: null,
          replyToEventId: null,
          replyToPostId: null,
          queueTypeId: "",
          hashTagPresetId: "",
          repostOfPostId: null,
          quoteOfPostId: null,
          quoteOfLongFormPostId: null,
          parentScheduledActionId: null,
        })
      );

      expect(created).toMatchObject({ id: POST_ID, userId: USER_ID });
      const data = createdData();
      expect(data["currentState"]).toBe("DRAFT");
      expect(data["scheduledAtUtc"]).toBeUndefined();
      expect(data["manual_override"]).toBe(false);
      expect(data["repost"]).toBe(false);
      expect(data["isQuotedPost"]).toBe(false);
      expect(data["isRecyclable"]).toBe(false);
      expect(data["postKind"]).toBe("POST");
      expect(data["user"]).toEqual({ connect: { id: USER_ID } });
      expect(data["queueType"]).toBeUndefined();
      expect(data["hashTagPreset"]).toBeUndefined();
      expect(data["threadGroupId"]).toBeUndefined();
      expect(data["replyTo"]).toBeUndefined();
      expect(data["repostOf"]).toBeUndefined();
    });

    it("treats a non-date schedule value as a draft", async () => {
      await createPost(postInput({ scheduledAtUtc: asDate("bad") }));
      const data = createdData();
      expect(data["currentState"]).toBe("DRAFT");
      expect(data["scheduledAtUtc"]).toBeUndefined();
    });

    it("schedules from a Date or unix seconds and connects relations", async () => {
      const signed = signedEvent();
      const nostr = nostrEvent();
      const publishedAt = new Date("2026-01-01T00:00:00.000Z");
      await createPost(
        postInput({
          scheduledAtUtc: UNIX,
          publishedAt,
          fileUrl: ["https://cdn.example/a.png"],
          nostrEventId: "evt-1",
          signedEvent: signed,
          nostrEvent: nostr,
          tags: ["tag"],
          caption: "cap",
          manual_override: true,
          repost: true,
          isQuotedPost: true,
          isRecyclable: true,
          creationIdempotencyKey: "create-key",
          postKind: "REPOST",
          threadGroupId: "thread-1",
          replyToEventId: "reply-evt",
          replyToPostId: "reply-1",
          queueTypeId: "queue-1",
          hashTagPresetId: "preset-1",
          repostOfPostId: "repost-1",
          quoteOfPostId: "quote-1",
          quoteOfLongFormPostId: "long-1",
          parentScheduledActionId: "parent-1",
          rootScheduledActionId: "root-1",
          targetScheduledActionId: "target-1",
          dependencyMode: "attached",
          targetMode: "scheduled_parent",
          followUpTimingMode: "offset_from_parent",
          followUpOffsetSeconds: 60,
          expectedParentEventId: "parent-evt",
          signedChildEventId: "child-evt",
          signingState: "signed",
        })
      );

      const data = createdData();
      expect(data["currentState"]).toBe("SCHEDULED");
      expect(data["scheduledAtUtc"]).toEqual(SCHEDULED_AT);
      expect(data["manual_override"]).toBe(true);
      expect(data["repost"]).toBe(true);
      expect(data["isQuotedPost"]).toBe(true);
      expect(data["isRecyclable"]).toBe(true);
      expect(data["postKind"]).toBe("REPOST");
      expect(data["signedEvent"]).toBe(signed);
      expect(data["nostrEvent"]).toBe(nostr);
      expect(data["publishedAt"]).toBe(publishedAt);
      expect(data["threadGroupId"]).toBe("thread-1");
      expect(data["replyToEventId"]).toBe("reply-evt");
      expect(data["replyTo"]).toEqual({ connect: { id: "reply-1" } });
      expect(data["queueType"]).toEqual({ connect: { id: "queue-1" } });
      expect(data["hashTagPreset"]).toEqual({ connect: { id: "preset-1" } });
      expect(data["repostOf"]).toEqual({ connect: { id: "repost-1" } });
      expect(data["quoteOf"]).toEqual({ connect: { id: "quote-1" } });
      expect(data["quoteOfLongForm"]).toEqual({ connect: { id: "long-1" } });
      expect(data["parentScheduledAction"]).toEqual({
        connect: { id: "parent-1" },
      });
      expect(data["rootScheduledActionId"]).toBe("root-1");
      expect(data["signingState"]).toBe("signed");

      await createPost(postInput({ scheduledAtUtc: SCHEDULED_AT }));
      expect(createdData()["scheduledAtUtc"]).toBe(SCHEDULED_AT);
      expect(createdData()["currentState"]).toBe("SCHEDULED");
    });
  });

  describe("createPostWithOutbox", () => {
    it("creates a draft and only the created outbox event", async () => {
      await createPostWithOutbox(
        postInput({
          nominalScheduledAtUtc: null,
          repostConditions: null,
        }),
        undefined,
        "corr-1"
      );

      const data = createdData();
      expect(data["currentState"]).toBe("DRAFT");
      expect(data["scheduledAtUtc"]).toBeNull();
      expect(data["nominalScheduledAtUtc"]).toBeNull();
      expect(data["repostConditions"]).toBeUndefined();
      expect(transitionData()).toEqual({
        postId: POST_ID,
        fromState: "DRAFT",
        toState: "DRAFT",
        reason: "Post created as draft",
      });
      expect(outboxTypes()).toEqual(["POST_CREATED"]);
      expect(outbox.createOutboxEventInTransaction.mock.calls[0]?.[4]).toEqual({
        postId: POST_ID,
        userId: USER_ID,
      });
      expect(outbox.createOutboxEventInTransaction.mock.calls[0]?.[7]).toBe(
        "corr-1"
      );
    });

    it("skips the scheduled outbox event unless time, signature, and date all exist", async () => {
      const signed = signedEvent();
      await createPostWithOutbox(
        postInput({ signedEvent: signed }),
        0,
        "corr-1"
      );
      expect(outboxTypes()).toEqual(["POST_CREATED"]);

      outbox.createOutboxEventInTransaction.mockClear();
      await createPostWithOutbox(
        postInput({ scheduledAtUtc: SCHEDULED_AT }),
        UNIX,
        "corr-1"
      );
      expect(outboxTypes()).toEqual(["POST_CREATED"]);

      outbox.createOutboxEventInTransaction.mockClear();
      await createPostWithOutbox(
        postInput({ signedEvent: signed }),
        UNIX,
        "corr-1"
      );
      expect(outboxTypes()).toEqual(["POST_CREATED"]);
      expect(createdData()["currentState"]).toBe("DRAFT");
    });

    it("emits a scheduled outbox event and stores optional relations", async () => {
      const signed = signedEvent();
      const nostr = nostrEvent();
      await createPostWithOutbox(
        postInput({
          content: "scheduled",
          fileUrl: ["https://cdn.example/a.png"],
          scheduledAtUtc: SCHEDULED_AT,
          nominalScheduledAtUtc: SCHEDULED_AT,
          nostrEventId: "evt-1",
          signedEvent: signed,
          nostrEvent: nostr,
          publishedAt: SCHEDULED_AT,
          caption: "cap",
          tags: ["tag"],
          manual_override: true,
          repost: true,
          isQuotedPost: true,
          isRecyclable: true,
          creationIdempotencyKey: "create-key",
          postKind: "QUOTE",
          threadGroupId: "thread-1",
          replyToEventId: "reply-evt",
          replyToPostId: "reply-1",
          queueTypeId: "queue-1",
          hashTagPresetId: "preset-1",
          repostOfPostId: "repost-1",
          quoteOfPostId: "quote-1",
          quoteOfLongFormPostId: "long-1",
          parentScheduledActionId: "parent-1",
          rootScheduledActionId: "root-1",
          targetScheduledActionId: "target-1",
          dependencyMode: "attached",
          targetMode: "scheduled_parent",
          followUpTimingMode: "fixed_datetime",
          followUpOffsetSeconds: 30,
          expectedParentEventId: "parent-evt",
          signedChildEventId: "child-evt",
          signingState: "signed",
          repostConditions: { minReactions: 2 },
        }),
        UNIX,
        "corr-1"
      );

      const data = createdData();
      expect(data["currentState"]).toBe("SCHEDULED");
      expect(data["scheduledAtUtc"]).toEqual(SCHEDULED_AT);
      expect(data["nominalScheduledAtUtc"]).toEqual(SCHEDULED_AT);
      expect(data["repostConditions"]).toEqual({ minReactions: 2 });
      expect(data["queueType"]).toEqual({ connect: { id: "queue-1" } });
      expect(data["manual_override"]).toBe(true);
      expect(data["postKind"]).toBe("QUOTE");
      expect(transitionData()["reason"]).toBe("Post created with schedule");
      expect(outboxTypes()).toEqual(["POST_CREATED", "POST_SCHEDULED"]);
      const scheduledCall = outbox.createOutboxEventInTransaction.mock.calls[1];
      expect(scheduledCall?.[4]).toEqual({
        postId: POST_ID,
        userId: USER_ID,
        signedEvent: signed,
        scheduledFor: UNIX,
        schemaVersion: "1.0",
        correlationId: "corr-1",
      });
      expect(scheduledCall?.[5]).toEqual(SCHEDULED_AT);
      expect(scheduledCall?.[6]).toBe(
        generateEnqueueIdempotencyKey(POST_ID, UNIX, signed.id)
      );
      expect(scheduledCall?.[7]).toBe("corr-1");
    });

    it("hashes the enqueue key without an event id when the signature has no string id", async () => {
      await createPostWithOutbox(
        postInput({
          scheduledAtUtc: UNIX,
          signedEvent: asSigned({ id: 5, pubkey: "pk" }),
          repostConditions: {},
          nominalScheduledAtUtc: asDate(0),
        }),
        UNIX,
        "corr-1"
      );
      expect(outboxTypes()).toEqual(["POST_CREATED", "POST_SCHEDULED"]);
      expect(outbox.createOutboxEventInTransaction.mock.calls[1]?.[6]).toBe(
        generateEnqueueIdempotencyKey(POST_ID, UNIX, undefined)
      );
      expect(createdData()["repostConditions"]).toBeUndefined();
      expect(createdData()["nominalScheduledAtUtc"]).toBeNull();
      expect(createdData()["scheduledAtUtc"]).toEqual(SCHEDULED_AT);

      outbox.createOutboxEventInTransaction.mockClear();
      await createPostWithOutbox(
        postInput({
          scheduledAtUtc: SCHEDULED_AT,
          signedEvent: asSigned("not-an-event"),
          nominalScheduledAtUtc: asDate("bad"),
        }),
        UNIX
      );
      expect(outbox.createOutboxEventInTransaction.mock.calls[1]?.[6]).toBe(
        generateEnqueueIdempotencyKey(POST_ID, UNIX, undefined)
      );
      expect(createdData()["nominalScheduledAtUtc"]).toBeNull();
    });
  });

  describe("deletePost", () => {
    it("returns null when the post does not exist", async () => {
      await expect(
        deletePost({ id: POST_ID, userId: USER_ID, correlationId: "corr-1" })
      ).resolves.toBeNull();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.post.findUnique.mock.calls[0]?.[0]).toEqual({
        where: { id: POST_ID, userId: USER_ID },
      });
    });

    it("recognizes every enabled delete-event flag and ignores disabled values", async () => {
      prismaMock.post.findUnique.mockResolvedValue(
        existingPost({
          signedEvent: signedEvent(),
          nostrEvent: nostrEvent(),
          nostrEventId: "evt-1",
        })
      );

      for (const raw of [
        "1",
        "true",
        "yes",
        "y",
        "on",
        "enabled",
        " TRUE ",
        " YeS ",
      ]) {
        envState.ENABLE_NOSTR_DELETE_EVENTS = raw;
        outbox.createOutboxEventInTransaction.mockClear();
        await deletePost({
          id: POST_ID,
          userId: USER_ID,
          correlationId: "corr-1",
        });
        expect(outboxTypes()).toEqual([
          "POST_DELETED",
          "POST_DELETE_REQUESTED",
        ]);
      }

      for (const raw of [undefined, "", "no", "false", "off", "0"]) {
        envState.ENABLE_NOSTR_DELETE_EVENTS = raw;
        outbox.createOutboxEventInTransaction.mockClear();
        logger.logInfo.mockClear();
        await deletePost({ id: POST_ID, userId: USER_ID });
        expect(outboxTypes()).toEqual(["POST_DELETED"]);
        expect(logger.logInfo).not.toHaveBeenCalled();
      }
    });

    it("requests relay deletion from the first usable event reference", async () => {
      envState.ENABLE_NOSTR_DELETE_EVENTS = "true";
      const references: Array<Record<string, unknown>> = [
        { signedEvent: signedEvent("signed-id"), nostrEvent: nostrEvent() },
        {
          signedEvent: { id: 1, pubkey: "pk" },
          nostrEvent: { id: "nostr-id", pubkey: "nostr-pk" },
        },
        {
          signedEvent: null,
          nostrEvent: { pubkey: "only-pk" },
          nostrEventId: "stored-id",
        },
      ];
      const expectedIds = ["signed-id", "nostr-id", "stored-id"];

      for (const [index, reference] of references.entries()) {
        prismaMock.post.findUnique.mockResolvedValueOnce(
          existingPost(reference)
        );
        outbox.createOutboxEventInTransaction.mockClear();
        await deletePost({
          id: POST_ID,
          userId: USER_ID,
          correlationId: "corr-1",
        });
        const payload =
          outbox.createOutboxEventInTransaction.mock.calls[1]?.[4];
        expect(payload).toEqual({
          postId: POST_ID,
          userId: USER_ID,
          originalEventId: expectedIds[index],
          originalEventPubkey:
            index === 0 ? "a".repeat(64) : index === 1 ? "nostr-pk" : "only-pk",
          reason: BRAND_DELETE_REASON,
          schemaVersion: "1.0",
          correlationId: "corr-1",
        });
      }
    });

    it("logs a skip when deletion is enabled but no event metadata exists", async () => {
      envState.ENABLE_NOSTR_DELETE_EVENTS = "on";
      prismaMock.post.findUnique.mockResolvedValueOnce(
        existingPost({
          signedEvent: "nope",
          nostrEvent: { id: "evt" },
          nostrEventId: "evt",
        })
      );

      await expect(
        deletePost({ id: POST_ID, userId: USER_ID, correlationId: "corr-1" })
      ).resolves.toMatchObject({ id: POST_ID });
      expect(outboxTypes()).toEqual(["POST_DELETED"]);
      expect(logger.logInfo.mock.calls[0]?.[0]).toBe(
        "Skipping POST_DELETE_REQUESTED outbox event: missing metadata"
      );
      expect(logger.logInfo.mock.calls[0]?.[1]).toEqual({
        postId: POST_ID,
        userId: USER_ID,
        correlationId: "corr-1",
      });
    });

    it("swallows a missing delete-event constraint and rethrows other failures", async () => {
      envState.ENABLE_NOSTR_DELETE_EVENTS = "enabled";
      prismaMock.post.findUnique.mockResolvedValue(
        existingPost({ signedEvent: signedEvent(), nostrEvent: nostrEvent() })
      );

      failDeleteRequest(new Error("OutboxEvent_eventType_check"));
      await expect(
        deletePost({ id: POST_ID, userId: USER_ID, correlationId: "corr-1" })
      ).resolves.toMatchObject({ id: POST_ID });
      expect(logger.logInfo.mock.calls[0]?.[0]).toBe(
        "Skipping POST_DELETE_REQUESTED outbox event: DB constraint not yet updated"
      );

      logger.logInfo.mockClear();
      failDeleteRequest(
        errorWithCause({
          originalCode: "23514",
          message: "OutboxEvent_eventType_check",
        })
      );
      await expect(
        deletePost({ id: POST_ID, userId: USER_ID })
      ).resolves.toMatchObject({ id: POST_ID });
      expect(logger.logInfo).toHaveBeenCalled();

      const rethrown = [
        errorWithCause({ originalCode: "23514", message: "other" }),
        errorWithCause({
          originalCode: "99999",
          message: "OutboxEvent_eventType_check",
        }),
        errorWithCause(undefined, "plain failure"),
        "boom",
      ];
      for (const error of rethrown) {
        logger.logError.mockClear();
        failDeleteRequest(error);
        await expect(
          deletePost({ id: POST_ID, userId: USER_ID, correlationId: "corr-1" })
        ).rejects.toBe(error);
        const logged = logger.logError.mock.calls[0];
        if (!logged) throw new Error("expected logError");
        expect(logged[0]).toBeInstanceOf(Error);
        expect(logged[1]).toEqual({
          message: "Failed to delete post and emit outbox events",
          postId: POST_ID,
          userId: USER_ID,
          correlationId: "corr-1",
        });
      }

      logger.logError.mockClear();
      outbox.createOutboxEventInTransaction.mockImplementation(() =>
        Promise.reject(new Error("outbox down"))
      );
      await expect(
        deletePost({ id: POST_ID, userId: USER_ID })
      ).rejects.toThrow("outbox down");
      expect(logger.logError.mock.calls[0]?.[0].message).toBe("outbox down");
    });
  });

  describe("reschedulePost", () => {
    it("requires a usable schedule time", () => {
      expect(() =>
        reschedulePost({
          id: POST_ID,
          userId: USER_ID,
          scheduledAtUtc: asDate("bad"),
          overrideQueue: false,
        })
      ).toThrow("reschedulePost: scheduledAtUtc is required");
      expect(prismaMock.post.update).not.toHaveBeenCalled();
    });

    it("clears signatures when a replacement pair is incomplete", async () => {
      const signed = signedEvent();
      await reschedulePost({
        id: POST_ID,
        userId: USER_ID,
        scheduledAtUtc: SCHEDULED_AT,
        overrideQueue: true,
        signedEvent: signed,
        queueTypeId: null,
      });
      let data = updatedData();
      expect(data["scheduledAtUtc"]).toBe(SCHEDULED_AT);
      expect(data["manual_override"]).toBe(true);
      expect(data["signedEvent"]).toBe(Prisma.DbNull);
      expect(data["nostrEvent"]).toBe(Prisma.DbNull);
      expect(data["nostrEventId"]).toBeNull();
      expect(data["queueType"]).toEqual({ disconnect: true });
      expect(data["queueHoldStatus"]).toBe("NONE");
      expect(data["updatedAt"]).toBeInstanceOf(Date);

      await reschedulePost({
        id: POST_ID,
        userId: USER_ID,
        scheduledAtUtc: UNIX,
        overrideQueue: false,
        nostrEvent: nostrEvent(),
        queueTypeId: "",
      });
      data = updatedData();
      expect(data["scheduledAtUtc"]).toEqual(SCHEDULED_AT);
      expect(data["signedEvent"]).toBe(Prisma.DbNull);
      expect(data["queueType"]).toEqual({ disconnect: true });
    });

    it("stores a new signature pair and connects or omits the queue", async () => {
      const signed = signedEvent("next-evt");
      const nostr = nostrEvent();
      await reschedulePost({
        id: POST_ID,
        userId: USER_ID,
        scheduledAtUtc: UNIX,
        overrideQueue: false,
        signedEvent: signed,
        nostrEvent: nostr,
        queueTypeId: "queue-2",
      });
      const connected = updatedData();
      expect(connected["signedEvent"]).toBe(signed);
      expect(connected["nostrEvent"]).toBe(nostr);
      expect(connected["nostrEventId"]).toBe("next-evt");
      expect(connected["queueType"]).toEqual({ connect: { id: "queue-2" } });
      expect(prismaMock.post.update.mock.calls.at(-1)?.[0].where).toEqual({
        id: POST_ID,
        userId: USER_ID,
      });

      await reschedulePost({
        id: POST_ID,
        userId: USER_ID,
        scheduledAtUtc: SCHEDULED_AT,
        overrideQueue: true,
      });
      expect(updatedData()["queueType"]).toBeUndefined();
      expect(updatedData()["signedEvent"]).toBe(Prisma.DbNull);
    });
  });

  describe("updatePost", () => {
    it("touches updatedAt when no editable fields are present", async () => {
      await updatePost({ id: POST_ID, userId: USER_ID, data: {} });
      const data = updatedData();
      expect(Object.keys(data)).toEqual(["updatedAt"]);
      expect(data["updatedAt"]).toBeInstanceOf(Date);
      expect(outbox.createOutboxEvent.mock.calls[0]?.[0]).toBe("POST_UPDATED");
      expect(outbox.createOutboxEvent.mock.calls[0]?.[3]).toEqual({
        postId: POST_ID,
        userId: USER_ID,
      });
    });

    it("writes provided fields and clears a queue hold", async () => {
      const signed = signedEvent();
      const nostr = nostrEvent();
      await updatePost({
        id: POST_ID,
        userId: USER_ID,
        data: {
          content: "next",
          caption: "cap",
          publishedAt: SCHEDULED_AT,
          fileUrl: ["https://cdn.example/a.png"],
          nostrEventId: "evt-9",
          signedEvent: signed,
          nostrEvent: nostr,
          tags: ["tag"],
          isRecyclable: true,
          userId: "user-2",
          hashTagPresetId: "preset-1",
          queueTypeId: "queue-1",
          scheduledAtUtc: UNIX,
          nominalScheduledAtUtc: SCHEDULED_AT,
        },
      });
      const data = updatedData();
      expect(data["content"]).toBe("next");
      expect(data["caption"]).toBe("cap");
      expect(data["publishedAt"]).toEqual(SCHEDULED_AT);
      expect(data["fileUrl"]).toEqual(["https://cdn.example/a.png"]);
      expect(data["nostrEventId"]).toBe("evt-9");
      expect(data["signedEvent"]).toBe(signed);
      expect(data["nostrEvent"]).toBe(nostr);
      expect(data["tags"]).toEqual(["tag"]);
      expect(data["isRecyclable"]).toBe(true);
      expect(data["user"]).toEqual({ connect: { id: "user-2" } });
      expect(data["hashTagPreset"]).toEqual({ connect: { id: "preset-1" } });
      expect(data["queueType"]).toEqual({ connect: { id: "queue-1" } });
      expect(data["scheduledAtUtc"]).toEqual(SCHEDULED_AT);
      expect(data["nominalScheduledAtUtc"]).toEqual(SCHEDULED_AT);
      expect(data["queueHoldStatus"]).toBe("NONE");
      expect(data["queueHeldAtUtc"]).toBeNull();
    });

    it("disconnects relations and clears null schedules", async () => {
      const data: Partial<CreatePostData> & { templateId?: string | null } = {
        scheduledAtUtc: null,
        nominalScheduledAtUtc: null,
        hashTagPresetId: null,
        queueTypeId: null,
        templateId: null,
      };
      await updatePost({ id: POST_ID, userId: USER_ID, data });
      const cleared = updatedData();
      expect(cleared["scheduledAtUtc"]).toBeNull();
      expect(cleared["nominalScheduledAtUtc"]).toBeNull();
      expect(cleared["hashTagPreset"]).toEqual({ disconnect: true });
      expect(cleared["queueType"]).toEqual({ disconnect: true });
      expect(cleared["template"]).toEqual({ disconnect: true });
      expect(cleared["queueHoldStatus"]).toBe("NONE");
      expect(cleared["queueHeldByQueueTypeId"]).toBeNull();

      const template: Partial<CreatePostData> & { templateId?: string | null } =
        { templateId: "tpl-1" };
      await updatePost({ id: POST_ID, userId: USER_ID, data: template });
      expect(updatedData()["template"]).toEqual({ connect: { id: "tpl-1" } });

      const blankTemplate: Partial<CreatePostData> & {
        templateId?: string | null;
      } = { templateId: "" };
      await updatePost({ id: POST_ID, userId: USER_ID, data: blankTemplate });
      expect(updatedData()["template"]).toEqual({ disconnect: true });

      const invalidSchedule: Partial<CreatePostData> = {
        scheduledAtUtc: asDate("bad"),
        nominalScheduledAtUtc: asDate(UNIX),
      };
      await updatePost({ id: POST_ID, userId: USER_ID, data: invalidSchedule });
      expect(updatedData()["scheduledAtUtc"]).toBeNull();
      expect(updatedData()["nominalScheduledAtUtc"]).toEqual(SCHEDULED_AT);

      const falsyNominal: Partial<CreatePostData> = {
        nominalScheduledAtUtc: asDate(0),
      };
      await updatePost({ id: POST_ID, userId: USER_ID, data: falsyNominal });
      expect(updatedData()["nominalScheduledAtUtc"]).toBeNull();

      const presentButUndefined: Partial<CreatePostData> = {};
      Object.assign(presentButUndefined, { queueTypeId: undefined });
      await updatePost({
        id: POST_ID,
        userId: USER_ID,
        data: presentButUndefined,
      });
      expect(updatedData()["queueType"]).toBeUndefined();
      expect(updatedData()["queueHoldStatus"]).toBe("NONE");
    });

    it("still returns the post when the update event fails", async () => {
      outbox.createOutboxEvent.mockImplementationOnce(() =>
        Promise.reject(new Error("outbox failed"))
      );
      await expect(
        updatePost({ id: POST_ID, userId: USER_ID, data: { content: "next" } })
      ).resolves.toMatchObject({ id: POST_ID, userId: USER_ID });
      await Promise.resolve();
      const logged = logger.logError.mock.calls[0];
      if (!logged) throw new Error("expected logError");
      expect(logged[0].message).toBe("outbox failed");
      expect(logged[1]).toEqual({
        message: "Failed to emit POST_UPDATED event",
        postId: POST_ID,
        userId: USER_ID,
      });

      logger.logError.mockClear();
      outbox.createOutboxEvent.mockImplementationOnce(() =>
        Promise.reject("outbox")
      );
      await updatePost({ id: POST_ID, userId: USER_ID, data: {} });
      await Promise.resolve();
      expect(logger.logError.mock.calls[0]?.[0].message).toBe("outbox");
    });
  });

  describe("cloneDraftPost", () => {
    const source = {
      content: "draft body",
      caption: "cap",
      fileUrl: ["https://cdn.example/a.png"],
      postType: "TEXT",
      postKind: "POST",
      draftMeta: { tone: "calm" },
      tags: ["nostr"],
      queueTypeId: "queue-1",
      hashTagPresetId: "preset-1",
      repost: false,
      isQuotedPost: true,
      isRecyclable: true,
      status: "DRAFT",
      manual_override: true,
      repostOfPostId: "repost-src",
      quoteOfPostId: "quote-src",
      quoteOfLongFormPostId: "long-src",
      replyToEventId: "evt",
      replyToPostId: "reply-src",
    };

    it("fails when the draft is missing or over capacity", async () => {
      await expect(cloneDraftPost(USER_ID, "missing")).resolves.toEqual({
        ok: false,
        error: "Draft not found",
      });
      expect(drafts.checkDraftCapacity).not.toHaveBeenCalled();
      expect(prismaMock.post.findFirst.mock.calls[0]?.[0].where).toEqual({
        id: "missing",
        userId: USER_ID,
        currentState: "DRAFT",
      });

      prismaMock.post.findFirst.mockResolvedValueOnce(source);
      drafts.checkDraftCapacity.mockResolvedValueOnce("Draft limit reached");
      await expect(cloneDraftPost(USER_ID, "draft-1")).resolves.toEqual({
        ok: false,
        error: "Draft limit reached",
      });
      expect(prismaMock.post.create).not.toHaveBeenCalled();
    });

    it("copies draft fields and clears schedule and signature state", async () => {
      prismaMock.post.findFirst.mockResolvedValueOnce(source);
      prismaMock.post.create.mockResolvedValueOnce({ id: "clone-1" });
      await expect(cloneDraftPost(USER_ID, "draft-1")).resolves.toEqual({
        ok: true,
        postId: "clone-1",
      });
      expect(drafts.checkDraftCapacity).toHaveBeenCalledWith(USER_ID, 1);
      expect(createdData()).toEqual({
        userId: USER_ID,
        content: "draft body",
        caption: "cap",
        fileUrl: ["https://cdn.example/a.png"],
        postType: "TEXT",
        postKind: "POST",
        draftMeta: { tone: "calm" },
        tags: ["nostr"],
        queueTypeId: "queue-1",
        hashTagPresetId: "preset-1",
        repost: false,
        isQuotedPost: true,
        isRecyclable: true,
        currentState: "DRAFT",
        status: "DRAFT",
        manual_override: true,
        signedEvent: Prisma.JsonNull,
        nostrEvent: Prisma.JsonNull,
        nostrEventId: null,
        scheduledAtUtc: null,
        nominalScheduledAtUtc: null,
        publishedAt: null,
        draftGroupId: null,
        threadGroupId: null,
        repostOfPostId: "repost-src",
        quoteOfPostId: "quote-src",
        quoteOfLongFormPostId: "long-src",
        replyToEventId: "evt",
        replyToPostId: "reply-src",
        parentScheduledActionId: null,
        rootScheduledActionId: null,
        targetScheduledActionId: null,
        dependencyMode: "standalone",
        targetMode: "direct",
        followUpTimingMode: null,
        followUpOffsetSeconds: null,
        expectedParentEventId: null,
        signedChildEventId: null,
        signingState: "unsigned",
      });

      prismaMock.post.findFirst.mockResolvedValueOnce({
        ...source,
        draftMeta: null,
      });
      prismaMock.post.create.mockResolvedValueOnce({ id: "clone-2" });
      await expect(cloneDraftPost(USER_ID, "draft-1")).resolves.toEqual({
        ok: true,
        postId: "clone-2",
      });
      expect(createdData()["draftMeta"]).toBe(Prisma.JsonNull);
    });
  });
});
