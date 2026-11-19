import { beforeEach, describe, expect, it, vi } from "vitest";

interface DashboardPost {
  id: string;
  userId?: string;
  queueType?: unknown;
  signedEvent?: unknown;
  nostrEvent?: unknown;
  caption?: string;
  scheduledAtUtc?: Date | null;
  currentState?: string;
  parentScheduledActionId?: string | null;
}

interface RescheduleArgs {
  id: string;
  userId: string;
  scheduledAtUtc: number;
  overrideQueue: boolean;
  queueTypeId: string | null;
  signedEvent: unknown;
  nostrEvent: unknown;
}

interface UpdateArgs {
  id: string;
  userId: string;
  data: {
    caption: string;
    fileUrl: string[];
    tags: string[];
    queueTypeId: string | null;
    scheduledAtUtc?: number;
    signedEvent?: unknown;
    nostrEvent?: unknown;
    hashTagPresetId: string | null;
  };
}

interface LongformUpdate {
  id: string;
  userId: string;
  title?: string;
  summary?: string;
  content?: string;
  image?: string;
  publishedAt?: Date;
  status?: string;
  signedEvent?: unknown;
  nostrEvent?: unknown;
}

interface ScheduleArgs {
  postId: string;
  userId: string;
  signedEvent: { id?: string };
}

interface RouteBody {
  status: number;
  body: Record<string, unknown>;
}

const postsApi = vi.hoisted(() => ({
  getScheduledPosts: vi.fn(
    async (_args: { userId: string; queueType: string }): Promise<unknown> => ({
      posts: [],
    })
  ),
  getScheduledLongFormPosts: vi.fn(
    async (_args: { userId: string; queueType: string }): Promise<unknown> => ({
      posts: [],
    })
  ),
  getPostById: vi.fn(
    async (_args: {
      id: string;
      userId: string;
    }): Promise<DashboardPost | null> => null
  ),
  getLongFormPost: vi.fn(
    async (_args: {
      id: string;
      userId: string;
    }): Promise<DashboardPost | null> => null
  ),
  deletePost: vi.fn(
    async (_args: { id: string; userId: string }): Promise<void> => undefined
  ),
  deleteLongFormPost: vi.fn(
    async (_args: { id: string; userId: string }): Promise<void> => undefined
  ),
  reschedulePost: vi.fn(
    async (args: RescheduleArgs): Promise<DashboardPost> => ({
      id: args.id,
      scheduledAtUtc: new Date(args.scheduledAtUtc * 1000),
    })
  ),
  updatePost: vi.fn(async (args: UpdateArgs): Promise<DashboardPost> => ({
    id: args.id,
  })),
  updateLongFormPost: vi.fn(
    async (args: LongformUpdate): Promise<DashboardPost> => ({ id: args.id })
  ),
}));

const users = vi.hoisted(() => ({
  getUserById: vi.fn(async (userId: string): Promise<{ id: string }> => ({
    id: userId,
  })),
  getQueueTypes: vi.fn(async (_userId: string): Promise<unknown> => []),
  getUserHashTagPresets: vi.fn(async (_userId: string): Promise<unknown> => []),
}));

const caps = vi.hoisted(() => ({
  assertScheduleCapacity: vi.fn(
    async (_userId: string, _slots: number): Promise<void> => undefined
  ),
}));

const schedulePost = vi.hoisted(() => ({
  execute: vi.fn(async (_args: ScheduleArgs): Promise<void> => undefined),
}));

const scheduleLongform = vi.hoisted(() => ({
  execute: vi.fn(async (_args: ScheduleArgs): Promise<void> => undefined),
}));

const followups = vi.hoisted(() => ({
  cascadeDeleteAttachedFollowups: vi.fn(
    async (_args: {
      rootPostId: string;
      userId: string;
    }): Promise<string[]> => []
  ),
  cascadeAttachedReschedule: vi.fn(
    async (_args: {
      rootPostId: string;
      userId: string;
      parentScheduledAtUtc: Date;
    }): Promise<string[]> => []
  ),
  resyncAttachedChildrenAfterParentMutation: vi.fn(
    async (_args: {
      parentPostId: string;
      userId: string;
      parentPredictedEventId: string | null;
    }): Promise<string[]> => []
  ),
}));

const logger = vi.hoisted(() => ({
  logError: vi.fn(
    (_error: unknown, _context?: Record<string, unknown>): void => undefined
  ),
}));

vi.mock("~/features/posts/server", () => ({
  getScheduledPosts: postsApi.getScheduledPosts,
  getScheduledLongFormPosts: postsApi.getScheduledLongFormPosts,
  getPostById: postsApi.getPostById,
  getLongFormPost: postsApi.getLongFormPost,
  deletePost: postsApi.deletePost,
  deleteLongFormPost: postsApi.deleteLongFormPost,
  reschedulePost: postsApi.reschedulePost,
  updatePost: postsApi.updatePost,
  updateLongFormPost: postsApi.updateLongFormPost,
}));
vi.mock("~/features/user", () => users);
vi.mock("~/features/payments/entitlements/schedule-cap-policy.server", () => ({
  assertScheduleCapacity: caps.assertScheduleCapacity,
}));
vi.mock(
  "~/features/posts/scheduling/use-cases/schedule-post.use-case.server",
  () => ({
    SchedulePostUseCase: class SchedulePostUseCase {
      execute = schedulePost.execute;
    },
  })
);
vi.mock("~/features/posts/longform/index.server", () => ({
  ScheduleLongFormPostUseCase: class ScheduleLongFormPostUseCase {
    execute = scheduleLongform.execute;
  },
}));
vi.mock(
  "~/features/posts/scheduling/services/attached-followups.server",
  () => ({
    cascadeDeleteAttachedFollowups: followups.cascadeDeleteAttachedFollowups,
    cascadeAttachedReschedule: followups.cascadeAttachedReschedule,
    resyncAttachedChildrenAfterParentMutation:
      followups.resyncAttachedChildrenAfterParentMutation,
  })
);
vi.mock("~/lib/error-logger.server", () => logger);
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

import { asRouteResponse } from "../../utils/action-test-helpers";
import {
  createMockPost,
  createMockQueueType,
  setupFetchMock,
  TEST_USER_ID,
} from "../../utils/mock-helpers";

import {
  getScheduledDashboardData,
  handleScheduledPostAction,
} from "~/features/posts/scheduling/services/scheduled-posts.server";

const USER_ID = TEST_USER_ID;
const WHEN = "1704110400";
const SIGNED = {
  id: "event-1",
  pubkey: "pk",
  created_at: 1_704_110_400,
  kind: 1,
  content: "hello",
  tags: [] as string[][],
  sig: "sig",
};
const NOSTR = {
  id: "event-1",
  pubkey: "pk",
  created_at: 1_704_110_400,
  kind: 1,
  content: "hello",
  tags: [] as string[][],
};

function form(action: string, fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.append("_action", action);
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
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

function queueRow(status: string) {
  return {
    ...createMockQueueType({ id: `q-${status}`, name: status }),
    userId: USER_ID,
    scheduleConfig: null,
    status,
  };
}

describe("scheduled posts branches", () => {
  beforeEach(async () => {
    setupFetchMock();
    await import("~/lib/prisma.server");
    await import("~/infra/queue/queue-client.server");
    postsApi.getScheduledPosts.mockReset();
    postsApi.getScheduledPosts.mockResolvedValue({ posts: [] });
    postsApi.getScheduledLongFormPosts.mockReset();
    postsApi.getScheduledLongFormPosts.mockResolvedValue({ posts: [] });
    postsApi.getPostById.mockReset();
    postsApi.getPostById.mockResolvedValue(null);
    postsApi.getLongFormPost.mockReset();
    postsApi.getLongFormPost.mockResolvedValue(null);
    postsApi.deletePost.mockReset();
    postsApi.deleteLongFormPost.mockReset();
    postsApi.reschedulePost.mockReset();
    postsApi.reschedulePost.mockImplementation(
      async (args: RescheduleArgs) => ({
        id: args.id,
        scheduledAtUtc: new Date(args.scheduledAtUtc * 1000),
      })
    );
    postsApi.updatePost.mockReset();
    postsApi.updatePost.mockImplementation(async (args: UpdateArgs) => ({
      id: args.id,
    }));
    postsApi.updateLongFormPost.mockReset();
    postsApi.updateLongFormPost.mockImplementation(
      async (args: LongformUpdate) => ({
        id: args.id,
      })
    );
    users.getUserById.mockReset();
    users.getUserById.mockImplementation(async (userId: string) => ({
      id: userId,
    }));
    users.getQueueTypes.mockReset();
    users.getQueueTypes.mockResolvedValue([]);
    users.getUserHashTagPresets.mockReset();
    users.getUserHashTagPresets.mockResolvedValue([]);
    caps.assertScheduleCapacity.mockReset();
    caps.assertScheduleCapacity.mockResolvedValue(undefined);
    schedulePost.execute.mockReset();
    scheduleLongform.execute.mockReset();
    followups.cascadeDeleteAttachedFollowups.mockClear();
    followups.cascadeAttachedReschedule.mockClear();
    followups.resyncAttachedChildrenAfterParentMutation.mockClear();
    logger.logError.mockReset();
  });

  describe("getScheduledDashboardData", () => {
    it("uses empty lists when rows are missing or not arrays", async () => {
      postsApi.getScheduledPosts.mockResolvedValueOnce({ total: 0 });
      postsApi.getScheduledLongFormPosts.mockResolvedValueOnce({ posts: null });
      users.getQueueTypes.mockResolvedValueOnce(null);
      users.getUserHashTagPresets.mockResolvedValueOnce("presets");
      const empty = await getScheduledDashboardData({
        userId: USER_ID,
        queueType: "all",
      });
      expect(empty.posts).toEqual([]);
      expect(empty.longformPosts).toEqual([]);
      expect(empty.allContent).toEqual([]);
      expect(empty.queueTypes).toEqual([]);
      expect(empty.hashTagPresets).toEqual([]);
      expect(empty.user).toEqual({ id: USER_ID });
      expect(postsApi.getScheduledPosts).toHaveBeenCalledWith({
        userId: USER_ID,
        queueType: "all",
      });

      postsApi.getScheduledPosts.mockResolvedValueOnce({ posts: "nope" });
      postsApi.getScheduledLongFormPosts.mockResolvedValueOnce({ posts: {} });
      const stillEmpty = await getScheduledDashboardData({
        userId: USER_ID,
        queueType: "queue",
      });
      expect(stillEmpty.posts).toEqual([]);
      expect(stillEmpty.longformPosts).toEqual([]);
      expect(stillEmpty.selectedQueueType).toBe("queue");
    });

    it("maps posts, drops a longform queue, and hides archived queues", async () => {
      const post = {
        ...createMockPost({ id: "p1", content: "hello" }),
        queueType: {
          ...queueRow("active"),
          id: "q-active",
          name: "Active",
        },
        signedEvent: { id: "signed-1" },
        nostrEvent: { id: "nostr-1" },
      };
      postsApi.getScheduledPosts.mockResolvedValueOnce({ posts: [post] });
      postsApi.getScheduledLongFormPosts.mockResolvedValueOnce({
        posts: [
          { id: "lf1", userId: USER_ID, title: "Article", content: "Body" },
        ],
      });
      users.getQueueTypes.mockResolvedValueOnce([
        queueRow("active"),
        queueRow("archived"),
        queueRow("paused"),
        null,
        "not-a-queue",
      ]);
      users.getUserHashTagPresets.mockResolvedValueOnce([{ id: "preset-1" }]);

      const result = await getScheduledDashboardData({
        userId: USER_ID,
        queueType: "Active",
      });
      expect(result.posts).toHaveLength(1);
      expect(result.longformPosts).toEqual([
        { id: "lf1", userId: USER_ID, title: "Article", content: "Body" },
      ]);
      expect(result.allContent.map((item) => item.id)).toEqual(["p1", "lf1"]);
      expect(result.queueTypes.map((queue) => queue.name)).toEqual([
        "active",
        "paused",
      ]);
      expect(result.hashTagPresets).toEqual([{ id: "preset-1" }]);
      const combinedPost = result.allContent[0];
      expect(combinedPost?.queueType?.id).toBe("q-active");
      expect(combinedPost?.queueType?.name).toBe("Active");
    });

    it("rejects when a dashboard dependency throws an Error or a string", async () => {
      postsApi.getScheduledPosts.mockRejectedValueOnce(new Error("posts down"));
      await expect(
        getScheduledDashboardData({ userId: USER_ID, queueType: "all" })
      ).rejects.toThrow("posts down");

      users.getUserById.mockRejectedValueOnce("user string");
      await expect(
        getScheduledDashboardData({ userId: USER_ID, queueType: "all" })
      ).rejects.toBe("user string");
    });
  });

  describe("delete actions", () => {
    it("deletes one post, one article, and empty or invalid id lists", async () => {
      expect(
        await handleScheduledPostAction(
          form("delete", { postId: "p1" }),
          USER_ID
        )
      ).toEqual({ success: true });
      expect(followups.cascadeDeleteAttachedFollowups).toHaveBeenCalledWith({
        rootPostId: "p1",
        userId: USER_ID,
      });
      expect(postsApi.deletePost).toHaveBeenCalledWith({
        id: "p1",
        userId: USER_ID,
      });

      expect(
        await handleScheduledPostAction(
          form("deleteLongForm", { postId: "l1" }),
          USER_ID
        )
      ).toEqual({ success: true });
      expect(postsApi.deleteLongFormPost).toHaveBeenCalledWith({
        id: "l1",
        userId: USER_ID,
      });

      postsApi.deletePost.mockClear();
      expect(
        await handleScheduledPostAction(
          form("bulkDelete", { postIds: "[]" }),
          USER_ID
        )
      ).toEqual({ success: true });
      expect(
        await handleScheduledPostAction(
          form("bulkDelete", { postIds: "not-json" }),
          USER_ID
        )
      ).toEqual({ success: true });
      expect(postsApi.deletePost).not.toHaveBeenCalled();

      await handleScheduledPostAction(
        form("bulkDelete", { postIds: JSON.stringify([1, "p2", null]) }),
        USER_ID
      );
      expect(postsApi.deletePost).toHaveBeenCalledTimes(1);
      expect(postsApi.deletePost).toHaveBeenCalledWith({
        id: "p2",
        userId: USER_ID,
      });
    });

    it("deletes mixed rows and ignores malformed item data", async () => {
      await handleScheduledPostAction(
        form("bulkDeleteMixed", {
          itemData: JSON.stringify([
            { id: "p1", type: "post" },
            { id: "l1", type: "longform" },
            { id: 3, type: "post" },
            "nope",
            { id: "x", type: "other" },
          ]),
        }),
        USER_ID
      );
      expect(postsApi.deletePost).toHaveBeenCalledWith({
        id: "p1",
        userId: USER_ID,
      });
      expect(postsApi.deleteLongFormPost).toHaveBeenCalledWith({
        id: "l1",
        userId: USER_ID,
      });
      expect(postsApi.deleteLongFormPost).toHaveBeenCalledWith({
        id: "x",
        userId: USER_ID,
      });
      expect(followups.cascadeDeleteAttachedFollowups).toHaveBeenCalledTimes(1);

      postsApi.deletePost.mockClear();
      postsApi.deleteLongFormPost.mockClear();
      await handleScheduledPostAction(
        form("bulkDeleteLongForm", { postIds: "{" }),
        USER_ID
      );
      await handleScheduledPostAction(form("bulkDeleteMixed", {}), USER_ID);
      expect(postsApi.deletePost).not.toHaveBeenCalled();
      expect(postsApi.deleteLongFormPost).not.toHaveBeenCalled();
    });

    it("rejects when a delete throws an Error or a string", async () => {
      postsApi.deletePost.mockRejectedValueOnce(new Error("delete down"));
      await expect(
        handleScheduledPostAction(form("delete", { postId: "p1" }), USER_ID)
      ).rejects.toThrow("delete down");

      postsApi.deleteLongFormPost.mockRejectedValueOnce("longform string");
      await expect(
        handleScheduledPostAction(
          form("deleteLongForm", { postId: "l1" }),
          USER_ID
        )
      ).rejects.toBe("longform string");
    });
  });

  describe("reschedule", () => {
    const signedFields = {
      postId: "p1",
      newTime: WHEN,
      signedEvent: JSON.stringify(SIGNED),
      nostrEvent: JSON.stringify(NOSTR),
    };

    it("rejects missing fields and a missing post", async () => {
      const missing = await readRoute(
        await handleScheduledPostAction(
          form("reschedule", { postId: "p1" }),
          USER_ID
        )
      );
      expect(missing.status).toBe(400);
      expect(missing.body["error"]).toBe("Missing required fields");

      const absent = await readRoute(
        await handleScheduledPostAction(
          form("reschedule", signedFields),
          USER_ID
        )
      );
      expect(absent.status).toBe(404);
      expect(absent.body["error"]).toBe("Post not found");
      expect(postsApi.reschedulePost).not.toHaveBeenCalled();
    });

    it("rejects a follow-up scheduled before its parent and allows the parent time", async () => {
      const parentUnix = Number(WHEN);
      postsApi.getPostById.mockImplementation(async (args: { id: string }) => {
        if (args.id === "parent") {
          return { id: "parent", scheduledAtUtc: new Date(parentUnix * 1000) };
        }
        return {
          id: "p1",
          parentScheduledActionId: "parent",
        };
      });
      const early = await readRoute(
        await handleScheduledPostAction(
          form("reschedule", {
            ...signedFields,
            newTime: String(parentUnix - 1),
          }),
          USER_ID
        )
      );
      expect(early.status).toBe(400);
      expect(early.body["error"]).toBe(
        "Follow-up must be scheduled at or after the parent post."
      );
      expect(postsApi.reschedulePost).not.toHaveBeenCalled();

      const sameTime = await handleScheduledPostAction(
        form("reschedule", signedFields),
        USER_ID
      );
      expect(sameTime).toMatchObject({ success: true, signed: true });
      expect(postsApi.reschedulePost).toHaveBeenCalled();
    });

    it("continues when the parent row or its time is missing", async () => {
      postsApi.getPostById.mockImplementation(async (args: { id: string }) => {
        if (args.id === "parent") return null;
        return { id: "p1", parentScheduledActionId: "parent" };
      });
      const missingParent = await handleScheduledPostAction(
        form("reschedule", signedFields),
        USER_ID
      );
      expect(missingParent).toMatchObject({ success: true, signed: true });

      postsApi.getPostById.mockImplementation(async () => ({
        id: "p1",
        parentScheduledActionId: "parent",
      }));
      postsApi.getPostById.mockImplementation(async (args: { id: string }) => {
        if (args.id === "parent") return { id: "parent", scheduledAtUtc: null };
        return { id: "p1", parentScheduledActionId: "parent" };
      });
      const noTime = await handleScheduledPostAction(
        form("reschedule", signedFields),
        USER_ID
      );
      expect(noTime).toMatchObject({ success: true });
    });

    it("signs, asks for a signature, and falls back when the saved time is empty", async () => {
      postsApi.getPostById.mockResolvedValue({ id: "p1" });
      postsApi.reschedulePost.mockResolvedValueOnce({
        id: "p1",
        scheduledAtUtc: null,
      });
      const signed = await handleScheduledPostAction(
        form("reschedule", {
          ...signedFields,
          overrideQueue: "true",
          queueTypeId: "queue-9",
        }),
        USER_ID
      );
      expect(signed).toMatchObject({
        success: true,
        signed: true,
        post: { id: "p1" },
      });
      const args = postsApi.reschedulePost.mock.calls[0]?.[0];
      expect(args).toMatchObject({
        id: "p1",
        userId: USER_ID,
        scheduledAtUtc: Number(WHEN),
        overrideQueue: true,
        queueTypeId: "queue-9",
        signedEvent: SIGNED,
        nostrEvent: NOSTR,
      });
      const scheduleArgs = schedulePost.execute.mock.calls[0]?.[0];
      expect(scheduleArgs?.postId).toBe("p1");
      expect(scheduleArgs?.userId).toBe(USER_ID);
      expect(scheduleArgs?.signedEvent).toEqual(SIGNED);
      expect(typeof scheduleArgs?.scheduledAtUtc).toBe("object");
      const cascade = followups.cascadeAttachedReschedule.mock.calls[0]?.[0];
      expect(cascade?.parentScheduledAtUtc).toEqual(
        new Date(Number(WHEN) * 1000)
      );
      expect(
        followups.resyncAttachedChildrenAfterParentMutation
      ).toHaveBeenCalledWith({
        parentPostId: "p1",
        userId: USER_ID,
        parentPredictedEventId: "event-1",
      });

      schedulePost.execute.mockClear();
      const unsigned = await handleScheduledPostAction(
        form("reschedule", {
          postId: "p1",
          newTime: WHEN,
          overrideQueue: "false",
        }),
        USER_ID
      );
      expect(unsigned).toMatchObject({ success: true, needsSigning: true });
      expect(schedulePost.execute).not.toHaveBeenCalled();
      expect(postsApi.reschedulePost.mock.calls.at(-1)?.[0].overrideQueue).toBe(
        false
      );
    });

    it("logs bad signed payloads and still returns needsSigning", async () => {
      postsApi.getPostById.mockResolvedValue({ id: "p1" });
      const invalid = await handleScheduledPostAction(
        form("reschedule", {
          postId: "p1",
          newTime: WHEN,
          signedEvent: "{",
          nostrEvent: "{",
        }),
        USER_ID
      );
      expect(invalid).toMatchObject({ success: true, needsSigning: true });
      const logged = logger.logError.mock.calls[0];
      expect(logged?.[0]).toBeInstanceOf(Error);
      expect(logged?.[1]?.["message"]).toBe("Error parsing signed events");

      logger.logError.mockClear();
      schedulePost.execute.mockClear();
      const scalars = await handleScheduledPostAction(
        form("reschedule", {
          postId: "p1",
          newTime: WHEN,
          signedEvent: JSON.stringify("x"),
          nostrEvent: JSON.stringify(0),
        }),
        USER_ID
      );
      expect(scalars).toMatchObject({ needsSigning: true });
      expect(schedulePost.execute).not.toHaveBeenCalled();
      expect(logger.logError).not.toHaveBeenCalled();

      const arrays = await handleScheduledPostAction(
        form("reschedule", {
          postId: "p1",
          newTime: WHEN,
          signedEvent: "[]",
          nostrEvent: "[]",
        }),
        USER_ID
      );
      expect(arrays).toMatchObject({ signed: true });
      expect(schedulePost.execute).toHaveBeenCalled();
    });

    it("rejects when reschedule throws an Error or a string", async () => {
      postsApi.getPostById.mockResolvedValue({ id: "p1" });
      postsApi.reschedulePost.mockRejectedValueOnce(
        new Error("reschedule down")
      );
      await expect(
        handleScheduledPostAction(form("reschedule", signedFields), USER_ID)
      ).rejects.toThrow("reschedule down");

      postsApi.reschedulePost.mockRejectedValueOnce("reschedule string");
      await expect(
        handleScheduledPostAction(form("reschedule", signedFields), USER_ID)
      ).rejects.toBe("reschedule string");
    });
  });

  describe("rescheduleLongform", () => {
    it("rejects missing fields and a missing article", async () => {
      const missing = await readRoute(
        await handleScheduledPostAction(
          form("rescheduleLongform", { newTime: WHEN }),
          USER_ID
        )
      );
      expect(missing.status).toBe(400);
      expect(missing.body["error"]).toBe("Missing required fields");

      const absent = await readRoute(
        await handleScheduledPostAction(
          form("rescheduleLongform", { postId: "l1", newTime: WHEN }),
          USER_ID
        )
      );
      expect(absent.status).toBe(404);
      expect(absent.body["error"]).toBe("Article not found");
    });

    it("signs with or without a nostr event, or asks for a signature", async () => {
      postsApi.getLongFormPost.mockResolvedValue({ id: "l1" });
      const signed = await handleScheduledPostAction(
        form("rescheduleLongform", {
          postId: "l1",
          newTime: WHEN,
          signedEvent: JSON.stringify(SIGNED),
          nostrEvent: JSON.stringify(NOSTR),
        }),
        USER_ID
      );
      expect(signed).toMatchObject({ success: true, signed: true });
      const scheduleArgs = scheduleLongform.execute.mock.calls[0]?.[0];
      expect(scheduleArgs?.postId).toBe("l1");
      expect(scheduleArgs?.userId).toBe(USER_ID);
      expect(scheduleArgs?.signedEvent).toEqual(SIGNED);
      expect(typeof scheduleArgs?.scheduledAtUtc).toBe("object");
      expect(postsApi.updateLongFormPost.mock.calls[0]?.[0]).toMatchObject({
        id: "l1",
        userId: USER_ID,
        status: "SCHEDULED",
        signedEvent: SIGNED,
        nostrEvent: NOSTR,
      });

      scheduleLongform.execute.mockClear();
      const signedOnly = await handleScheduledPostAction(
        form("rescheduleLongform", {
          postId: "l1",
          newTime: WHEN,
          signedEvent: JSON.stringify(SIGNED),
          nostrEvent: "null",
        }),
        USER_ID
      );
      expect(signedOnly).toMatchObject({ signed: true });
      expect(
        postsApi.updateLongFormPost.mock.calls.at(-1)?.[0].nostrEvent
      ).toBeUndefined();

      const unsigned = await handleScheduledPostAction(
        form("rescheduleLongform", { postId: "l1", newTime: WHEN }),
        USER_ID
      );
      expect(unsigned).toMatchObject({
        success: true,
        signed: false,
        needsSigning: true,
      });
      expect(scheduleLongform.execute).toHaveBeenCalledTimes(1);
      expect(postsApi.updateLongFormPost.mock.calls.at(-1)?.[0].status).toBe(
        "SCHEDULED"
      );
    });

    it("rejects when the longform update throws an Error or a string", async () => {
      postsApi.getLongFormPost.mockResolvedValue({ id: "l1" });
      postsApi.updateLongFormPost.mockRejectedValueOnce(
        new Error("update down")
      );
      await expect(
        handleScheduledPostAction(
          form("rescheduleLongform", { postId: "l1", newTime: WHEN }),
          USER_ID
        )
      ).rejects.toThrow("update down");

      postsApi.updateLongFormPost.mockRejectedValueOnce("update string");
      await expect(
        handleScheduledPostAction(
          form("rescheduleLongform", {
            postId: "l1",
            newTime: WHEN,
            signedEvent: JSON.stringify(SIGNED),
            nostrEvent: JSON.stringify(NOSTR),
          }),
          USER_ID
        )
      ).rejects.toBe("update string");
    });
  });

  describe("editPost and editLongform", () => {
    it("rejects a missing id or a missing row", async () => {
      const missingPost = await readRoute(
        await handleScheduledPostAction(form("editPost"), USER_ID)
      );
      expect(missingPost.status).toBe(400);
      expect(missingPost.body["error"]).toBe("Missing postId");

      const absentPost = await readRoute(
        await handleScheduledPostAction(
          form("editPost", { postId: "p1" }),
          USER_ID
        )
      );
      expect(absentPost.status).toBe(404);
      expect(absentPost.body["error"]).toBe("Post not found");

      const missingArticle = await readRoute(
        await handleScheduledPostAction(form("editLongform"), USER_ID)
      );
      expect(missingArticle.body["error"]).toBe("Missing postId");

      const absentArticle = await readRoute(
        await handleScheduledPostAction(
          form("editLongform", { postId: "l1" }),
          USER_ID
        )
      );
      expect(absentArticle.status).toBe(404);
      expect(absentArticle.body["error"]).toBe("Article not found");
    });

    it("edits a post across capacity, file, tag, and signature arms", async () => {
      const future = new Date(Date.now() + 86_400_000);
      const past = new Date(Date.now() - 86_400_000);
      postsApi.getPostById.mockResolvedValueOnce({
        id: "p1",
        currentState: "DRAFT",
        scheduledAtUtc: future,
      });
      const drafted = await handleScheduledPostAction(
        form("editPost", {
          postId: "p1",
          caption: "cap",
          fileUrl: JSON.stringify(["https://cdn.example/a.jpg", 2]),
          hashtags: " #a  #b ",
          scheduledFor: WHEN,
          queueTypeId: "queue-1",
          hashTagPresetId: "preset-1",
          signedEvent: JSON.stringify(SIGNED),
          nostrEvent: JSON.stringify(NOSTR),
        }),
        USER_ID
      );
      expect(drafted).toMatchObject({ success: true, signed: true });
      expect(caps.assertScheduleCapacity).toHaveBeenCalledWith(USER_ID, 1);
      expect(postsApi.updatePost.mock.calls[0]?.[0].data).toMatchObject({
        caption: "cap",
        fileUrl: ["https://cdn.example/a.jpg"],
        tags: ["#a", "#b"],
        queueTypeId: "queue-1",
        scheduledAtUtc: Number(WHEN),
        hashTagPresetId: "preset-1",
        signedEvent: SIGNED,
        nostrEvent: NOSTR,
      });
      expect(schedulePost.execute).toHaveBeenCalled();
      expect(followups.cascadeAttachedReschedule).toHaveBeenCalled();

      postsApi.getPostById.mockResolvedValueOnce({
        id: "p1",
        currentState: "SCHEDULED",
        scheduledAtUtc: past,
      });
      caps.assertScheduleCapacity.mockClear();
      schedulePost.execute.mockClear();
      await handleScheduledPostAction(
        form("editPost", {
          postId: "p1",
          scheduledFor: WHEN,
          signedEvent: JSON.stringify(SIGNED),
          nostrEvent: JSON.stringify(NOSTR),
          fileUrl: "not-json",
          hashtags: "",
        }),
        USER_ID
      );
      expect(caps.assertScheduleCapacity).toHaveBeenCalledWith(USER_ID, 1);
      expect(schedulePost.execute).toHaveBeenCalled();
      expect(postsApi.updatePost.mock.calls.at(-1)?.[0].data.fileUrl).toEqual(
        []
      );
      expect(postsApi.updatePost.mock.calls.at(-1)?.[0].data.tags).toEqual([]);
      expect(logger.logError.mock.calls[0]?.[1]?.["message"]).toBe(
        "Error parsing fileUrl"
      );
      expect(
        followups.resyncAttachedChildrenAfterParentMutation
      ).toHaveBeenLastCalledWith({
        parentPostId: "p1",
        userId: USER_ID,
        parentPredictedEventId: "event-1",
      });

      postsApi.getPostById.mockResolvedValueOnce({
        id: "p1",
        currentState: "DRAFT",
      });
      await handleScheduledPostAction(
        form("editPost", { postId: "p1", caption: "unsigned" }),
        USER_ID
      );
      expect(
        followups.resyncAttachedChildrenAfterParentMutation
      ).toHaveBeenLastCalledWith({
        parentPostId: "p1",
        userId: USER_ID,
        parentPredictedEventId: null,
      });
    });

    it("parses a non-array file url and a thrown string from JSON.parse", async () => {
      postsApi.getPostById.mockResolvedValue({
        id: "p1",
        currentState: "DRAFT",
      });
      await handleScheduledPostAction(
        form("editPost", { postId: "p1", fileUrl: "null" }),
        USER_ID
      );
      expect(postsApi.updatePost.mock.calls.at(-1)?.[0].data.fileUrl).toEqual(
        []
      );

      const original = JSON.parse;
      JSON.parse = ((text: string) => {
        if (text === "throw-string") throw "bad file";
        return original(text);
      }) as typeof JSON.parse;
      try {
        await handleScheduledPostAction(
          form("editPost", { postId: "p1", fileUrl: "throw-string" }),
          USER_ID
        );
      } finally {
        JSON.parse = original;
      }
      const stringLog = logger.logError.mock.calls.find(
        (call) => call[1]?.["message"] === "Error parsing fileUrl"
      );
      expect(stringLog?.[0]).toBeInstanceOf(Error);
      expect(stringLog?.[0] instanceof Error ? stringLog[0].message : "").toBe(
        "bad file"
      );
    });

    it("rejects when the schedule cap throws an Error or a string", async () => {
      postsApi.getPostById.mockResolvedValue({
        id: "p1",
        currentState: "DRAFT",
      });
      caps.assertScheduleCapacity.mockRejectedValueOnce(new Error("cap down"));
      await expect(
        handleScheduledPostAction(
          form("editPost", {
            postId: "p1",
            scheduledFor: WHEN,
            signedEvent: JSON.stringify(SIGNED),
            nostrEvent: JSON.stringify(NOSTR),
          }),
          USER_ID
        )
      ).rejects.toThrow("cap down");

      postsApi.getLongFormPost.mockResolvedValue({
        id: "l1",
        currentState: "DRAFT",
      });
      caps.assertScheduleCapacity.mockRejectedValueOnce("cap string");
      await expect(
        handleScheduledPostAction(
          form("editLongform", {
            postId: "l1",
            scheduledFor: WHEN,
          }),
          USER_ID
        )
      ).rejects.toBe("cap string");
    });

    it("edits a longform article across capacity and signature arms", async () => {
      const future = new Date(Date.now() + 86_400_000);
      postsApi.getLongFormPost.mockResolvedValueOnce({
        id: "l1",
        currentState: "SCHEDULED",
        scheduledAtUtc: future,
      });
      const scheduled = await handleScheduledPostAction(
        form("editLongform", {
          postId: "l1",
          title: "Title",
          summary: "Sum",
          content: "Body",
          image: "https://cdn.example/cover.jpg",
          scheduledFor: WHEN,
          signedEvent: JSON.stringify(SIGNED),
          nostrEvent: JSON.stringify(NOSTR),
        }),
        USER_ID
      );
      expect(scheduled).toMatchObject({ success: true, signed: true });
      expect(caps.assertScheduleCapacity).toHaveBeenCalledWith(USER_ID, 0);
      expect(postsApi.updateLongFormPost.mock.calls[0]?.[0]).toMatchObject({
        id: "l1",
        title: "Title",
        summary: "Sum",
        content: "Body",
        image: "https://cdn.example/cover.jpg",
        status: "SCHEDULED",
        signedEvent: SIGNED,
        nostrEvent: NOSTR,
      });
      expect(
        postsApi.updateLongFormPost.mock.calls[0]?.[0].publishedAt
      ).toBeInstanceOf(Date);

      postsApi.getLongFormPost.mockResolvedValueOnce({
        id: "l1",
        currentState: "DRAFT",
        scheduledAtUtc: null,
      });
      caps.assertScheduleCapacity.mockClear();
      const draft = await handleScheduledPostAction(
        form("editLongform", {
          postId: "l1",
          scheduledFor: WHEN,
          signedEvent: JSON.stringify(SIGNED),
          nostrEvent: "null",
        }),
        USER_ID
      );
      expect(draft).toMatchObject({ signed: true });
      expect(caps.assertScheduleCapacity).toHaveBeenCalledWith(USER_ID, 1);
      expect(
        postsApi.updateLongFormPost.mock.calls.at(-1)?.[0].nostrEvent
      ).toBeUndefined();

      caps.assertScheduleCapacity.mockClear();
      postsApi.getLongFormPost.mockResolvedValueOnce({ id: "l1" });
      const plain = await handleScheduledPostAction(
        form("editLongform", { postId: "l1", title: "Only" }),
        USER_ID
      );
      expect(plain).toMatchObject({ success: true, signed: false });
      expect(caps.assertScheduleCapacity).not.toHaveBeenCalled();
      expect(
        postsApi.updateLongFormPost.mock.calls.at(-1)?.[0].publishedAt
      ).toBe(undefined);
    });
  });

  describe("unknown action", () => {
    it("returns 400 for an unknown string and a non-string action", async () => {
      const unknown = await readRoute(
        await handleScheduledPostAction(form("nope"), USER_ID)
      );
      expect(unknown.status).toBe(400);
      expect(unknown.body["error"]).toBe("Invalid action");

      const data = new FormData();
      data.append("_action", new File(["x"], "action.txt"));
      const file = await readRoute(
        await handleScheduledPostAction(data, USER_ID)
      );
      expect(file.status).toBe(400);
      expect(file.body["error"]).toBe("Invalid action");
    });
  });
});
