import { beforeEach, describe, expect, it, vi } from "vitest";

const capPolicy = vi.hoisted(() => {
  class ScheduleCapExceededError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ScheduleCapExceededError";
    }
  }
  return {
    assertScheduleCapacity:
      vi.fn<(userId: string, slots: number) => Promise<void>>(),
    ScheduleCapExceededError,
  };
});

const scheduling = vi.hoisted(() => ({
  signedFollowUpPersistence:
    vi.fn<
      (
        event: unknown
      ) => { signingState: string; signedChildEventId: string } | null
    >(),
}));

const posts = vi.hoisted(() => ({
  createPostWithOutbox:
    vi.fn<
      (
        data: Record<string, unknown>,
        scheduledFor: number
      ) => Promise<{ id: string }>
    >(),
  updatePost:
    vi.fn<
      (input: {
        id: string;
        userId: string;
        data: Record<string, unknown>;
      }) => Promise<void>
    >(),
  getPostById:
    vi.fn<(input: { id: string; userId: string }) => Promise<unknown>>(),
}));

const queues = vi.hoisted(() => ({
  resolveQueueTypeId:
    vi.fn<
      (
        userId: string,
        queueTypeId: unknown,
        queueType: unknown
      ) => Promise<string | null>
    >(),
}));

const machine = vi.hoisted(() => {
  const transition =
    vi.fn<
      (
        postId: string,
        userId: string,
        state: string,
        reason: string
      ) => Promise<void>
    >();
  class PostStateMachine {
    transition = transition;
  }
  return { PostStateMachine, transition };
});

const versions = vi.hoisted(() => ({
  restoreShortDraftVersion:
    vi.fn<(versionId: string, userId: string) => Promise<string | null>>(),
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: {},
}));
vi.mock(
  "~/features/payments/entitlements/schedule-cap-policy.server",
  () => capPolicy
);
vi.mock("~/features/posts/scheduling/index.server", () => scheduling);
vi.mock("~/features/posts/server", () => posts);
vi.mock("~/features/posts/services/queue-type-resolver.server", () => queues);
vi.mock(
  "~/features/posts/state-machine/post-state-machine.server",
  () => machine
);
vi.mock(
  "~/features/posts/drafts/services/draft-version.server",
  () => versions
);

import { handleDraftEditAction } from "~/features/posts/drafts/services/draft-edit-action.server";

const USER_ID = "user-1";
const POST_ID = "post-1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function signedEvent(id: string): {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
} {
  return {
    id,
    pubkey: "ab".repeat(32),
    created_at: 1_700_000_000,
    kind: 1,
    tags: [],
    content: "hello",
    sig: "sig",
  };
}

function nostrEvent(id: string): {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
} {
  return {
    id,
    pubkey: "ab".repeat(32),
    created_at: 1_700_000_000,
    kind: 1,
    tags: [],
    content: "hello",
  };
}

function formDataFrom(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return formData;
}

function updateFields(
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    _action: "update",
    content: "body",
    caption: "cap",
    hashTagPresetId: "preset-1",
    useHashtagPresets: "false",
    ...extra,
  };
}

function resumeFields(
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    _action: "resume",
    content: "body",
    caption: "cap",
    queueType: "queue-name",
    queueTypeId: "queue-id",
    scheduledFor: "1700000200",
    signedEvent: JSON.stringify(signedEvent("parent-signed")),
    nostrEvent: JSON.stringify(nostrEvent("parent-nostr")),
    hashTagPresetId: "preset-1",
    useHashtagPresets: "false",
    ...extra,
  };
}

function repostSchedule(unix: number): string {
  return JSON.stringify([
    {
      scheduledFor: unix,
      signedEvent: JSON.stringify(signedEvent("repost-evt")),
    },
  ]);
}

async function validationError(result: unknown): Promise<string> {
  if (!(result instanceof Response)) {
    throw new Error("expected validation response");
  }
  expect(result.status).toBe(400);
  const body: unknown = await result.json();
  if (!isRecord(body) || typeof body["error"] !== "string") {
    throw new Error("expected string error");
  }
  return body["error"];
}

function lastUpdateData(): Record<string, unknown> {
  const call = posts.updatePost.mock.calls.at(-1)?.[0];
  if (!call) {
    throw new Error("updatePost was not called");
  }
  return call.data;
}

function createArg(index: number): Record<string, unknown> {
  const arg = posts.createPostWithOutbox.mock.calls[index]?.[0];
  if (!isRecord(arg)) {
    throw new Error(`missing create arg ${index}`);
  }
  return arg;
}

let childCount = 0;

describe("handleDraftEditAction", () => {
  beforeEach(() => {
    childCount = 0;
    vi.clearAllMocks();
    capPolicy.assertScheduleCapacity.mockResolvedValue(undefined);
    queues.resolveQueueTypeId.mockResolvedValue("queue-resolved");
    posts.updatePost.mockResolvedValue(undefined);
    posts.getPostById.mockResolvedValue(null);
    posts.createPostWithOutbox.mockImplementation(async () => {
      childCount += 1;
      return { id: `child-${childCount}` };
    });
    machine.transition.mockResolvedValue(undefined);
    versions.restoreShortDraftVersion.mockResolvedValue(null);
    scheduling.signedFollowUpPersistence.mockImplementation((event) => {
      if (!isRecord(event)) return null;
      const id = event["id"];
      if (typeof id !== "string" || id.length === 0) return null;
      return { signingState: "signed", signedChildEventId: id };
    });
  });

  describe("restore-version", () => {
    it("redirects to the restored draft", async () => {
      versions.restoreShortDraftVersion.mockResolvedValue("restored-1");

      const result = await handleDraftEditAction(
        formDataFrom({ _action: "restore-version", versionId: "ver-1" }),
        USER_ID,
        POST_ID
      );

      expect(versions.restoreShortDraftVersion).toHaveBeenCalledWith(
        "ver-1",
        USER_ID
      );
      expect(result).toEqual({
        redirect: "/dashboard/drafts/edit/restored-1",
      });
    });

    it("does not restore a blank version id", async () => {
      const result = await handleDraftEditAction(
        formDataFrom({ _action: "restore-version", versionId: "" }),
        USER_ID,
        POST_ID
      );

      expect(versions.restoreShortDraftVersion).not.toHaveBeenCalled();
      expect((await validationError(result)).length).toBeGreaterThan(0);
    });

    it("does not restore a file version id", async () => {
      const formData = new FormData();
      formData.append("_action", "restore-version");
      formData.append("versionId", new File(["v"], "version.txt"));

      const result = await handleDraftEditAction(formData, USER_ID, POST_ID);

      expect(versions.restoreShortDraftVersion).not.toHaveBeenCalled();
      expect((await validationError(result)).length).toBeGreaterThan(0);
    });

    it("falls through when restore returns null", async () => {
      versions.restoreShortDraftVersion.mockResolvedValue(null);

      const result = await handleDraftEditAction(
        formDataFrom({ _action: "restore-version", versionId: "ver-1" }),
        USER_ID,
        POST_ID
      );

      expect(versions.restoreShortDraftVersion).toHaveBeenCalledWith(
        "ver-1",
        USER_ID
      );
      expect((await validationError(result)).length).toBeGreaterThan(0);
    });

    it("falls through when restore returns an empty id", async () => {
      versions.restoreShortDraftVersion.mockResolvedValue("");

      const result = await handleDraftEditAction(
        formDataFrom({ _action: "restore-version", versionId: "ver-1" }),
        USER_ID,
        POST_ID
      );

      expect((await validationError(result)).length).toBeGreaterThan(0);
    });
  });

  describe("update", () => {
    it("clears the hashtag preset when presets are off", async () => {
      const result = await handleDraftEditAction(
        formDataFrom(updateFields()),
        USER_ID,
        POST_ID
      );

      expect(result).toEqual({ redirect: "/dashboard/drafts" });
      expect(queues.resolveQueueTypeId).toHaveBeenCalledWith(
        USER_ID,
        undefined,
        undefined
      );
      expect(posts.updatePost).toHaveBeenCalledWith({
        id: POST_ID,
        userId: USER_ID,
        data: {
          content: "body",
          caption: "cap",
          queueTypeId: "queue-resolved",
          hashTagPresetId: null,
        },
      });
      expect(machine.transition).not.toHaveBeenCalled();
      expect(capPolicy.assertScheduleCapacity).not.toHaveBeenCalled();
    });

    it("keeps the hashtag preset when presets are on", async () => {
      const result = await handleDraftEditAction(
        formDataFrom(
          updateFields({
            useHashtagPresets: "true",
            queueType: "queue-name",
            queueTypeId: "queue-id",
          })
        ),
        USER_ID,
        POST_ID
      );

      expect(result).toEqual({ redirect: "/dashboard/drafts" });
      expect(queues.resolveQueueTypeId).toHaveBeenCalledWith(
        USER_ID,
        "queue-id",
        "queue-name"
      );
      expect(lastUpdateData()["hashTagPresetId"]).toBe("preset-1");
    });

    it("rejects an update that is missing content", async () => {
      const result = await handleDraftEditAction(
        formDataFrom({ _action: "update", caption: "cap" }),
        USER_ID,
        POST_ID
      );

      expect(await validationError(result)).toContain("content");
      expect(posts.updatePost).not.toHaveBeenCalled();
    });
  });

  it("rejects an unknown action", async () => {
    const result = await handleDraftEditAction(
      formDataFrom({ _action: "archive" }),
      USER_ID,
      POST_ID
    );
    expect((await validationError(result)).length).toBeGreaterThan(0);
  });

  describe("resume", () => {
    it("schedules the draft when the source post is gone", async () => {
      const result = await handleDraftEditAction(
        formDataFrom(resumeFields()),
        USER_ID,
        POST_ID
      );

      expect(result).toEqual({ redirect: "/dashboard/scheduled" });
      expect(capPolicy.assertScheduleCapacity).toHaveBeenCalledWith(USER_ID, 1);
      expect(posts.updatePost).toHaveBeenCalledWith({
        id: POST_ID,
        userId: USER_ID,
        data: {
          content: "body",
          caption: "cap",
          queueTypeId: "queue-resolved",
          scheduledAtUtc: 1_700_000_200,
          signedEvent: signedEvent("parent-signed"),
          nostrEvent: nostrEvent("parent-nostr"),
          hashTagPresetId: null,
        },
      });
      expect(machine.transition).toHaveBeenCalledWith(
        POST_ID,
        USER_ID,
        "SCHEDULED",
        "Draft resumed and scheduled"
      );
      expect(posts.getPostById).toHaveBeenCalledWith({
        id: POST_ID,
        userId: USER_ID,
      });
      expect(posts.createPostWithOutbox).not.toHaveBeenCalled();
    });

    it("stores a nominal schedule time and the hashtag preset", async () => {
      await handleDraftEditAction(
        formDataFrom(
          resumeFields({
            useHashtagPresets: "true",
            nominalScheduledFor: "1700000000",
          })
        ),
        USER_ID,
        POST_ID
      );

      expect(lastUpdateData()).toEqual({
        content: "body",
        caption: "cap",
        queueTypeId: "queue-resolved",
        scheduledAtUtc: 1_700_000_200,
        nominalScheduledAtUtc: new Date(1_700_000_000 * 1000),
        signedEvent: signedEvent("parent-signed"),
        nostrEvent: nostrEvent("parent-nostr"),
        hashTagPresetId: "preset-1",
      });
    });

    it("omits a blank, invalid, or missing nominal time", async () => {
      await handleDraftEditAction(
        formDataFrom(resumeFields({ nominalScheduledFor: "   " })),
        USER_ID,
        POST_ID
      );
      expect(lastUpdateData()).not.toHaveProperty("nominalScheduledAtUtc");

      await handleDraftEditAction(
        formDataFrom(resumeFields({ nominalScheduledFor: "abc" })),
        USER_ID,
        POST_ID
      );
      expect(lastUpdateData()).not.toHaveProperty("nominalScheduledAtUtc");

      await handleDraftEditAction(
        formDataFrom(resumeFields()),
        USER_ID,
        POST_ID
      );
      expect(lastUpdateData()).not.toHaveProperty("nominalScheduledAtUtc");
    });

    it("returns the schedule cap message", async () => {
      capPolicy.assertScheduleCapacity.mockRejectedValue(
        new capPolicy.ScheduleCapExceededError("cap hit")
      );

      const result = await handleDraftEditAction(
        formDataFrom(resumeFields()),
        USER_ID,
        POST_ID
      );

      expect(result).toEqual({ error: "cap hit" });
      expect(posts.updatePost).not.toHaveBeenCalled();
    });

    it("rethrows unexpected schedule cap failures", async () => {
      capPolicy.assertScheduleCapacity.mockRejectedValue(new Error("db down"));

      await expect(
        handleDraftEditAction(formDataFrom(resumeFields()), USER_ID, POST_ID)
      ).rejects.toThrow("db down");
      expect(posts.updatePost).not.toHaveBeenCalled();
    });

    it("throws when scheduledFor is not a unix time", async () => {
      await expect(
        handleDraftEditAction(
          formDataFrom(resumeFields({ scheduledFor: "not-a-time" })),
          USER_ID,
          POST_ID
        )
      ).rejects.toThrow("Invalid scheduledFor in resume data");
      expect(capPolicy.assertScheduleCapacity).not.toHaveBeenCalled();
      expect(posts.updatePost).not.toHaveBeenCalled();
    });

    it("creates attached reposts and quotes from schedule lists", async () => {
      const repostEvent = signedEvent("repost-evt");
      const quoteEvent = signedEvent("quote-evt");
      const quoteEventTwo = signedEvent("quote-evt-2");
      posts.getPostById.mockResolvedValue({
        postType: "IMAGE",
        queueTypeId: "queue-src",
        scheduledAtUtc: new Date(1_700_000_000 * 1000),
        nostrEventId: "parent-event",
        signedEvent: { id: "ignored" },
        rootScheduledActionId: "root-9",
      });

      const result = await handleDraftEditAction(
        formDataFrom(
          resumeFields({
            repostSchedules: JSON.stringify([
              {
                scheduledFor: "bad",
                signedEvent: JSON.stringify(repostEvent),
              },
              { scheduledFor: 1_700_000_050, signedEvent: "" },
              { scheduledFor: 1_700_000_050, signedEvent: "not-json" },
              {
                scheduledFor: 1_700_000_050,
                signedEvent: JSON.stringify({ id: "only" }),
              },
              { scheduledFor: 1_700_000_050, signedEvent: repostEvent },
            ]),
            quoteSchedules: JSON.stringify([
              {
                scheduledFor: 1_700_000_080,
                caption: "quoted",
                signedEvent: JSON.stringify(quoteEvent),
              },
              {
                scheduledFor: 1_700_000_090,
                signedEvent: JSON.stringify(quoteEventTwo),
              },
              { scheduledFor: 1_700_000_080, signedEvent: null },
              { caption: "skip" },
            ]),
          })
        ),
        USER_ID,
        POST_ID
      );

      expect(result).toEqual({ redirect: "/dashboard/scheduled" });
      expect(capPolicy.assertScheduleCapacity).toHaveBeenCalledWith(USER_ID, 4);
      expect(posts.createPostWithOutbox).toHaveBeenNthCalledWith(
        1,
        {
          userId: USER_ID,
          content: "",
          caption: "",
          fileUrl: [],
          postType: "IMAGE",
          queueTypeId: "queue-src",
          scheduledAtUtc: new Date(1_700_000_050 * 1000),
          tags: [],
          repost: true,
          isQuotedPost: false,
          repostOfPostId: POST_ID,
          postKind: "REPOST",
          signedEvent: repostEvent,
          parentScheduledActionId: POST_ID,
          rootScheduledActionId: "root-9",
          targetScheduledActionId: POST_ID,
          dependencyMode: "attached",
          targetMode: "scheduled_parent",
          followUpTimingMode: "offset_from_parent",
          followUpOffsetSeconds: 50,
          expectedParentEventId: "parent-event",
          signingState: "signed",
          signedChildEventId: "repost-evt",
        },
        1_700_000_050
      );
      expect(posts.createPostWithOutbox).toHaveBeenNthCalledWith(
        2,
        {
          userId: USER_ID,
          content: "quoted",
          caption: "quoted",
          fileUrl: [],
          postType: "IMAGE",
          queueTypeId: "queue-src",
          scheduledAtUtc: new Date(1_700_000_080 * 1000),
          tags: [],
          repost: false,
          isQuotedPost: true,
          quoteOfPostId: POST_ID,
          postKind: "QUOTE",
          signedEvent: quoteEvent,
          parentScheduledActionId: POST_ID,
          rootScheduledActionId: "root-9",
          targetScheduledActionId: POST_ID,
          dependencyMode: "attached",
          targetMode: "scheduled_parent",
          followUpTimingMode: "offset_from_parent",
          followUpOffsetSeconds: 80,
          expectedParentEventId: "parent-event",
          signingState: "signed",
          signedChildEventId: "quote-evt",
        },
        1_700_000_080
      );
      expect(posts.createPostWithOutbox).toHaveBeenNthCalledWith(
        3,
        {
          userId: USER_ID,
          content: "",
          caption: "",
          fileUrl: [],
          postType: "IMAGE",
          queueTypeId: "queue-src",
          scheduledAtUtc: new Date(1_700_000_090 * 1000),
          tags: [],
          repost: false,
          isQuotedPost: true,
          quoteOfPostId: POST_ID,
          postKind: "QUOTE",
          signedEvent: quoteEventTwo,
          parentScheduledActionId: POST_ID,
          rootScheduledActionId: "root-9",
          targetScheduledActionId: POST_ID,
          dependencyMode: "attached",
          targetMode: "scheduled_parent",
          followUpTimingMode: "offset_from_parent",
          followUpOffsetSeconds: 90,
          expectedParentEventId: "parent-event",
          signingState: "signed",
          signedChildEventId: "quote-evt-2",
        },
        1_700_000_090
      );
      expect(machine.transition).toHaveBeenNthCalledWith(
        1,
        POST_ID,
        USER_ID,
        "SCHEDULED",
        "Draft resumed and scheduled"
      );
      expect(machine.transition).toHaveBeenNthCalledWith(
        2,
        "child-1",
        USER_ID,
        "SCHEDULED",
        "Repost created"
      );
      expect(machine.transition).toHaveBeenNthCalledWith(
        3,
        "child-2",
        USER_ID,
        "SCHEDULED",
        "Quote post created"
      );
      expect(machine.transition).toHaveBeenNthCalledWith(
        4,
        "child-3",
        USER_ID,
        "SCHEDULED",
        "Quote post created"
      );
    });

    it.each([
      {
        name: "a nostr event id",
        nostrEventId: "explicit",
        signedEvent: { id: "from-signed" },
        expected: "explicit",
      },
      {
        name: "the signed event id",
        nostrEventId: "",
        signedEvent: { id: "from-signed" },
        expected: "from-signed",
      },
      {
        name: "an empty signed event id",
        nostrEventId: "",
        signedEvent: { id: "" },
        expected: undefined,
      },
      {
        name: "a numeric signed event id",
        nostrEventId: "",
        signedEvent: { id: 5 },
        expected: undefined,
      },
      {
        name: "a signed event without an id",
        nostrEventId: "",
        signedEvent: {},
        expected: undefined,
      },
      {
        name: "an array signed event",
        nostrEventId: "",
        signedEvent: [],
        expected: undefined,
      },
      {
        name: "a numeric signed event",
        nostrEventId: "",
        signedEvent: 4,
        expected: undefined,
      },
      {
        name: "a missing signed event",
        nostrEventId: "",
        signedEvent: null,
        expected: undefined,
      },
      {
        name: "a non-string nostr event id",
        nostrEventId: 12,
        signedEvent: { id: "from-signed" },
        expected: "from-signed",
      },
    ])(
      "resolves the parent event id from $name",
      async ({ nostrEventId, signedEvent: sourceSignedEvent, expected }) => {
        posts.getPostById.mockResolvedValue({
          postType: "IMAGE",
          queueTypeId: "queue-src",
          scheduledAtUtc: new Date(1_700_000_000 * 1000),
          nostrEventId,
          signedEvent: sourceSignedEvent,
          rootScheduledActionId: "root-9",
        });

        await handleDraftEditAction(
          formDataFrom(
            resumeFields({ repostSchedules: repostSchedule(1_700_000_050) })
          ),
          USER_ID,
          POST_ID
        );

        expect(createArg(0)["expectedParentEventId"]).toBe(expected);
        expect(createArg(0)["dependencyMode"]).toBe("attached");
        expect(createArg(0)["followUpOffsetSeconds"]).toBe(50);
      }
    );

    it("uses a string parent time when attaching follow-ups", async () => {
      const parent = "2024-06-01T00:00:00.000Z";
      const parentUnix = Math.floor(Date.parse(parent) / 1000);
      posts.getPostById.mockResolvedValue({
        postType: "IMAGE",
        queueTypeId: "queue-src",
        scheduledAtUtc: parent,
        nostrEventId: "explicit",
        signedEvent: { id: "from-signed" },
        rootScheduledActionId: "root-9",
      });

      await handleDraftEditAction(
        formDataFrom(
          resumeFields({ repostSchedules: repostSchedule(parentUnix + 5) })
        ),
        USER_ID,
        POST_ID
      );

      expect(createArg(0)["followUpOffsetSeconds"]).toBe(5);
      expect(createArg(0)["expectedParentEventId"]).toBe("explicit");
      expect(posts.createPostWithOutbox.mock.calls[0]?.[1]).toBe(
        parentUnix + 5
      );
    });

    it.each([
      { name: "an invalid date", scheduledAtUtc: new Date(Number.NaN) },
      { name: "a number", scheduledAtUtc: 1_700_000_000 },
      { name: "an invalid string", scheduledAtUtc: "yesterday" },
    ])(
      "creates standalone follow-ups when parent time is $name",
      async ({ scheduledAtUtc }) => {
        posts.getPostById.mockResolvedValue({
          postType: "IMAGE",
          queueTypeId: "queue-src",
          scheduledAtUtc,
          nostrEventId: "parent-event",
          rootScheduledActionId: "root-9",
        });

        await handleDraftEditAction(
          formDataFrom(
            resumeFields({ repostSchedules: repostSchedule(1_700_000_050) })
          ),
          USER_ID,
          POST_ID
        );

        const arg = createArg(0);
        expect(arg["dependencyMode"]).toBe("standalone");
        expect(arg["targetMode"]).toBe("direct");
        expect(arg).not.toHaveProperty("parentScheduledActionId");
        expect(arg).not.toHaveProperty("followUpOffsetSeconds");
        expect(capPolicy.assertScheduleCapacity).toHaveBeenCalledWith(
          USER_ID,
          2
        );
      }
    );

    it("clamps a negative offset and fills a missing root id", async () => {
      posts.getPostById.mockResolvedValue({
        postType: "TEXT",
        queueTypeId: null,
        scheduledAtUtc: new Date(1_700_000_100 * 1000),
        nostrEventId: "parent-event",
        signedEvent: { id: "from-signed" },
        rootScheduledActionId: null,
      });

      await handleDraftEditAction(
        formDataFrom(
          resumeFields({ repostSchedules: repostSchedule(1_700_000_000) })
        ),
        USER_ID,
        POST_ID
      );

      const arg = createArg(0);
      expect(arg["followUpOffsetSeconds"]).toBe(0);
      expect(arg["rootScheduledActionId"]).toBe(POST_ID);
      expect(arg["postType"]).toBe("TEXT");
      expect(arg["queueTypeId"]).toBeNull();
      expect(arg["dependencyMode"]).toBe("attached");
    });

    it("omits signing fields when follow-up persistence returns null", async () => {
      scheduling.signedFollowUpPersistence.mockReturnValue(null);
      posts.getPostById.mockResolvedValue({
        postType: "IMAGE",
        queueTypeId: "queue-src",
        scheduledAtUtc: new Date(1_700_000_000 * 1000),
        nostrEventId: "parent-event",
        rootScheduledActionId: "root-9",
      });

      await handleDraftEditAction(
        formDataFrom(
          resumeFields({ repostSchedules: repostSchedule(1_700_000_050) })
        ),
        USER_ID,
        POST_ID
      );

      const arg = createArg(0);
      expect(arg).not.toHaveProperty("signingState");
      expect(arg).not.toHaveProperty("signedChildEventId");
      expect(arg["dependencyMode"]).toBe("attached");
    });

    it("ignores invalid repost and quote schedule payloads", async () => {
      const result = await handleDraftEditAction(
        formDataFrom(
          resumeFields({
            repostSchedules: "{",
            quoteSchedules: "{}",
          })
        ),
        USER_ID,
        POST_ID
      );

      expect(result).toEqual({ redirect: "/dashboard/scheduled" });
      expect(capPolicy.assertScheduleCapacity).toHaveBeenCalledWith(USER_ID, 1);
      expect(posts.createPostWithOutbox).not.toHaveBeenCalled();
    });

    it("does not schedule follow-ups for a non-checkbox alsoSchedule flag", async () => {
      posts.getPostById.mockResolvedValue({
        postType: "IMAGE",
        queueTypeId: "queue-src",
        scheduledAtUtc: new Date(1_700_000_000 * 1000),
        nostrEventId: "parent-event",
        rootScheduledActionId: "root-9",
      });

      const result = await handleDraftEditAction(
        formDataFrom(
          resumeFields({
            alsoScheduleRepost: "yes",
            repostSignedEvent: JSON.stringify(signedEvent("repost-evt")),
            repostScheduledFor: "1700000300",
            alsoScheduleQuote: "yes",
            quoteSignedEvent: JSON.stringify(signedEvent("quote-evt")),
            quoteScheduledFor: "1700000400",
            quoteCaption: "quoted",
          })
        ),
        USER_ID,
        POST_ID
      );

      expect(result).toEqual({ redirect: "/dashboard/scheduled" });
      expect(posts.createPostWithOutbox).not.toHaveBeenCalled();
      expect(capPolicy.assertScheduleCapacity).toHaveBeenCalledWith(USER_ID, 1);
    });

    it("rejects checkbox alsoSchedule values before the fallback can run", async () => {
      const result = await handleDraftEditAction(
        formDataFrom(
          resumeFields({
            alsoScheduleRepost: "on",
            repostSignedEvent: JSON.stringify(signedEvent("repost-evt")),
            repostScheduledFor: "1700000300",
            alsoScheduleQuote: "true",
            quoteSignedEvent: JSON.stringify(signedEvent("quote-evt")),
            quoteScheduledFor: "1700000400",
          })
        ),
        USER_ID,
        POST_ID
      );

      expect((await validationError(result)).length).toBeGreaterThan(0);
      expect(posts.createPostWithOutbox).not.toHaveBeenCalled();
      expect(capPolicy.assertScheduleCapacity).not.toHaveBeenCalled();
    });
  });
});
