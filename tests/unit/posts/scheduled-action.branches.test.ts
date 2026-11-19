// @ts-nocheck -- mocked collaborators are narrower than the production types.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface SourcePost {
  id: string;
  postType: string;
  queueTypeId: string | null;
  currentState: string;
  nostrEventId: string | null;
  signedEvent: unknown;
  rootScheduledActionId: string | null;
  postKind?: string | null;
  repost?: boolean | null;
  isQuotedPost?: boolean | null;
}

interface FollowUpInput {
  userId: string;
  content: string;
  caption: string;
  postType: string;
  queueTypeId: string | null;
  dependencyMode?: string;
  targetMode?: string;
  postKind?: string;
  repost?: boolean;
  isQuotedPost?: boolean;
  repostOfPostId?: string;
  quoteOfPostId?: string;
  parentScheduledActionId?: string;
  rootScheduledActionId?: string;
  targetScheduledActionId?: string;
  expectedParentEventId?: string;
  followUpTimingMode?: string;
  signingState?: string;
  signedChildEventId?: string;
  creationIdempotencyKey?: string;
  repostConditions?: Record<string, number> | null;
}

interface RouteBody {
  status: number;
  body: Record<string, unknown>;
}

const caps = vi.hoisted(() => {
  class ScheduleCapExceededError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ScheduleCapExceededError";
    }
  }
  return {
    ScheduleCapExceededError,
    assertScheduleCapacity: vi.fn(
      async (_userId: string, _count: number): Promise<void> => undefined
    ),
  };
});

const postsApi = vi.hoisted(() => ({
  createPostWithOutbox: vi.fn(
    async (_input: FollowUpInput, _unix: number): Promise<{ id: string }> => ({
      id: "created-1",
    })
  ),
  deletePost: vi.fn(
    async (_input: {
      id: string;
      userId: string;
    }): Promise<{ id: string } | null> => ({ id: "deleted" })
  ),
  deleteLongFormPost: vi.fn(
    async (_input: {
      id: string;
      userId: string;
    }): Promise<{ id: string } | null> => ({ id: "deleted-long" })
  ),
  getPostById: vi.fn(
    async (_input: {
      id: string;
      userId: string;
    }): Promise<SourcePost | null> => null
  ),
}));

const idempotency = vi.hoisted(() => ({
  findPostByCreationIdempotencyKey: vi.fn(
    async (
      _key: string
    ): Promise<{
      existing: { id: string } | null;
      columnExists: boolean;
    }> => ({ existing: null, columnExists: true })
  ),
}));

const queues = vi.hoisted(() => ({
  resolveQueueTypeId: vi.fn(
    async (
      _userId: string,
      _queueTypeId: string | null,
      _name: string | null
    ): Promise<string | null> => "queue-default"
  ),
}));

const machine = vi.hoisted(() => ({
  transition: vi.fn(
    async (
      _postId: string,
      _userId: string,
      _state: string,
      _reason: string
    ): Promise<void> => undefined
  ),
}));

const attached = vi.hoisted(() => ({
  cascadeDeleteAttachedFollowups: vi.fn(
    async (input: {
      rootPostId: string;
      userId: string;
    }): Promise<string[]> => [`a-${input.rootPostId}`]
  ),
}));

const standalone = vi.hoisted(() => ({
  cascadeDeleteStandaloneScheduledDependents: vi.fn(
    async (id: string, _userId: string): Promise<string[]> => [`s-${id}`]
  ),
}));

const moveDraft = vi.hoisted(() => ({
  execute: vi.fn(
    async (_input: {
      postId: string;
      userId: string;
    }): Promise<{ moved: boolean }> => ({
      moved: true,
    })
  ),
}));

const moveLongform = vi.hoisted(() => ({
  execute: vi.fn(
    async (_input: {
      postId: string;
      userId: string;
    }): Promise<{ moved: boolean }> => ({
      moved: false,
    })
  ),
}));

vi.mock("~/features/posts/server", () => ({
  createPostWithOutbox: postsApi.createPostWithOutbox,
  deletePost: postsApi.deletePost,
  deleteLongFormPost: postsApi.deleteLongFormPost,
  getPostById: postsApi.getPostById,
}));
vi.mock("~/features/posts/repositories/post-queries-data.server", () => ({
  findPostByCreationIdempotencyKey:
    idempotency.findPostByCreationIdempotencyKey,
}));
vi.mock("~/features/posts/services/queue-type-resolver.server", () => ({
  resolveQueueTypeId: queues.resolveQueueTypeId,
}));
vi.mock("~/features/posts/state-machine/post-state-machine.server", () => ({
  PostStateMachine: class PostStateMachine {
    transition = machine.transition;
  },
}));
vi.mock("~/features/payments/entitlements/schedule-cap-policy.server", () => ({
  assertScheduleCapacity: caps.assertScheduleCapacity,
  ScheduleCapExceededError: caps.ScheduleCapExceededError,
}));
vi.mock(
  "~/features/posts/scheduling/services/attached-followups.server",
  () => ({
    cascadeDeleteAttachedFollowups: attached.cascadeDeleteAttachedFollowups,
  })
);
vi.mock(
  "~/features/posts/repositories/scheduled-standalone-dependents-cascade.server",
  () => ({
    cascadeDeleteStandaloneScheduledDependents:
      standalone.cascadeDeleteStandaloneScheduledDependents,
  })
);
vi.mock(
  "~/features/posts/scheduling/use-cases/move-scheduled-to-draft.use-case.server",
  () => ({
    MoveScheduledToDraftUseCase: class MoveScheduledToDraftUseCase {
      execute = moveDraft.execute;
    },
  })
);
vi.mock("~/features/posts/longform/index.server", () => ({
  MoveScheduledLongFormToDraftUseCase: class MoveScheduledLongFormToDraftUseCase {
    execute = moveLongform.execute;
  },
}));
vi.mock("~/lib/prisma.server", async () => {
  const helpers = await import("../../utils/mock-helpers");
  return { prisma: helpers.createMockPrisma() };
});
vi.mock("~/infra/queue/queue-client.server", () => ({
  redis: {
    status: "ready",
    get: vi.fn(async (_key: string): Promise<null> => null),
    set: vi.fn(async (_key: string, _value: string): Promise<string> => "OK"),
    on: vi.fn(),
  },
}));

import { postFactory } from "../../factories";
import { asRouteResponse } from "../../utils/action-test-helpers";
import { setupFetchMock, TEST_USER_ID } from "../../utils/mock-helpers";

import type { SignedEvent } from "~/features/nostr/types";
import { handleScheduledAction } from "~/features/posts/scheduling/services/scheduled-action.server";
import { generateCreationIdempotencyKey } from "~/lib/idempotency.server";

const USER_ID = TEST_USER_ID;
const WHEN = "1700000000";
const CHAIN_ERROR = "Cannot repost or quote a repost.";
const PARENT_ERROR =
  "Parent scheduled post must be signed before scheduling attached follow-ups.";

function signedEvent(id = "child-event"): SignedEvent {
  return {
    id,
    pubkey: "b".repeat(64),
    created_at: 1_700_000_000,
    kind: 1,
    tags: [],
    content: "body",
    sig: "c".repeat(128),
  };
}

function form(action: string, fields: Record<string, string>): FormData {
  const data = new FormData();
  data.append("_action", action);
  for (const [key, value] of Object.entries(fields)) {
    data.append(key, value);
  }
  return data;
}

async function readRoute(result: unknown): Promise<RouteBody> {
  const response = await asRouteResponse(result);
  const raw: unknown = await response.json();
  const body =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return { status: response.status, body };
}

function followUp(index = 0): FollowUpInput {
  const call = postsApi.createPostWithOutbox.mock.calls[index];
  if (!call) throw new Error(`missing create call ${index}`);
  return call[0];
}

function sourcePost(overrides: Partial<SourcePost> = {}): SourcePost {
  const built = postFactory.scheduled(new Date(1_700_000_000 * 1000), {
    id: overrides.id ?? "src-post",
    postType: "IMAGE",
    queueTypeId: "queue-1",
    postKind: overrides.postKind ?? "POST",
    repost: overrides.repost ?? false,
    isQuotedPost: overrides.isQuotedPost ?? false,
    nostrEventId: overrides.nostrEventId ?? null,
    signedEvent: signedEvent("parent-event"),
  });
  return {
    id: built.id,
    postType: built.postType,
    queueTypeId: built.queueTypeId,
    currentState: built.currentState,
    nostrEventId: overrides.nostrEventId ?? built.nostrEventId,
    signedEvent:
      overrides.signedEvent === undefined
        ? built.signedEvent
        : overrides.signedEvent,
    rootScheduledActionId: overrides.rootScheduledActionId ?? null,
    postKind: built.postKind,
    repost: built.repost,
    isQuotedPost: built.isQuotedPost,
  };
}

describe("scheduled action branches", () => {
  beforeEach(async () => {
    setupFetchMock();
    await import("~/lib/prisma.server");
    await import("~/infra/queue/queue-client.server");
    caps.assertScheduleCapacity.mockReset();
    caps.assertScheduleCapacity.mockResolvedValue(undefined);
    postsApi.createPostWithOutbox.mockReset();
    postsApi.createPostWithOutbox.mockResolvedValue({ id: "created-1" });
    postsApi.deletePost.mockReset();
    postsApi.deletePost.mockResolvedValue({ id: "deleted" });
    postsApi.deleteLongFormPost.mockReset();
    postsApi.deleteLongFormPost.mockResolvedValue({ id: "deleted-long" });
    postsApi.getPostById.mockReset();
    postsApi.getPostById.mockResolvedValue(null);
    idempotency.findPostByCreationIdempotencyKey.mockReset();
    idempotency.findPostByCreationIdempotencyKey.mockResolvedValue({
      existing: null,
      columnExists: true,
    });
    queues.resolveQueueTypeId.mockClear();
    machine.transition.mockClear();
    attached.cascadeDeleteAttachedFollowups.mockClear();
    standalone.cascadeDeleteStandaloneScheduledDependents.mockClear();
    moveDraft.execute.mockReset();
    moveDraft.execute.mockResolvedValue({ moved: true });
    moveLongform.execute.mockReset();
    moveLongform.execute.mockResolvedValue({ moved: false });
  });

  describe("delete arms", () => {
    it("reports a null delete and concatenates cascade ids", async () => {
      postsApi.deletePost.mockResolvedValueOnce(null);
      const deleted = await handleScheduledAction(
        form("delete", { postId: "post-1" }),
        USER_ID
      );
      expect(deleted).toEqual({
        success: true,
        deleted: false,
        cascadeDeletedIds: ["a-post-1", "s-post-1"],
      });
      expect(attached.cascadeDeleteAttachedFollowups).toHaveBeenCalledWith({
        rootPostId: "post-1",
        userId: USER_ID,
      });
      expect(
        standalone.cascadeDeleteStandaloneScheduledDependents
      ).toHaveBeenCalledWith("post-1", USER_ID);

      postsApi.deleteLongFormPost.mockResolvedValueOnce(null);
      const longform = await handleScheduledAction(
        form("deleteLongForm", { postId: "long-1" }),
        USER_ID
      );
      expect(longform).toEqual({
        success: true,
        deleted: false,
        cascadeDeletedIds: ["s-long-1"],
      });
      expect(attached.cascadeDeleteAttachedFollowups).toHaveBeenCalledTimes(1);
    });

    it("counts only non-null bulk deletes and keeps cascade ids", async () => {
      postsApi.deletePost
        .mockResolvedValueOnce({ id: "p1" })
        .mockResolvedValueOnce(null);
      const posts = await handleScheduledAction(
        form("bulkDelete", { postIds: JSON.stringify(["p1", "p2"]) }),
        USER_ID
      );
      expect(posts).toEqual({
        success: true,
        deletedCount: 1,
        cascadeDeletedIds: ["a-p1", "s-p1", "a-p2", "s-p2"],
      });

      postsApi.deleteLongFormPost
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "l2" });
      const longform = await handleScheduledAction(
        form("bulkDeleteLongForm", {
          postIds: JSON.stringify(["l1", "l2"]),
        }),
        USER_ID
      );
      expect(longform).toEqual({
        success: true,
        deletedCount: 1,
        cascadeDeletedIds: ["s-l1", "s-l2"],
      });
    });

    it("deletes mixed rows and skips null results", async () => {
      postsApi.deletePost.mockResolvedValueOnce(null);
      postsApi.deleteLongFormPost.mockResolvedValueOnce({ id: "l1" });
      const result = await handleScheduledAction(
        form("bulkDeleteMixed", {
          itemData: JSON.stringify([
            { id: "p1", type: "post" },
            { id: "l1", type: "longform" },
          ]),
        }),
        USER_ID
      );
      expect(result).toEqual({
        success: true,
        deletedCount: 1,
        cascadeDeletedIds: ["s-p1", "s-l1", "a-p1"],
      });
      expect(postsApi.deletePost).toHaveBeenCalledWith({
        id: "p1",
        userId: USER_ID,
      });
      expect(postsApi.deleteLongFormPost).toHaveBeenCalledWith({
        id: "l1",
        userId: USER_ID,
      });
    });

    it("rejects when a delete dependency throws an Error or a string", async () => {
      postsApi.deletePost.mockRejectedValueOnce(new Error("delete down"));
      await expect(
        handleScheduledAction(form("delete", { postId: "post-1" }), USER_ID)
      ).rejects.toThrow("delete down");

      postsApi.deleteLongFormPost.mockRejectedValueOnce("longform string");
      await expect(
        handleScheduledAction(
          form("deleteLongForm", { postId: "long-1" }),
          USER_ID
        )
      ).rejects.toBe("longform string");

      postsApi.deletePost.mockRejectedValueOnce("bulk string");
      await expect(
        handleScheduledAction(
          form("bulkDelete", { postIds: JSON.stringify(["p1"]) }),
          USER_ID
        )
      ).rejects.toBe("bulk string");

      postsApi.deleteLongFormPost.mockRejectedValueOnce(
        new Error("mixed down")
      );
      await expect(
        handleScheduledAction(
          form("bulkDeleteMixed", {
            itemData: JSON.stringify([{ id: "l1", type: "longform" }]),
          }),
          USER_ID
        )
      ).rejects.toThrow("mixed down");
    });
  });

  describe("moveToDraft", () => {
    it("moves a short post and a longform post", async () => {
      const post = await handleScheduledAction(
        form("moveToDraft", { postId: "post-1", type: "post" }),
        USER_ID
      );
      expect(post).toEqual({ success: true, moved: true });
      expect(moveDraft.execute).toHaveBeenCalledWith({
        postId: "post-1",
        userId: USER_ID,
      });
      expect(moveLongform.execute).not.toHaveBeenCalled();

      const article = await handleScheduledAction(
        form("moveToDraft", { postId: "long-1", type: "longform" }),
        USER_ID
      );
      expect(article).toEqual({ success: true, moved: false });
      expect(moveLongform.execute).toHaveBeenCalledWith({
        postId: "long-1",
        userId: USER_ID,
      });
    });

    it("rejects when a move throws an Error or a string", async () => {
      moveDraft.execute.mockRejectedValueOnce(new Error("move down"));
      await expect(
        handleScheduledAction(
          form("moveToDraft", { postId: "post-1", type: "post" }),
          USER_ID
        )
      ).rejects.toThrow("move down");

      moveLongform.execute.mockRejectedValueOnce("move string");
      await expect(
        handleScheduledAction(
          form("moveToDraft", { postId: "long-1", type: "longform" }),
          USER_ID
        )
      ).rejects.toBe("move string");
    });

    it("returns a validation error for an unknown action or a bad move", async () => {
      const unknown = await readRoute(
        await handleScheduledAction(form("not-an-action", {}), USER_ID)
      );
      expect(unknown.status).toBe(400);

      const missingType = await readRoute(
        await handleScheduledAction(
          form("moveToDraft", { postId: "post-1", type: "article" }),
          USER_ID
        )
      );
      expect(missingType.status).toBe(400);
      expect(moveDraft.execute).not.toHaveBeenCalled();
    });
  });

  describe("scheduleRepost and scheduleQuote", () => {
    function scheduleFields(
      action: "scheduleRepost" | "scheduleQuote",
      extra: Record<string, string>
    ): FormData {
      return form(action, {
        scheduledFor: WHEN,
        signedEvent: JSON.stringify(signedEvent()),
        ...extra,
      });
    }

    it("rejects invalid events, times, and source combinations", async () => {
      const badEvent = await readRoute(
        await handleScheduledAction(
          scheduleFields("scheduleRepost", {
            postId: "src-post",
            signedEvent: "{}",
          }),
          USER_ID
        )
      );
      expect(badEvent.status).toBe(400);
      expect(badEvent.body["error"]).toBe("Invalid signed event");

      const badJson = await readRoute(
        await handleScheduledAction(
          scheduleFields("scheduleQuote", {
            postId: "src-post",
            signedEvent: "{",
          }),
          USER_ID
        )
      );
      expect(badJson.body["error"]).toBe("Invalid signed event");

      const badTime = await readRoute(
        await handleScheduledAction(
          scheduleFields("scheduleRepost", {
            postId: "src-post",
            scheduledFor: " ",
          }),
          USER_ID
        )
      );
      expect(badTime.status).toBe(400);
      expect(badTime.body["error"]).toBe("Invalid scheduled time");

      const both = await readRoute(
        await handleScheduledAction(
          scheduleFields("scheduleQuote", {
            postId: "src-post",
            sourceSignedEvent: JSON.stringify({ kind: 1 }),
          }),
          USER_ID
        )
      );
      expect(both.status).toBe(400);

      const neither = await readRoute(
        await handleScheduledAction(
          scheduleFields("scheduleRepost", {}),
          USER_ID
        )
      );
      expect(neither.status).toBe(400);
      expect(postsApi.createPostWithOutbox).not.toHaveBeenCalled();
    });

    it("returns an existing repost and stops before the cap check", async () => {
      idempotency.findPostByCreationIdempotencyKey.mockResolvedValueOnce({
        existing: { id: "already" },
        columnExists: true,
      });
      const result = await handleScheduledAction(
        scheduleFields("scheduleRepost", { postId: "src-post" }),
        USER_ID
      );
      expect(result).toEqual({ success: true, postId: "already" });
      expect(caps.assertScheduleCapacity).not.toHaveBeenCalled();
      const event = signedEvent();
      expect(idempotency.findPostByCreationIdempotencyKey).toHaveBeenCalledWith(
        generateCreationIdempotencyKey(
          USER_ID,
          `scheduleRepost:${event.id}`,
          Number(WHEN)
        )
      );
    });

    it("returns the cap error and rethrows other cap failures", async () => {
      postsApi.getPostById.mockResolvedValue(sourcePost());
      caps.assertScheduleCapacity.mockRejectedValueOnce(
        new caps.ScheduleCapExceededError("over cap")
      );
      const capped = await readRoute(
        await handleScheduledAction(
          scheduleFields("scheduleRepost", { postId: "src-post" }),
          USER_ID
        )
      );
      expect(capped.status).toBe(403);
      expect(capped.body["error"]).toBe("over cap");

      caps.assertScheduleCapacity.mockRejectedValueOnce(new Error("cap down"));
      await expect(
        handleScheduledAction(
          scheduleFields("scheduleQuote", { postId: "src-post" }),
          USER_ID
        )
      ).rejects.toThrow("cap down");

      caps.assertScheduleCapacity.mockRejectedValueOnce("cap string");
      await expect(
        handleScheduledAction(
          scheduleFields("scheduleRepost", {
            sourceSignedEvent: JSON.stringify({ kind: 1 }),
          }),
          USER_ID
        )
      ).rejects.toBe("cap string");
    });

    it("rejects a missing post, a pure repost, and an unsigned parent", async () => {
      const missing = await readRoute(
        await handleScheduledAction(
          scheduleFields("scheduleRepost", { postId: "  src-post  " }),
          USER_ID
        )
      );
      expect(postsApi.getPostById).toHaveBeenCalledWith({
        id: "src-post",
        userId: USER_ID,
      });
      expect(missing.status).toBe(404);
      expect(missing.body["error"]).toBe("Post not found");

      postsApi.getPostById.mockResolvedValueOnce(
        sourcePost({ postKind: "REPOST", repost: true, isQuotedPost: false })
      );
      const chained = await readRoute(
        await handleScheduledAction(
          scheduleFields("scheduleQuote", { postId: "src-post" }),
          USER_ID
        )
      );
      expect(chained.status).toBe(400);
      expect(chained.body["error"]).toBe(CHAIN_ERROR);

      for (const signed of [null, {}, { id: "" }, []]) {
        postsApi.getPostById.mockResolvedValueOnce(
          sourcePost({
            currentState: "SCHEDULED",
            nostrEventId: null,
            signedEvent: signed,
          })
        );
        const unsigned = await readRoute(
          await handleScheduledAction(
            scheduleFields("scheduleRepost", { postId: "src-post" }),
            USER_ID
          )
        );
        expect(unsigned.status).toBe(400);
        expect(unsigned.body["error"]).toBe(PARENT_ERROR);
      }
      expect(postsApi.createPostWithOutbox).not.toHaveBeenCalled();
    });

    it("attaches a repost to a signed scheduled parent and stores thresholds", async () => {
      postsApi.getPostById.mockResolvedValueOnce(
        sourcePost({
          rootScheduledActionId: "root-9",
          nostrEventId: null,
          signedEvent: signedEvent("parent-event"),
        })
      );
      const result = await handleScheduledAction(
        scheduleFields("scheduleRepost", {
          postId: "src-post",
          minReactions: "0",
          minZaps: "2",
          minComments: "3",
          minReposts: "4",
          minSats: "5",
        }),
        USER_ID
      );
      expect(result).toEqual({ success: true, postId: "created-1" });
      const input = followUp();
      expect(input).toMatchObject({
        userId: USER_ID,
        content: "",
        postType: "IMAGE",
        queueTypeId: "queue-1",
        repost: true,
        postKind: "REPOST",
        repostOfPostId: "src-post",
        dependencyMode: "attached",
        targetMode: "scheduled_parent",
        parentScheduledActionId: "src-post",
        rootScheduledActionId: "root-9",
        targetScheduledActionId: "src-post",
        expectedParentEventId: "parent-event",
        followUpTimingMode: "fixed_datetime",
        signingState: "signed",
        signedChildEventId: "child-event",
        repostConditions: {
          minReactions: 0,
          minZaps: 2,
          minComments: 3,
          minReposts: 4,
          minSats: 5,
        },
      });
      expect(input.creationIdempotencyKey).toBe(
        generateCreationIdempotencyKey(
          USER_ID,
          "scheduleRepost:child-event",
          Number(WHEN)
        )
      );
      expect(postsApi.createPostWithOutbox.mock.calls[0]?.[1]).toBe(
        Number(WHEN)
      );
      expect(machine.transition).toHaveBeenCalledWith(
        "created-1",
        USER_ID,
        "SCHEDULED",
        "Repost created with schedule"
      );
    });

    it("keeps a published or quoted source as a standalone repost", async () => {
      postsApi.getPostById.mockResolvedValueOnce(
        sourcePost({
          nostrEventId: "published-id",
          postKind: "REPOST",
          repost: true,
          isQuotedPost: true,
        })
      );
      idempotency.findPostByCreationIdempotencyKey.mockResolvedValueOnce({
        existing: null,
        columnExists: false,
      });
      await handleScheduledAction(
        scheduleFields("scheduleRepost", { postId: "src-post" }),
        USER_ID
      );
      const input = followUp();
      expect(input.dependencyMode).toBe("standalone");
      expect(input.targetMode).toBe("direct");
      expect(input.expectedParentEventId).toBeUndefined();
      expect(input.creationIdempotencyKey).toBeUndefined();
      expect(input.repostConditions).toBeUndefined();
      expect(input.repostOfPostId).toBe("src-post");
    });

    it("creates a standalone repost or quote from a source event", async () => {
      const repost = await handleScheduledAction(
        scheduleFields("scheduleRepost", {
          sourceSignedEvent: JSON.stringify({ kind: 1 }),
        }),
        USER_ID
      );
      expect(repost).toEqual({ success: true, postId: "created-1" });
      expect(queues.resolveQueueTypeId).toHaveBeenCalledWith(
        USER_ID,
        null,
        null
      );
      expect(followUp()).toMatchObject({
        postType: "TEXT",
        queueTypeId: "queue-default",
        dependencyMode: "standalone",
        targetMode: "direct",
        repost: true,
        postKind: "REPOST",
      });
      expect(followUp().repostOfPostId).toBeUndefined();

      postsApi.createPostWithOutbox.mockClear();
      const quote = await handleScheduledAction(
        scheduleFields("scheduleQuote", {
          sourceSignedEvent: JSON.stringify({ kind: "1" }),
        }),
        USER_ID
      );
      expect(quote).toEqual({ success: true, postId: "created-1" });
      expect(followUp()).toMatchObject({
        content: "",
        caption: "",
        postKind: "QUOTE",
        isQuotedPost: true,
        dependencyMode: "standalone",
      });
    });

    it("rejects a bad source event and a kind-6 source", async () => {
      const empty = await readRoute(
        await handleScheduledAction(
          scheduleFields("scheduleRepost", { sourceSignedEvent: "   " }),
          USER_ID
        )
      );
      expect(empty.status).toBe(400);

      const malformed = await readRoute(
        await handleScheduledAction(
          scheduleFields("scheduleQuote", { sourceSignedEvent: "{" }),
          USER_ID
        )
      );
      expect(malformed.body["error"]).toBe("Invalid source event");

      const noKind = await readRoute(
        await handleScheduledAction(
          scheduleFields("scheduleRepost", {
            sourceSignedEvent: JSON.stringify({ content: "x" }),
          }),
          USER_ID
        )
      );
      expect(noKind.body["error"]).toBe("Invalid source event");

      const badKind = await readRoute(
        await handleScheduledAction(
          scheduleFields("scheduleQuote", {
            sourceSignedEvent: JSON.stringify({ kind: "nope" }),
          }),
          USER_ID
        )
      );
      expect(badKind.body["error"]).toBe("Invalid source event");

      const repostSource = await readRoute(
        await handleScheduledAction(
          scheduleFields("scheduleRepost", {
            sourceSignedEvent: JSON.stringify({ kind: 6 }),
          }),
          USER_ID
        )
      );
      expect(repostSource.status).toBe(400);
      expect(repostSource.body["error"]).toBe(CHAIN_ERROR);

      const quoteSource = await readRoute(
        await handleScheduledAction(
          scheduleFields("scheduleQuote", {
            sourceSignedEvent: JSON.stringify({ kind: 6 }),
          }),
          USER_ID
        )
      );
      expect(quoteSource.body["error"]).toBe(CHAIN_ERROR);
      expect(postsApi.createPostWithOutbox).not.toHaveBeenCalled();
    });

    it("attaches a quote, uses the parent root, and defaults the caption", async () => {
      postsApi.getPostById.mockResolvedValueOnce(
        sourcePost({
          nostrEventId: null,
          rootScheduledActionId: null,
          signedEvent: { id: "from-signed" },
        })
      );
      idempotency.findPostByCreationIdempotencyKey.mockResolvedValueOnce({
        existing: null,
        columnExists: false,
      });
      const result = await handleScheduledAction(
        scheduleFields("scheduleQuote", { postId: "src-post" }),
        USER_ID
      );
      expect(result).toEqual({ success: true, postId: "created-1" });
      const input = followUp();
      expect(input).toMatchObject({
        content: "",
        caption: "",
        postKind: "QUOTE",
        isQuotedPost: true,
        quoteOfPostId: "src-post",
        dependencyMode: "attached",
        rootScheduledActionId: "src-post",
        expectedParentEventId: "from-signed",
        followUpTimingMode: "fixed_datetime",
      });
      expect(input.creationIdempotencyKey).toBeUndefined();

      postsApi.getPostById.mockResolvedValueOnce(
        sourcePost({ nostrEventId: "published-id" })
      );
      postsApi.createPostWithOutbox.mockClear();
      await handleScheduledAction(
        scheduleFields("scheduleQuote", {
          postId: "src-post",
          quoteCaption: "a quote",
        }),
        USER_ID
      );
      expect(followUp()).toMatchObject({
        content: "a quote",
        caption: "a quote",
        dependencyMode: "standalone",
        targetMode: "direct",
      });
      expect(machine.transition).toHaveBeenCalledWith(
        "created-1",
        USER_ID,
        "SCHEDULED",
        "Quote post created with schedule"
      );
    });

    it("rejects quote scheduling when the parent signature cannot be read", async () => {
      postsApi.getPostById.mockResolvedValueOnce(
        sourcePost({
          currentState: "SCHEDULED",
          nostrEventId: null,
          signedEvent: { id: 12 },
        })
      );
      const result = await readRoute(
        await handleScheduledAction(
          scheduleFields("scheduleQuote", { postId: "src-post" }),
          USER_ID
        )
      );
      expect(result.status).toBe(400);
      expect(result.body["error"]).toBe(PARENT_ERROR);
      expect(postsApi.createPostWithOutbox).not.toHaveBeenCalled();
    });
  });
});
