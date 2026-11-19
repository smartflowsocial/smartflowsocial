import { beforeEach, describe, expect, it, vi } from "vitest";

interface SignedStub {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface SegmentInput {
  content: string;
  attachmentMeta?: Array<{ localId: string; url?: string; alt?: string }>;
}

interface CreateInput {
  userId: string;
  content: string;
  caption: string;
  fileUrl: string[];
  postType: string;
  queueTypeId: string | null;
  queueType: string;
  hashTagPresetId: string | null | undefined;
  isRecyclable: boolean;
  signedEvent: SignedStub;
  scheduledFor: number;
  nominalScheduledFor?: number;
  hashTagPresetTags: string | undefined;
  showHashTagsinPosts: boolean;
  postKind: string;
  threadGroupId: string;
  submissionId?: string;
}

interface PublishInput {
  postId: string;
  userId: string;
  signedEvent: unknown;
  relays: string[];
}

interface DelayCase {
  raw: string | null;
  expected: number;
}

const PK = "pk-session";

const {
  mockCreate,
  mockPublish,
  mockAssertMedia,
  mockResolveQueue,
  mockHashtags,
  mockValidate,
  mockJsonContest,
} = vi.hoisted(() => ({
  mockCreate:
    vi.fn<
      (
        input: CreateInput
      ) => Promise<{ post: { id: string; signedEvent: unknown } }>
    >(),
  mockPublish: vi.fn<(input: PublishInput) => Promise<void>>(),
  mockAssertMedia: vi.fn<(urls: string[]) => Promise<void>>(),
  mockResolveQueue:
    vi.fn<
      (
        userId: string,
        queueTypeId: string | null,
        queueType: string
      ) => Promise<string | null>
    >(),
  mockHashtags:
    vi.fn<
      (
        userId: string,
        enabled: boolean,
        presetId: string | null,
        queueType: string,
        queueTypeId: string | null
      ) => Promise<unknown>
    >(),
  mockValidate: vi.fn<(value: unknown) => unknown>(),
  mockJsonContest:
    vi.fn<
      (
        userId: string,
        postId: string
      ) => Promise<{ ok: boolean; postId: string }>
    >(),
}));

vi.mock(
  "~/features/posts/composer/use-cases/create-post.use-case.server",
  () => ({
    CreatePostUseCase: class {
      execute = mockCreate;
    },
  })
);

vi.mock("~/features/posts/server/publishing", () => ({
  PublishNowUseCase: class {
    execute = mockPublish;
  },
}));

vi.mock("~/features/upload/services/media-readiness.server", () => ({
  assertMediaUrlsReady: mockAssertMedia,
}));

vi.mock("~/features/posts/server", () => ({
  resolveQueueTypeId: mockResolveQueue,
}));

vi.mock(
  "~/features/posts/composer/services/newpost-action/hashtag-preset-utils.server",
  () => ({
    getHashtagPresetTags: mockHashtags,
  })
);

vi.mock("~/lib/validation/nostr-events.server", () => ({
  validateSignedEvent: mockValidate,
}));

vi.mock(
  "~/features/posts/composer/services/newpost-action/contest-embed-response.server",
  () => ({
    isContestEmbedRequest: (formData: FormData) =>
      String(formData.get("_embedContext") ?? "") === "contest",
    jsonContestEmbedPost: mockJsonContest,
  })
);

vi.mock("~/lib/prisma.server", () => ({
  prisma: { post: { findUnique: vi.fn() } },
}));

import { asRouteResponse } from "../../utils/action-test-helpers";
import { setupFetchMock, TEST_USER_ID } from "../../utils/mock-helpers";
import { createActionFormData } from "../../utils/test-helpers";

import { handleThreadAction } from "~/features/posts/composer/services/newpost-action/thread-handlers.server";

let created = 0;

function signedStub(overrides: Partial<SignedStub> = {}): SignedStub {
  return {
    id: "event-1",
    pubkey: PK,
    created_at: 1_700_000_000,
    kind: 1,
    tags: [],
    content: "hello",
    sig: "sig",
    ...overrides,
  };
}

function segments(): SegmentInput[] {
  return [
    {
      content: "hello [attach:a]",
      attachmentMeta: [{ localId: "a", url: "https://cdn.example/a.png" }],
    },
    { content: "second" },
  ];
}

function events(): SignedStub[] {
  return [signedStub({ id: "event-1" }), signedStub({ id: "event-2" })];
}

function threadForm(
  action: string,
  extra: Record<string, string> = {},
  nextSegments: SegmentInput[] = segments(),
  nextEvents: Array<SignedStub | { id: string }> = events()
): FormData {
  return createActionFormData(action, {
    threadSegments: JSON.stringify(nextSegments),
    threadSignedEvents: JSON.stringify(nextEvents),
    ...extra,
  });
}

async function routeError(
  result: unknown
): Promise<{ status: number; error: string }> {
  const response = await asRouteResponse(result);
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("error" in body)) {
    throw new Error("missing error");
  }
  const error = body.error;
  if (typeof error !== "string") throw new Error("error is not a string");
  return { status: response.status, error };
}

describe("handleThreadAction", () => {
  beforeEach(() => {
    created = 0;
    vi.clearAllMocks();
    setupFetchMock();
    mockAssertMedia.mockResolvedValue(undefined);
    mockPublish.mockResolvedValue(undefined);
    mockResolveQueue.mockResolvedValue("queue-resolved");
    mockHashtags.mockResolvedValue({
      tags: "#hi",
      presetId: "preset-resolved",
    });
    mockValidate.mockImplementation((value: unknown) => {
      if (value && typeof value === "object" && "sig" in value) return value;
      return null;
    });
    mockJsonContest.mockResolvedValue({ ok: true, postId: "post-1" });
    mockCreate.mockImplementation(async () => {
      created += 1;
      return {
        post: {
          id: `post-${created}`,
          signedEvent: signedStub({ id: `made-${created}` }),
        },
      };
    });
  });

  it("rejects missing, invalid, and too-short segment payloads", async () => {
    const missing = await routeError(
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        createActionFormData("post-thread"),
        []
      )
    );
    const badJson = await routeError(
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        threadForm("post-thread", { threadSegments: "not-json" }),
        []
      )
    );
    const notArray = await routeError(
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        threadForm("post-thread", { threadSegments: "{}" }),
        []
      )
    );
    const one = await routeError(
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        threadForm("post-thread", {}, [segments()[0] ?? { content: "only" }]),
        []
      )
    );

    expect(missing).toEqual({
      status: 400,
      error: "Threads need at least 2 segments.",
    });
    expect(badJson).toEqual(missing);
    expect(notArray).toEqual(missing);
    expect(one).toEqual(missing);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects signed events that do not line up with the segments", async () => {
    const mismatch = await routeError(
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        threadForm("post-thread", {}, segments(), [signedStub()]),
        []
      )
    );
    const notArray = await routeError(
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        threadForm("post-thread", { threadSignedEvents: "{}" }),
        []
      )
    );
    const missingSig = await routeError(
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        threadForm("post-thread", {}, segments(), [
          { id: "a" },
          { id: "b", pubkey: PK },
        ]),
        []
      )
    );

    expect(mismatch).toEqual({
      status: 400,
      error: "Signed events must match each thread segment.",
    });
    expect(notArray).toEqual(mismatch);
    expect(missingSig).toEqual(mismatch);
  });

  it("rejects a segment that has neither text nor a media url", async () => {
    const blank = await routeError(
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        threadForm("post-thread", {}, [{ content: "   " }, { content: "ok" }]),
        []
      )
    );
    const blankUrl = await routeError(
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        threadForm("post-thread", {}, [
          { content: "", attachmentMeta: [{ localId: "a", url: "  " }] },
          { content: "ok" },
        ]),
        []
      )
    );

    expect(blank).toEqual({
      status: 400,
      error:
        "Each thread segment must include text or at least one media attachment.",
    });
    expect(blankUrl).toEqual(blank);
  });

  it("clamps the delay to a minute step between 60 and 7200 seconds", async () => {
    const delayCases: DelayCase[] = [
      { raw: null, expected: 60 },
      { raw: "nope", expected: 60 },
      { raw: "0", expected: 60 },
      { raw: "30", expected: 60 },
      { raw: "90", expected: 120 },
      { raw: "120", expected: 120 },
      { raw: "7201", expected: 7200 },
    ];

    for (const item of delayCases) {
      mockCreate.mockClear();
      const extra: Record<string, string> = {};
      if (item.raw !== null) extra.threadDelaySeconds = item.raw;
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        threadForm("post-thread", extra),
        ["wss://relay.example"]
      );
      const first = mockCreate.mock.calls[0]?.[0].scheduledFor ?? 0;
      const second = mockCreate.mock.calls[1]?.[0].scheduledFor ?? 0;
      expect(second - first).toBe(item.expected);
    }
  });

  it("requires a non-negative schedule time and keeps a valid nominal time on the first segment", async () => {
    const missing = await routeError(
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        threadForm("schedule-thread"),
        []
      )
    );
    const negative = await routeError(
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        threadForm("schedule-thread", { scheduledFor: "-5" }),
        []
      )
    );
    const garbage = await routeError(
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        threadForm("schedule-thread", { scheduledFor: "soon" }),
        []
      )
    );

    expect(missing.error).toBe("Schedule time required for schedule-thread");
    expect(negative).toEqual(missing);
    expect(garbage).toEqual(missing);

    await handleThreadAction(
      TEST_USER_ID,
      PK,
      threadForm("schedule-thread", {
        scheduledFor: "1700000000",
        threadDelaySeconds: "120",
        nominalScheduledFor: "1700000100",
        includeHashtagsInNoteBody: "false",
      }),
      ["wss://relay.example"]
    );

    expect(mockCreate.mock.calls[0]?.[0].scheduledFor).toBe(1_700_000_000);
    expect(mockCreate.mock.calls[1]?.[0].scheduledFor).toBe(1_700_000_120);
    expect(mockCreate.mock.calls[0]?.[0].nominalScheduledFor).toBe(
      1_700_000_100
    );
    expect(mockCreate.mock.calls[1]?.[0].nominalScheduledFor).toBeUndefined();
    expect(mockPublish).not.toHaveBeenCalled();
    const scheduled = await asRouteResponse(
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        threadForm("schedule-thread", {
          scheduledFor: "0",
          nominalScheduledFor: "   ",
        }),
        []
      )
    );
    expect(scheduled.status).toBe(302);
    expect(scheduled.headers.get("Location")).toBe(
      "/dashboard/compose?type=thread&scheduled=post-3"
    );
    expect(mockCreate.mock.calls[2]?.[0].scheduledFor).toBe(0);
    expect(mockCreate.mock.calls[2]?.[0].nominalScheduledFor).toBeUndefined();
    expect(mockCreate.mock.calls[3]?.[0].nominalScheduledFor).toBeUndefined();
  });

  it("ignores a negative or non-numeric nominal time", async () => {
    for (const nominal of ["-4", "nope", ""]) {
      mockCreate.mockClear();
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        threadForm("schedule-thread", {
          scheduledFor: "100",
          nominalScheduledFor: nominal,
        }),
        []
      );
      expect(mockCreate.mock.calls[0]?.[0].nominalScheduledFor).toBeUndefined();
      expect(mockCreate.mock.calls[0]?.[0].scheduledFor).toBe(100);
    }
  });

  it("publishes only the first segment and redirects to the published thread", async () => {
    const form = threadForm("post-thread", {
      queueType: "news",
      queueTypeId: "q-1",
      hashTagPresetId: "h-1",
      submissionId: "sub-1",
      includeHashtagsInNoteBody: "on",
    });
    const result = await handleThreadAction(TEST_USER_ID, PK, form, [
      "wss://relay.example",
    ]);
    const response = await asRouteResponse(result);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/dashboard/compose?type=thread&published=post-1"
    );
    expect(mockHashtags).toHaveBeenCalledWith(
      TEST_USER_ID,
      true,
      "h-1",
      "news",
      "q-1"
    );
    expect(mockResolveQueue).toHaveBeenCalledWith(TEST_USER_ID, "q-1", "news");
    expect(mockAssertMedia).toHaveBeenNthCalledWith(1, [
      "https://cdn.example/a.png",
    ]);
    expect(mockAssertMedia).toHaveBeenNthCalledWith(2, []);
    const first = mockCreate.mock.calls[0]?.[0];
    const second = mockCreate.mock.calls[1]?.[0];
    expect(first?.content).toBe("hello\n#hi");
    expect(first?.fileUrl).toEqual(["https://cdn.example/a.png"]);
    expect(first?.postType).toBe("TEXT");
    expect(first?.postKind).toBe("THREAD");
    expect(first?.isRecyclable).toBe(false);
    expect(first?.queueType).toBe("news");
    expect(first?.queueTypeId).toBe("queue-resolved");
    expect(first?.hashTagPresetId).toBe("preset-resolved");
    expect(first?.submissionId).toBe("sub-1:thread-segment-0");
    expect(second?.submissionId).toBe("sub-1:thread-segment-1");
    expect(first?.threadGroupId).toBe(second?.threadGroupId);
    expect(first?.threadGroupId.startsWith(`thread_${TEST_USER_ID}_`)).toBe(
      true
    );
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith({
      postId: "post-1",
      userId: TEST_USER_ID,
      signedEvent: signedStub({ id: "made-1" }),
      relays: ["wss://relay.example"],
    });
  });

  it("accepts a media-only segment and skips publish when validation returns null", async () => {
    mockValidate.mockReturnValue(null);
    const form = threadForm("post-thread", {}, [
      {
        content: " ",
        attachmentMeta: [{ localId: "a", url: "https://cdn.example/b.png" }],
      },
      { content: "tail" },
    ]);
    const response = await asRouteResponse(
      await handleThreadAction(TEST_USER_ID, PK, form, ["wss://relay.example"])
    );

    expect(response.headers.get("Location")).toBe(
      "/dashboard/compose?type=thread&published=post-1"
    );
    expect(mockCreate.mock.calls[0]?.[0].fileUrl).toEqual([
      "https://cdn.example/b.png",
    ]);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("returns the contest payload instead of redirecting", async () => {
    const form = threadForm("post-thread", { _embedContext: "contest" });
    const result = await handleThreadAction(TEST_USER_ID, PK, form, []);

    expect(result).toEqual({ ok: true, postId: "post-1" });
    expect(mockJsonContest).toHaveBeenCalledWith(TEST_USER_ID, "post-1");
  });

  it("uses queue and hashtag defaults, including non-object preset results", async () => {
    mockHashtags.mockResolvedValueOnce("plain");
    await handleThreadAction(
      TEST_USER_ID,
      PK,
      threadForm("post-thread", { hashTagPresetId: "form-p", queueTypeId: "" }),
      []
    );
    expect(mockHashtags).toHaveBeenCalledWith(
      TEST_USER_ID,
      true,
      "form-p",
      "unassigned",
      null
    );
    expect(mockResolveQueue).toHaveBeenCalledWith(
      TEST_USER_ID,
      null,
      "unassigned"
    );
    expect(mockCreate.mock.calls[0]?.[0].hashTagPresetTags).toBe("");
    expect(mockCreate.mock.calls[0]?.[0].hashTagPresetId).toBe("form-p");
    expect(mockCreate.mock.calls[0]?.[0].content).toBe("hello");

    mockCreate.mockClear();
    mockHashtags.mockResolvedValueOnce(["#a"]);
    mockResolveQueue.mockResolvedValueOnce(null);
    await handleThreadAction(TEST_USER_ID, PK, threadForm("post-thread"), []);
    expect(mockCreate.mock.calls[0]?.[0].hashTagPresetTags).toBeUndefined();
    expect(mockCreate.mock.calls[0]?.[0].hashTagPresetId).toBeUndefined();
    expect(mockCreate.mock.calls[0]?.[0].queueTypeId).toBeNull();

    mockHashtags.mockResolvedValueOnce(null);
    await expect(
      handleThreadAction(TEST_USER_ID, PK, threadForm("post-thread"), [])
    ).rejects.toThrow(TypeError);
  });

  it("honors the hashtag body toggle and drops a blank or oversized submission id", async () => {
    const toggles: Array<{ raw?: string; shows: boolean }> = [
      { shows: true },
      { raw: "false", shows: false },
      { raw: "off", shows: false },
      { raw: "on", shows: true },
      { raw: "maybe", shows: true },
    ];
    for (const toggle of toggles) {
      mockCreate.mockClear();
      const extra: Record<string, string> = {};
      if (toggle.raw !== undefined)
        extra.includeHashtagsInNoteBody = toggle.raw;
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        threadForm("post-thread", extra),
        []
      );
      const content = mockCreate.mock.calls[0]?.[0].content;
      expect(content?.includes("#hi")).toBe(toggle.shows);
    }

    const submissionIds: Array<{ raw?: string; expected: string | undefined }> =
      [
        { raw: "sub-1", expected: "sub-1:thread-segment-0" },
        { raw: "   ", expected: undefined },
        { raw: "x".repeat(129), expected: undefined },
        { expected: undefined },
      ];
    for (const item of submissionIds) {
      mockCreate.mockClear();
      const extra: Record<string, string> = {};
      if (item.raw !== undefined) extra.submissionId = item.raw;
      await handleThreadAction(
        TEST_USER_ID,
        PK,
        threadForm("post-thread", extra),
        []
      );
      expect(mockCreate.mock.calls[0]?.[0].submissionId).toBe(item.expected);
    }
  });

  it("propagates media, create, publish, and pubkey failures", async () => {
    const emptyKey = threadForm("post-thread", {}, segments(), [
      signedStub({ pubkey: "" }),
      signedStub(),
    ]);
    await expect(
      handleThreadAction(TEST_USER_ID, PK, emptyKey, [])
    ).rejects.toThrow("Missing signed event pubkey");
    expect(mockCreate).not.toHaveBeenCalled();

    mockAssertMedia.mockRejectedValueOnce(new Error("media-down"));
    await expect(
      handleThreadAction(TEST_USER_ID, PK, threadForm("post-thread"), [])
    ).rejects.toThrow("media-down");

    mockCreate.mockRejectedValueOnce("create-string");
    await expect(
      handleThreadAction(TEST_USER_ID, PK, threadForm("post-thread"), [])
    ).rejects.toBe("create-string");

    mockPublish.mockRejectedValueOnce(new Error("publish-down"));
    await expect(
      handleThreadAction(TEST_USER_ID, PK, threadForm("post-thread"), [])
    ).rejects.toThrow("publish-down");
  });
});
