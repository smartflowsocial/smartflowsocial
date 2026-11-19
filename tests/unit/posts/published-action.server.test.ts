import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireUserId: vi.fn<(request: Request) => Promise<string>>(),
}));

const cascade = vi.hoisted(() => ({
  cascadeDeleteScheduledDependentsForSourcePost:
    vi.fn<(postId: string, userId: string) => Promise<void>>(),
}));

const posts = vi.hoisted(() => ({
  deletePost: vi.fn<(input: { id: string; userId: string }) => Promise<void>>(),
  deleteLongFormPost:
    vi.fn<(input: { id: string; userId: string }) => Promise<void>>(),
  getPostsByIds:
    vi.fn<(input: { ids: string[]; userId: string }) => Promise<unknown[]>>(),
  getLongFormPostsByIds:
    vi.fn<(input: { ids: string[]; userId: string }) => Promise<unknown[]>>(),
}));

const chain = vi.hoisted(() => ({
  isPureRepostSourcePost: vi.fn<(post: unknown) => boolean>(),
}));

const logger = vi.hoisted(() => ({
  logError:
    vi.fn<(error: unknown, context?: Record<string, unknown>) => void>(),
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: {},
}));
vi.mock("~/features/auth/session.server", () => auth);
vi.mock(
  "~/features/posts/repositories/published-scheduled-dependents-cascade.server",
  () => cascade
);
vi.mock("~/features/posts/server", () => posts);
vi.mock("~/features/posts/utils/repost-chain-policy", () => chain);
vi.mock("~/lib/error-logger.server", () => logger);

import { asRouteResponse } from "../../utils/action-test-helpers";

import { publishedPostsAction } from "~/features/posts/published.action.server";

const USER_ID = "user-1";
const RELAY = "wss://relay.primal.net";
const PUBKEY = "ab".repeat(32);
const CHAIN_ERROR = "Cannot repost or quote a repost.";

const boxedPubkey = {
  toString(): string {
    return PUBKEY;
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Response)
  );
}

function postRequest(fields: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return new Request("https://example.test/dashboard/published", {
    method: "POST",
    body: formData,
  });
}

function runAction(fields: Record<string, string>) {
  return publishedPostsAction({ request: postRequest(fields) });
}

async function jsonObject(
  response: Response
): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (!isRecord(body)) {
    throw new Error("expected JSON object");
  }
  return body;
}

async function expectError(
  result: unknown,
  status: number,
  error: unknown
): Promise<void> {
  const response = await asRouteResponse(result);
  expect(response.status).toBe(status);
  const body = await jsonObject(response);
  expect(body["error"]).toEqual(error);
}

async function expectErrorIncludes(
  result: unknown,
  status: number,
  fragment: string
): Promise<void> {
  const response = await asRouteResponse(result);
  expect(response.status).toBe(status);
  const body = await jsonObject(response);
  const error = body["error"];
  if (typeof error !== "string") {
    throw new Error("expected string error");
  }
  expect(error).toContain(fragment);
}

async function expectServerError(
  result: unknown,
  message: string
): Promise<void> {
  const response = await asRouteResponse(result);
  expect(response.status).toBe(500);
  const body = await jsonObject(response);
  expect(body["error"]).toBe(true);
  expect(body["message"]).toBe(message);
}

async function successBody(
  fields: Record<string, string>
): Promise<Record<string, unknown>> {
  const result: unknown = await runAction(fields);
  if (result instanceof Response || !isRecord(result)) {
    throw new Error("expected a plain object result");
  }
  return result;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`expected ${label} to be an object`);
  }
  return value;
}

function expectLogged(
  errorMessage: string,
  context: Record<string, unknown>
): void {
  const call = logger.logError.mock.calls[0];
  if (!call) {
    throw new Error("expected logError to be called");
  }
  const [error, actualContext] = call;
  if (!(error instanceof Error)) {
    throw new Error("expected logged Error");
  }
  expect(error.message).toBe(errorMessage);
  if (!isRecord(actualContext)) {
    throw new Error("expected log context");
  }
  for (const [key, value] of Object.entries(context)) {
    expect(actualContext[key]).toEqual(value);
  }
}

function quoteRow(input: {
  id: string;
  fileUrl: string;
  queueType: string;
  originalCaption: string;
  originalEventId?: string;
  originalEventPubkey?: string;
}): Record<string, unknown> {
  return {
    caption: "",
    fileUrl: input.fileUrl,
    queueType: input.queueType,
    scheduledFor: "",
    originalPostId: input.id,
    originalEventId: input.originalEventId,
    originalEventPubkey: input.originalEventPubkey,
    isQuotePost: true,
    originalCaption: input.originalCaption,
  };
}

const longformScenarios: Array<{
  event: Record<string, unknown>;
  identifier: string;
  eventId: string;
  title: string | null;
  queueTypeId: string | null;
  queueType: string;
  originalTitle: string;
}> = [
  {
    event: {
      id: "evt-lf",
      pubkey: PUBKEY,
      tags: ["skip", ["e", "x"], ["d", 7]],
    },
    identifier: "7",
    eventId: "evt-lf",
    title: "Title",
    queueTypeId: "queue-9",
    queueType: "queue-9",
    originalTitle: "Title",
  },
  {
    event: {
      id: 42,
      pubkey: boxedPubkey,
      tags: [["d", 0]],
    },
    identifier: "",
    eventId: "42",
    title: null,
    queueTypeId: null,
    queueType: "unassigned",
    originalTitle: "",
  },
  {
    event: {
      id: "evt-nod",
      pubkey: PUBKEY,
      tags: [["e", "x"]],
    },
    identifier: "",
    eventId: "evt-nod",
    title: "Nod",
    queueTypeId: "queue-2",
    queueType: "queue-2",
    originalTitle: "Nod",
  },
  {
    event: {
      id: "evt-notags",
      pubkey: PUBKEY,
      tags: { bad: true },
    },
    identifier: "",
    eventId: "evt-notags",
    title: "",
    queueTypeId: "",
    queueType: "",
    originalTitle: "",
  },
];

describe("publishedPostsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserId.mockResolvedValue(USER_ID);
    cascade.cascadeDeleteScheduledDependentsForSourcePost.mockResolvedValue(
      undefined
    );
    posts.deletePost.mockResolvedValue(undefined);
    posts.deleteLongFormPost.mockResolvedValue(undefined);
    posts.getPostsByIds.mockResolvedValue([]);
    posts.getLongFormPostsByIds.mockResolvedValue([]);
    chain.isPureRepostSourcePost.mockReturnValue(false);
  });

  describe("delete", () => {
    it("deletes one post", async () => {
      const result = await successBody({
        _action: "delete",
        postId: "post-1",
      });

      expect(result).toEqual({ success: true });
      expect(
        cascade.cascadeDeleteScheduledDependentsForSourcePost
      ).toHaveBeenCalledWith("post-1", USER_ID);
      expect(posts.deletePost).toHaveBeenCalledWith({
        id: "post-1",
        userId: USER_ID,
      });
      expect(posts.deleteLongFormPost).not.toHaveBeenCalled();
    });

    it("rejects a missing post id", async () => {
      await expectErrorIncludes(
        await runAction({ _action: "delete", postId: "" }),
        400,
        "postId"
      );
      expect(posts.deletePost).not.toHaveBeenCalled();
    });

    it("rejects when delete fails", async () => {
      posts.deletePost.mockRejectedValue(new Error("delete failed"));
      await expect(
        runAction({ _action: "delete", postId: "post-1" })
      ).rejects.toThrow("delete failed");
    });
  });

  describe("deleteLongForm", () => {
    it("deletes one article", async () => {
      const result = await successBody({
        _action: "deleteLongForm",
        postId: "article-1",
      });

      expect(result).toEqual({ success: true });
      expect(
        cascade.cascadeDeleteScheduledDependentsForSourcePost
      ).toHaveBeenCalledWith("article-1", USER_ID);
      expect(posts.deleteLongFormPost).toHaveBeenCalledWith({
        id: "article-1",
        userId: USER_ID,
      });
      expect(posts.deletePost).not.toHaveBeenCalled();
    });

    it("rejects a missing article id", async () => {
      await expectErrorIncludes(
        await runAction({ _action: "deleteLongForm", postId: "" }),
        400,
        "postId"
      );
      expect(posts.deleteLongFormPost).not.toHaveBeenCalled();
    });

    it("rejects when article delete fails", async () => {
      posts.deleteLongFormPost.mockRejectedValue(new Error("delete failed"));
      await expect(
        runAction({ _action: "deleteLongForm", postId: "article-1" })
      ).rejects.toThrow("delete failed");
    });
  });

  describe("bulkDelete", () => {
    it("deletes every post id", async () => {
      const result = await successBody({
        _action: "bulkDelete",
        postIds: JSON.stringify(["post-1", "post-2"]),
      });

      expect(result).toEqual({ success: true });
      expect(
        cascade.cascadeDeleteScheduledDependentsForSourcePost
      ).toHaveBeenCalledWith("post-1", USER_ID);
      expect(
        cascade.cascadeDeleteScheduledDependentsForSourcePost
      ).toHaveBeenCalledWith("post-2", USER_ID);
      expect(posts.deletePost).toHaveBeenCalledWith({
        id: "post-1",
        userId: USER_ID,
      });
      expect(posts.deletePost).toHaveBeenCalledWith({
        id: "post-2",
        userId: USER_ID,
      });
    });

    it("rejects an empty post id list", async () => {
      await expectErrorIncludes(
        await runAction({ _action: "bulkDelete", postIds: "[]" }),
        400,
        "postIds"
      );
      expect(posts.deletePost).not.toHaveBeenCalled();
    });

    it("rejects when one bulk delete fails", async () => {
      posts.deletePost.mockRejectedValue(new Error("delete failed"));
      await expect(
        runAction({
          _action: "bulkDelete",
          postIds: JSON.stringify(["post-1", "post-2"]),
        })
      ).rejects.toThrow("delete failed");
    });
  });

  describe("bulkDeleteLongForm", () => {
    it("deletes every article id", async () => {
      const result = await successBody({
        _action: "bulkDeleteLongForm",
        postIds: JSON.stringify(["article-1", "article-2"]),
      });

      expect(result).toEqual({ success: true });
      expect(posts.deleteLongFormPost).toHaveBeenCalledWith({
        id: "article-1",
        userId: USER_ID,
      });
      expect(posts.deleteLongFormPost).toHaveBeenCalledWith({
        id: "article-2",
        userId: USER_ID,
      });
      expect(posts.deletePost).not.toHaveBeenCalled();
    });

    it("rejects an empty article id list", async () => {
      await expectErrorIncludes(
        await runAction({
          _action: "bulkDeleteLongForm",
          postIds: "[]",
        }),
        400,
        "postIds"
      );
      expect(posts.deleteLongFormPost).not.toHaveBeenCalled();
    });

    it("rejects when one article delete fails", async () => {
      posts.deleteLongFormPost.mockRejectedValue(new Error("delete failed"));
      await expect(
        runAction({
          _action: "bulkDeleteLongForm",
          postIds: JSON.stringify(["article-1"]),
        })
      ).rejects.toThrow("delete failed");
    });
  });

  describe("bulkDeleteMixed", () => {
    it("deletes posts and articles together", async () => {
      const result = await successBody({
        _action: "bulkDeleteMixed",
        itemData: JSON.stringify([
          { id: "post-1", type: "post" },
          { id: "article-1", type: "longform" },
        ]),
      });

      expect(result).toEqual({ success: true });
      expect(posts.deletePost).toHaveBeenCalledWith({
        id: "post-1",
        userId: USER_ID,
      });
      expect(posts.deleteLongFormPost).toHaveBeenCalledWith({
        id: "article-1",
        userId: USER_ID,
      });
      expect(
        cascade.cascadeDeleteScheduledDependentsForSourcePost
      ).toHaveBeenCalledWith("post-1", USER_ID);
      expect(
        cascade.cascadeDeleteScheduledDependentsForSourcePost
      ).toHaveBeenCalledWith("article-1", USER_ID);
    });

    it("rejects an empty mixed selection", async () => {
      await expectErrorIncludes(
        await runAction({ _action: "bulkDeleteMixed", itemData: "[]" }),
        400,
        "itemData"
      );
      expect(posts.deletePost).not.toHaveBeenCalled();
      expect(posts.deleteLongFormPost).not.toHaveBeenCalled();
    });

    it("rejects when a mixed delete fails", async () => {
      posts.deleteLongFormPost.mockRejectedValue(new Error("delete failed"));
      await expect(
        runAction({
          _action: "bulkDeleteMixed",
          itemData: JSON.stringify([{ id: "article-1", type: "longform" }]),
        })
      ).rejects.toThrow("delete failed");
    });
  });

  describe("bulkRepost", () => {
    it("returns the selected posts", async () => {
      const rows = [{ id: "post-1" }, { id: "post-2" }];
      posts.getPostsByIds.mockResolvedValue(rows);

      const result = await successBody({
        _action: "bulkRepost",
        postIds: JSON.stringify(["post-1", "post-2"]),
      });

      expect(result["repostData"]).toBe(rows);
      expect(posts.getPostsByIds).toHaveBeenCalledWith({
        ids: ["post-1", "post-2"],
        userId: USER_ID,
      });
    });

    it("rejects an empty repost selection", async () => {
      await expectErrorIncludes(
        await runAction({ _action: "bulkRepost", postIds: "[]" }),
        400,
        "postIds"
      );
      expect(posts.getPostsByIds).not.toHaveBeenCalled();
    });

    it("rejects a pure repost", async () => {
      chain.isPureRepostSourcePost.mockReturnValue(true);
      posts.getPostsByIds.mockResolvedValue([{ id: "post-1" }]);

      await expectError(
        await runAction({
          _action: "bulkRepost",
          postIds: JSON.stringify(["post-1"]),
        }),
        400,
        CHAIN_ERROR
      );
    });
  });

  describe("bulkScheduledRepost", () => {
    it("returns posts for scheduled reposts", async () => {
      const rows = [{ id: "post-1" }];
      posts.getPostsByIds.mockResolvedValue(rows);

      const result = await successBody({
        _action: "bulkScheduledRepost",
        postIds: JSON.stringify(["post-1"]),
      });

      expect(result["scheduledRepostData"]).toBe(rows);
    });

    it("rejects an empty scheduled repost selection", async () => {
      await expectErrorIncludes(
        await runAction({
          _action: "bulkScheduledRepost",
          postIds: "[]",
        }),
        400,
        "postIds"
      );
    });

    it("rejects a pure repost", async () => {
      chain.isPureRepostSourcePost.mockReturnValue(true);
      posts.getPostsByIds.mockResolvedValue([{ id: "post-1" }]);

      await expectError(
        await runAction({
          _action: "bulkScheduledRepost",
          postIds: JSON.stringify(["post-1"]),
        }),
        400,
        CHAIN_ERROR
      );
    });
  });

  describe("bulkQuote", () => {
    it("maps quote fields from mixed post shapes", async () => {
      posts.getPostsByIds.mockResolvedValue([
        {
          id: "p-full",
          fileUrl: ["https://cdn/a.png", "https://cdn/b.png"],
          caption: "hello",
          queueTypeId: "queue-1",
          signedEvent: { id: "evt-full", pubkey: "pub-full" },
        },
        {
          id: "p-empty",
          fileUrl: [],
          caption: "",
          queueTypeId: "",
          signedEvent: { id: "evt-empty", pubkey: "pub-empty" },
        },
        {
          id: "p-string-file",
          fileUrl: "https://plain",
          caption: "cap",
          queueTypeId: "queue-2",
          signedEvent: null,
        },
        {
          id: "p-bad",
          fileUrl: 12,
          caption: 12,
          queueTypeId: 12,
          signedEvent: ["array"],
        },
        {
          id: "p-numbers",
          fileUrl: ["https://only"],
          caption: "x",
          queueTypeId: "queue-3",
          signedEvent: { id: 5, pubkey: 6 },
        },
        {
          id: "p-id-only",
          fileUrl: ["https://id"],
          caption: "y",
          queueTypeId: "queue-4",
          signedEvent: { id: "evt-id" },
        },
        {
          id: "p-pub-only",
          fileUrl: ["https://pub"],
          caption: "z",
          queueTypeId: "queue-5",
          signedEvent: { pubkey: "pub-only" },
        },
        {
          id: "p-string-event",
          fileUrl: ["https://str"],
          caption: "s",
          queueTypeId: "queue-6",
          signedEvent: "event",
        },
      ]);

      const result = await successBody({
        _action: "bulkQuote",
        postIds: JSON.stringify(["p-full"]),
      });

      expect(result["quotePostData"]).toEqual([
        quoteRow({
          id: "p-full",
          fileUrl: "https://cdn/a.png",
          queueType: "queue-1",
          originalCaption: "hello",
          originalEventId: "evt-full",
          originalEventPubkey: "pub-full",
        }),
        quoteRow({
          id: "p-empty",
          fileUrl: "",
          queueType: "",
          originalCaption: "",
          originalEventId: "evt-empty",
          originalEventPubkey: "pub-empty",
        }),
        quoteRow({
          id: "p-string-file",
          fileUrl: "https://plain",
          queueType: "queue-2",
          originalCaption: "cap",
        }),
        quoteRow({
          id: "p-bad",
          fileUrl: "",
          queueType: "unassigned",
          originalCaption: "",
        }),
        quoteRow({
          id: "p-numbers",
          fileUrl: "https://only",
          queueType: "queue-3",
          originalCaption: "x",
        }),
        quoteRow({
          id: "p-id-only",
          fileUrl: "https://id",
          queueType: "queue-4",
          originalCaption: "y",
          originalEventId: "evt-id",
        }),
        quoteRow({
          id: "p-pub-only",
          fileUrl: "https://pub",
          queueType: "queue-5",
          originalCaption: "z",
          originalEventPubkey: "pub-only",
        }),
        quoteRow({
          id: "p-string-event",
          fileUrl: "https://str",
          queueType: "queue-6",
          originalCaption: "s",
        }),
      ]);
    });

    it("rejects an empty quote selection", async () => {
      await expectErrorIncludes(
        await runAction({ _action: "bulkQuote", postIds: "[]" }),
        400,
        "postIds"
      );
    });

    it("rejects a pure repost", async () => {
      chain.isPureRepostSourcePost.mockReturnValue(true);
      posts.getPostsByIds.mockResolvedValue([{ id: "post-1" }]);

      await expectError(
        await runAction({
          _action: "bulkQuote",
          postIds: JSON.stringify(["post-1"]),
        }),
        400,
        CHAIN_ERROR
      );
    });
  });

  describe("repost", () => {
    const original = {
      id: "post-1",
      fileUrl: ["https://cdn/a.png"],
      signedEvent: { id: "evt-1", pubkey: "pub-1" },
    };

    it("returns an unsigned kind 6 event", async () => {
      posts.getPostsByIds.mockResolvedValue([original]);

      const result = await successBody({
        _action: "repost",
        postId: "post-1",
      });
      const event = requireRecord(result["repostEventData"], "repost event");

      expect(result["originalPost"]).toBe(original);
      expect(event["kind"]).toBe(6);
      expect(event["content"]).toBe("");
      expect(typeof event["created_at"]).toBe("number");
      expect(event["tags"]).toEqual([
        ["e", "evt-1", RELAY],
        ["p", "pub-1"],
      ]);
    });

    it("stringifies numeric event ids", async () => {
      const numeric = {
        id: "post-1",
        signedEvent: { id: 99, pubkey: 100 },
      };
      posts.getPostsByIds.mockResolvedValue([numeric]);

      const result = await successBody({
        _action: "repost",
        postId: "post-1",
      });
      const event = requireRecord(result["repostEventData"], "repost event");

      expect(event["tags"]).toEqual([
        ["e", "99", RELAY],
        ["p", "100"],
      ]);
    });

    it("rejects a missing post id", async () => {
      await expectErrorIncludes(
        await runAction({ _action: "repost", postId: "" }),
        400,
        "postId"
      );
    });

    it("returns 404 when the post list is empty", async () => {
      posts.getPostsByIds.mockResolvedValue([]);
      await expectError(
        await runAction({ _action: "repost", postId: "post-1" }),
        404,
        "Post not found"
      );
      expect(chain.isPureRepostSourcePost).not.toHaveBeenCalled();
    });

    it("returns 404 when the first post is missing", async () => {
      posts.getPostsByIds.mockResolvedValue([undefined]);
      await expectError(
        await runAction({ _action: "repost", postId: "post-1" }),
        404,
        "Post not found"
      );
      expect(chain.isPureRepostSourcePost).not.toHaveBeenCalled();
    });

    it("rejects a pure repost", async () => {
      chain.isPureRepostSourcePost.mockReturnValue(true);
      posts.getPostsByIds.mockResolvedValue([original]);
      await expectError(
        await runAction({ _action: "repost", postId: "post-1" }),
        400,
        CHAIN_ERROR
      );
    });

    it.each([
      { label: "missing", signedEvent: null },
      { label: "a string", signedEvent: "event" },
      { label: "an array", signedEvent: [] },
      { label: "missing an id", signedEvent: { pubkey: "pub" } },
      { label: "missing a pubkey", signedEvent: { id: "evt" } },
    ])("rejects an event that is $label", async ({ signedEvent }) => {
      posts.getPostsByIds.mockResolvedValue([{ id: "post-1", signedEvent }]);
      await expectError(
        await runAction({ _action: "repost", postId: "post-1" }),
        400,
        "Invalid event data"
      );
    });

    it("logs an Error from the post lookup", async () => {
      posts.getPostsByIds.mockRejectedValue(new Error("db down"));
      await expectServerError(
        await runAction({ _action: "repost", postId: "post-1" }),
        "db down"
      );
      expectLogged("db down", {
        userId: USER_ID,
        postId: "post-1",
        message: "Repost error",
      });
    });

    it("logs a non-Error lookup failure", async () => {
      posts.getPostsByIds.mockRejectedValue("boom");
      await expectServerError(
        await runAction({ _action: "repost", postId: "post-1" }),
        "Failed to create repost"
      );
      expectLogged("boom", {
        userId: USER_ID,
        postId: "post-1",
        message: "Repost error",
      });
    });
  });

  describe("quote", () => {
    it("builds quote payloads for file, queue, and caption variants", async () => {
      const variants: Array<{
        post: Record<string, unknown>;
        fileUrl: string;
        queueType: string;
        originalCaption: string;
        originalEventId: string;
        originalEventPubkey: string;
      }> = [
        {
          post: {
            id: "post-1",
            fileUrl: ["https://cdn/a.png"],
            queueTypeId: "queue-9",
            caption: "orig",
            signedEvent: { id: "evt", pubkey: "pub" },
          },
          fileUrl: "https://cdn/a.png",
          queueType: "queue-9",
          originalCaption: "orig",
          originalEventId: "evt",
          originalEventPubkey: "pub",
        },
        {
          post: {
            id: "post-1",
            fileUrl: [],
            queueTypeId: "",
            caption: null,
            signedEvent: { id: "evt", pubkey: "pub" },
          },
          fileUrl: "",
          queueType: "unassigned",
          originalCaption: "",
          originalEventId: "evt",
          originalEventPubkey: "pub",
        },
        {
          post: {
            id: "post-1",
            fileUrl: ["https://cdn/b.png"],
            queueTypeId: null,
            caption: null,
            signedEvent: { id: 7, pubkey: 8 },
          },
          fileUrl: "https://cdn/b.png",
          queueType: "unassigned",
          originalCaption: "",
          originalEventId: "7",
          originalEventPubkey: "8",
        },
      ];

      for (const variant of variants) {
        posts.getPostsByIds.mockResolvedValue([variant.post]);
        const result = await successBody({
          _action: "quote",
          postId: "post-1",
        });
        expect(result["quotePostData"]).toEqual([
          {
            caption: "",
            fileUrl: variant.fileUrl,
            queueType: variant.queueType,
            scheduledFor: "",
            originalPostId: "post-1",
            originalEventId: variant.originalEventId,
            originalEventPubkey: variant.originalEventPubkey,
            isQuotePost: true,
            originalCaption: variant.originalCaption,
          },
        ]);
      }
    });

    it("rejects a missing post id", async () => {
      await expectErrorIncludes(
        await runAction({ _action: "quote", postId: "" }),
        400,
        "postId"
      );
    });

    it("returns 404 when the post list is empty", async () => {
      posts.getPostsByIds.mockResolvedValue([]);
      await expectError(
        await runAction({ _action: "quote", postId: "post-1" }),
        404,
        "Post not found"
      );
    });

    it("returns 404 when the first post is missing", async () => {
      posts.getPostsByIds.mockResolvedValue([undefined]);
      await expectError(
        await runAction({ _action: "quote", postId: "post-1" }),
        404,
        "Post not found"
      );
    });

    it("rejects a pure repost", async () => {
      chain.isPureRepostSourcePost.mockReturnValue(true);
      posts.getPostsByIds.mockResolvedValue([
        {
          id: "post-1",
          fileUrl: [],
          signedEvent: { id: "evt", pubkey: "pub" },
        },
      ]);
      await expectError(
        await runAction({ _action: "quote", postId: "post-1" }),
        400,
        CHAIN_ERROR
      );
    });

    it.each([
      { label: "missing", signedEvent: null },
      { label: "a string", signedEvent: "event" },
      { label: "an array", signedEvent: [] },
      { label: "missing an id", signedEvent: { pubkey: "pub" } },
      { label: "missing a pubkey", signedEvent: { id: "evt" } },
    ])("rejects an event that is $label", async ({ signedEvent }) => {
      posts.getPostsByIds.mockResolvedValue([
        { id: "post-1", fileUrl: [], signedEvent },
      ]);
      await expectError(
        await runAction({ _action: "quote", postId: "post-1" }),
        400,
        "Invalid event data"
      );
    });

    it("logs an Error from the post lookup", async () => {
      posts.getPostsByIds.mockRejectedValue(new Error("db down"));
      await expectServerError(
        await runAction({ _action: "quote", postId: "post-1" }),
        "db down"
      );
      expectLogged("db down", {
        userId: USER_ID,
        postId: "post-1",
        message: "Quote post error",
      });
    });

    it("logs a non-Error lookup failure", async () => {
      posts.getPostsByIds.mockRejectedValue("boom");
      await expectServerError(
        await runAction({ _action: "quote", postId: "post-1" }),
        "Failed to create quote post"
      );
      expectLogged("boom", {
        userId: USER_ID,
        postId: "post-1",
        message: "Quote post error",
      });
    });
  });

  describe("longformRepost", () => {
    it("builds kind 1 reposts from article address tags", async () => {
      for (const scenario of longformScenarios) {
        const original = {
          id: "lf-1",
          title: scenario.title,
          queueTypeId: scenario.queueTypeId,
          signedEvent: scenario.event,
        };
        posts.getLongFormPostsByIds.mockResolvedValue([original]);

        const result = await successBody({
          _action: "longformRepost",
          longformPostId: "lf-1",
        });
        const event = requireRecord(
          result["longformRepostEventData"],
          "longform repost"
        );
        const naddr = result["naddr"];
        if (typeof naddr !== "string") {
          throw new Error("expected naddr");
        }

        expect(naddr.startsWith("naddr1")).toBe(true);
        expect(result["originalPost"]).toBe(original);
        expect(event["kind"]).toBe(1);
        expect(event["content"]).toBe(`nostr:${naddr}`);
        expect(typeof event["created_at"]).toBe("number");
        expect(event["tags"]).toEqual([
          ["a", `30023:${PUBKEY}:${scenario.identifier}`, RELAY],
          ["p", PUBKEY],
        ]);
      }
    });

    it("rejects a missing article id", async () => {
      await expectErrorIncludes(
        await runAction({ _action: "longformRepost", longformPostId: "" }),
        400,
        "longformPostId"
      );
    });

    it("returns 404 when the article list is empty", async () => {
      posts.getLongFormPostsByIds.mockResolvedValue([]);
      await expectError(
        await runAction({
          _action: "longformRepost",
          longformPostId: "lf-1",
        }),
        404,
        "Article not found"
      );
    });

    it("returns 404 when the first article is missing", async () => {
      posts.getLongFormPostsByIds.mockResolvedValue([undefined]);
      await expectError(
        await runAction({
          _action: "longformRepost",
          longformPostId: "lf-1",
        }),
        404,
        "Article not found"
      );
    });

    it.each([
      { label: "missing", signedEvent: null },
      { label: "a string", signedEvent: "event" },
      { label: "an array", signedEvent: [] },
      { label: "missing an id", signedEvent: { pubkey: PUBKEY } },
      { label: "missing a pubkey", signedEvent: { id: "evt" } },
    ])("rejects an event that is $label", async ({ signedEvent }) => {
      posts.getLongFormPostsByIds.mockResolvedValue([
        { id: "lf-1", signedEvent },
      ]);
      await expectError(
        await runAction({
          _action: "longformRepost",
          longformPostId: "lf-1",
        }),
        400,
        "Longform post has no associated NOSTR event"
      );
    });

    it("logs an Error from the article lookup", async () => {
      posts.getLongFormPostsByIds.mockRejectedValue(new Error("db down"));
      await expectServerError(
        await runAction({
          _action: "longformRepost",
          longformPostId: "lf-1",
        }),
        "db down"
      );
      expectLogged("db down", {
        userId: USER_ID,
        longformPostId: "lf-1",
        message: "Longform repost error",
      });
    });

    it("logs a non-Error lookup failure", async () => {
      posts.getLongFormPostsByIds.mockRejectedValue("boom");
      await expectServerError(
        await runAction({
          _action: "longformRepost",
          longformPostId: "lf-1",
        }),
        "Failed to create longform repost"
      );
      expectLogged("boom", {
        userId: USER_ID,
        longformPostId: "lf-1",
        message: "Longform repost error",
      });
    });
  });

  describe("longformQuote", () => {
    it("builds longform quote payloads from address tags", async () => {
      for (const scenario of longformScenarios) {
        posts.getLongFormPostsByIds.mockResolvedValue([
          {
            id: "lf-1",
            title: scenario.title,
            queueTypeId: scenario.queueTypeId,
            signedEvent: scenario.event,
          },
        ]);

        const result = await successBody({
          _action: "longformQuote",
          postId: "lf-1",
          longformPostId: "lf-log",
        });
        const quotes = result["longformQuotePostData"];
        if (!Array.isArray(quotes)) {
          throw new Error("expected longform quotes");
        }
        const quote = requireRecord(quotes[0], "longform quote");
        const naddr = quote["naddr"];
        if (typeof naddr !== "string") {
          throw new Error("expected naddr");
        }

        expect(naddr.startsWith("naddr1")).toBe(true);
        expect(quote).toEqual({
          caption: `nostr:${naddr}`,
          fileUrl: "",
          queueType: scenario.queueType,
          scheduledFor: "",
          originalPostId: "lf-1",
          originalEventId: scenario.eventId,
          originalEventPubkey: PUBKEY,
          isQuotePost: true,
          isLongformQuote: true,
          originalTitle: scenario.originalTitle,
          naddr,
        });
      }
    });

    it("rejects a missing post id", async () => {
      await expectErrorIncludes(
        await runAction({ _action: "longformQuote", postId: "" }),
        400,
        "postId"
      );
    });

    it("returns 404 when the article list is empty", async () => {
      posts.getLongFormPostsByIds.mockResolvedValue([]);
      await expectError(
        await runAction({ _action: "longformQuote", postId: "lf-1" }),
        404,
        "Article not found"
      );
    });

    it("returns 404 when the first article is missing", async () => {
      posts.getLongFormPostsByIds.mockResolvedValue([undefined]);
      await expectError(
        await runAction({ _action: "longformQuote", postId: "lf-1" }),
        404,
        "Article not found"
      );
    });

    it.each([
      { label: "missing", signedEvent: null },
      { label: "a string", signedEvent: "event" },
      { label: "an array", signedEvent: [] },
      { label: "missing an id", signedEvent: { pubkey: PUBKEY } },
      { label: "missing a pubkey", signedEvent: { id: "evt" } },
    ])("rejects an event that is $label", async ({ signedEvent }) => {
      posts.getLongFormPostsByIds.mockResolvedValue([
        { id: "lf-1", signedEvent },
      ]);
      await expectError(
        await runAction({ _action: "longformQuote", postId: "lf-1" }),
        400,
        "Longform post has no associated NOSTR event"
      );
    });

    it("logs an Error from the article lookup", async () => {
      posts.getLongFormPostsByIds.mockRejectedValue(new Error("db down"));
      await expectServerError(
        await runAction({
          _action: "longformQuote",
          postId: "lf-1",
          longformPostId: "lf-log",
        }),
        "db down"
      );
      expectLogged("db down", {
        userId: USER_ID,
        longformPostId: "lf-log",
        message: "Longform quote post error",
      });
    });

    it("logs a non-Error lookup failure", async () => {
      posts.getLongFormPostsByIds.mockRejectedValue("boom");
      await expectServerError(
        await runAction({
          _action: "longformQuote",
          postId: "lf-1",
          longformPostId: "lf-log",
        }),
        "Failed to create longform quote post"
      );
      expectLogged("boom", {
        userId: USER_ID,
        longformPostId: "lf-log",
        message: "Longform quote post error",
      });
    });
  });

  it("rejects an unknown action", async () => {
    await expectError(
      await runAction({ _action: "nope" }),
      400,
      "Invalid action"
    );
  });
});
