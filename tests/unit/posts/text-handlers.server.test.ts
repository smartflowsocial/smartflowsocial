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

interface TextParams {
  userId: string;
  sessionPubkey: string;
  formData: FormData;
  hashTagPresetTags: string;
  showHashTagsinPosts: boolean;
  queueType: string;
  queueTypeId: string | null;
  isRecyclable: boolean;
  hashTagPresetId: string | null;
  sanitizedRelays?: string[];
  action?: "post-text" | "schedule-text";
  correlationId?: string;
}

interface CreateInput {
  userId: string;
  content: string | null;
  caption: string | null;
  fileUrl: string[];
  postType: string;
  queueTypeId: string | null;
  queueType: string;
  hashTagPresetId: string | null;
  isRecyclable: boolean;
  signedEvent?: SignedStub;
  nostrEvent?: SignedStub;
  scheduledFor?: number;
  nominalScheduledFor?: number;
  hashTagPresetTags: string;
  showHashTagsinPosts: boolean;
  correlationId?: string;
  submissionId?: string;
  repostSchedules?: unknown;
  quoteSchedules?: unknown;
}

interface PublishInput {
  postId: string;
  userId: string;
  signedEvent: unknown;
  relays: string[];
  correlationId?: string;
}

const PK = "pk-session";

const {
  mockCreate,
  mockPublish,
  mockAssertMedia,
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
  mockValidate: vi.fn<(value: unknown) => unknown>(),
  mockJsonContest:
    vi.fn<(userId: string, postId: string) => Promise<{ ok: boolean }>>(),
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
import {
  setupFetchMock,
  TEST_POST_ID,
  TEST_USER_ID,
} from "../../utils/mock-helpers";
import { createActionFormData } from "../../utils/test-helpers";

import {
  handleDraftText,
  handlePostOrScheduleText,
  parseAttachmentMeta,
} from "~/features/posts/composer/services/newpost-action/handlers/text-handlers.server";

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

function textParams(
  formData: FormData,
  overrides: Partial<TextParams> = {}
): TextParams {
  return {
    userId: TEST_USER_ID,
    sessionPubkey: PK,
    formData,
    hashTagPresetTags: "#hi",
    showHashTagsinPosts: true,
    queueType: "posts",
    queueTypeId: "queue-1",
    isRecyclable: true,
    hashTagPresetId: "preset-1",
    sanitizedRelays: ["wss://relay.example"],
    correlationId: "cid-1",
    ...overrides,
  };
}

function created(): CreateInput {
  const input = mockCreate.mock.calls[0]?.[0];
  if (!input) throw new Error("create was not called");
  return input;
}

describe("text handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFetchMock();
    mockAssertMedia.mockResolvedValue(undefined);
    mockPublish.mockResolvedValue(undefined);
    mockJsonContest.mockResolvedValue({ ok: true });
    mockValidate.mockImplementation((value: unknown) => {
      if (value && typeof value === "object" && "sig" in value) return value;
      return null;
    });
    mockCreate.mockResolvedValue({
      post: { id: TEST_POST_ID, signedEvent: signedStub() },
    });
  });

  describe("parseAttachmentMeta", () => {
    it("returns an empty list for missing, non-string, invalid, and non-array values", () => {
      expect(parseAttachmentMeta(new FormData())).toEqual([]);
      const empty = new FormData();
      empty.set("attachmentMeta", "");
      expect(parseAttachmentMeta(empty)).toEqual([]);
      const file = new FormData();
      file.set("attachmentMeta", new File(["[]"], "meta.txt"));
      expect(parseAttachmentMeta(file)).toEqual([]);
      const bad = new FormData();
      bad.set("attachmentMeta", "not-json");
      expect(parseAttachmentMeta(bad)).toEqual([]);
      const objectValue = new FormData();
      objectValue.set("attachmentMeta", "{}");
      expect(parseAttachmentMeta(objectValue)).toEqual([]);
      const nullValue = new FormData();
      nullValue.set("attachmentMeta", "null");
      expect(parseAttachmentMeta(nullValue)).toEqual([]);
    });

    it("keeps only objects with a string local id", () => {
      const form = new FormData();
      form.set(
        "attachmentMeta",
        JSON.stringify([
          1,
          null,
          { url: "https://cdn.example/x.png" },
          { localId: 4 },
          { localId: "a" },
          { localId: "b", url: "https://cdn.example/b.png" },
        ])
      );

      expect(parseAttachmentMeta(form)).toEqual([
        { localId: "a" },
        { localId: "b", url: "https://cdn.example/b.png" },
      ]);
    });
  });

  describe("handleDraftText", () => {
    it("saves stripped text, hashtags, and a submission id, then redirects to drafts", async () => {
      const form = createActionFormData("draft-text", {
        content: "hello [attach:a] #hi",
        attachmentMeta: JSON.stringify([
          { localId: "a", url: "https://cdn.example/a.png" },
        ]),
        submissionId: "sub-1",
      });

      const response = await asRouteResponse(
        await handleDraftText(textParams(form))
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/dashboard/drafts");
      expect(mockAssertMedia).toHaveBeenCalledWith([
        "https://cdn.example/a.png",
      ]);
      expect(created()).toEqual({
        userId: TEST_USER_ID,
        content: "hello  #hi",
        caption: "hello  #hi",
        fileUrl: ["https://cdn.example/a.png"],
        postType: "TEXT",
        queueTypeId: "queue-1",
        queueType: "posts",
        hashTagPresetId: "preset-1",
        isRecyclable: true,
        hashTagPresetTags: "#hi",
        showHashTagsinPosts: true,
        correlationId: "cid-1",
        submissionId: "sub-1",
      });
    });

    it("keeps empty content when hashtags are hidden and ignores a bad attachment list", async () => {
      const form = createActionFormData("draft-text", {
        attachmentMeta: "not-json",
        submissionId: "   ",
      });
      await handleDraftText(
        textParams(form, { showHashTagsinPosts: false, hashTagPresetTags: "" })
      );

      expect(created().content).toBe("");
      expect(created().fileUrl).toEqual([]);
      expect(created().submissionId).toBeUndefined();
      expect(created().showHashTagsinPosts).toBe(false);
    });

    it("propagates media and create failures", async () => {
      mockAssertMedia.mockRejectedValueOnce(new Error("media-down"));
      await expect(
        handleDraftText(textParams(createActionFormData("draft-text")))
      ).rejects.toThrow("media-down");

      mockAssertMedia.mockRejectedValueOnce("media-string");
      await expect(
        handleDraftText(textParams(createActionFormData("draft-text")))
      ).rejects.toBe("media-string");

      mockCreate.mockRejectedValueOnce("create-string");
      await expect(
        handleDraftText(
          textParams(createActionFormData("draft-text", { content: "hi" }))
        )
      ).rejects.toBe("create-string");
    });
  });

  describe("handlePostOrScheduleText", () => {
    function postForm(extra: Record<string, string> = {}): FormData {
      return createActionFormData("post-text", {
        content: "hello [attach:a]",
        attachmentMeta: JSON.stringify([
          { localId: "a", url: "https://cdn.example/a.png" },
        ]),
        signedEvent: JSON.stringify(signedStub()),
        nostrEvent: JSON.stringify(signedStub()),
        submissionId: "sub-1",
        ...extra,
      });
    }

    it("publishes a text post and redirects, appending hashtags", async () => {
      const response = await asRouteResponse(
        await handlePostOrScheduleText(textParams(postForm()))
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(
        `/dashboard/compose?type=post&published=${TEST_POST_ID}`
      );
      expect(created().content).toBe("hello\n#hi");
      expect(created().fileUrl).toEqual(["https://cdn.example/a.png"]);
      expect(created().scheduledFor).toBeUndefined();
      expect(created().nominalScheduledFor).toBeUndefined();
      expect(created().repostSchedules).toBeUndefined();
      expect(created().quoteSchedules).toBeUndefined();
      expect(created().submissionId).toBe("sub-1");
      expect(mockPublish).toHaveBeenCalledWith({
        postId: TEST_POST_ID,
        userId: TEST_USER_ID,
        signedEvent: signedStub(),
        relays: ["wss://relay.example"],
        correlationId: "cid-1",
      });
    });

    it("uses post-text and an empty relay list when those arguments are omitted", async () => {
      const params = textParams(postForm());
      delete params.action;
      delete params.sanitizedRelays;
      await handlePostOrScheduleText(params);

      expect(mockPublish.mock.calls[0]?.[0].relays).toEqual([]);
      expect(created().scheduledFor).toBeUndefined();
    });

    it("returns the contest payload for an immediate post", async () => {
      const result = await handlePostOrScheduleText(
        textParams(postForm({ _embedContext: "contest" }), {
          action: "post-text",
        })
      );

      expect(result).toEqual({ ok: true });
      expect(mockJsonContest).toHaveBeenCalledWith(TEST_USER_ID, TEST_POST_ID);
    });

    it("schedules from the signed event and keeps a finite nominal time", async () => {
      const response = await asRouteResponse(
        await handlePostOrScheduleText(
          textParams(
            postForm({
              nominalScheduledFor: "1700001111",
              includeHashtagsInNoteBody: "false",
            }),
            { action: "schedule-text", showHashTagsinPosts: false }
          )
        )
      );

      expect(response.headers.get("Location")).toBe(
        `/dashboard/compose?type=post&scheduled=${TEST_POST_ID}`
      );
      expect(created().scheduledFor).toBe(1_700_000_000);
      expect(created().nominalScheduledFor).toBe(1_700_001_111);
      expect(created().content).toBe("hello");
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it("drops a blank, invalid, or non-numeric nominal time and ignores it for post-text", async () => {
      for (const nominal of ["", "   ", "nope"]) {
        mockCreate.mockClear();
        await handlePostOrScheduleText(
          textParams(postForm({ nominalScheduledFor: nominal }), {
            action: "schedule-text",
          })
        );
        expect(created().nominalScheduledFor).toBeUndefined();
        expect(created().scheduledFor).toBe(1_700_000_000);
      }

      mockCreate.mockClear();
      await handlePostOrScheduleText(
        textParams(postForm({ nominalScheduledFor: "-3" }), {
          action: "schedule-text",
        })
      );
      expect(created().nominalScheduledFor).toBe(-3);

      mockCreate.mockClear();
      await handlePostOrScheduleText(
        textParams(postForm({ nominalScheduledFor: "42" }), {
          action: "post-text",
        })
      );
      expect(created().nominalScheduledFor).toBeUndefined();
      expect(created().scheduledFor).toBeUndefined();
    });

    it("maps repost and quote schedules, including fallbacks and rejected rows", async () => {
      const repostEvent = signedStub({ id: "repost-1" });
      const quoteEvent = signedStub({ id: "quote-1" });
      const form = postForm({
        repostSchedules: JSON.stringify([
          {
            scheduledFor: 10,
            signedEvent: repostEvent,
            minReactions: 0,
            minZaps: 2,
            minComments: 3,
            minReposts: 4,
            minSats: 5,
          },
          {
            scheduledFor: 11,
            signedEvent: repostEvent,
            minReactions: -1,
            minZaps: -2,
            minComments: -3,
            minReposts: -4,
            minSats: -5,
          },
          {
            scheduledFor: 12,
            signedEvent: repostEvent,
            minReactions: null,
            minZaps: 4,
          },
          { scheduledFor: "5", signedEvent: repostEvent },
          { scheduledFor: 13, signedEvent: null },
        ]),
        quoteSchedules: JSON.stringify([
          { scheduledFor: 20, signedEvent: quoteEvent, caption: "quoted" },
          { scheduledFor: 21, signedEvent: "nope" },
          null,
        ]),
        alsoScheduleRepost: "on",
        repostScheduledFor: "99",
        repostSignedEvent: JSON.stringify(signedStub({ id: "ignored" })),
      });

      await handlePostOrScheduleText(
        textParams(form, { action: "schedule-text" })
      );

      expect(created().repostSchedules).toEqual([
        {
          scheduledFor: 10,
          signedEvent: repostEvent,
          repostConditions: {
            minReactions: 0,
            minZaps: 2,
            minComments: 3,
            minReposts: 4,
            minSats: 5,
          },
        },
        { scheduledFor: 11, signedEvent: repostEvent },
        {
          scheduledFor: 12,
          signedEvent: repostEvent,
          repostConditions: { minZaps: 4 },
        },
        { scheduledFor: 13, signedEvent: null },
      ]);
      expect(created().quoteSchedules).toEqual([
        { scheduledFor: 20, signedEvent: quoteEvent, caption: "quoted" },
      ]);
    });

    it("falls back to the single repost and quote fields when the lists are empty or invalid", async () => {
      const repostEvent = signedStub({ id: "repost-fallback" });
      const quoteEvent = signedStub({ id: "quote-fallback" });
      await handlePostOrScheduleText(
        textParams(
          postForm({
            repostSchedules: "not-json",
            alsoScheduleRepost: "on",
            repostScheduledFor: "80",
            repostSignedEvent: JSON.stringify(repostEvent),
            quoteSchedules: "{}",
            alsoScheduleQuote: "on",
            quoteScheduledFor: "90",
            quoteSignedEvent: JSON.stringify(quoteEvent),
            quoteCaption: "cap",
          }),
          { action: "schedule-text" }
        )
      );

      expect(created().repostSchedules).toEqual([
        { scheduledFor: 80, signedEvent: repostEvent },
      ]);
      expect(created().quoteSchedules).toEqual([
        { scheduledFor: 90, signedEvent: quoteEvent, caption: "cap" },
      ]);

      mockCreate.mockClear();
      await handlePostOrScheduleText(
        textParams(
          postForm({
            repostSchedules: "[]",
            alsoScheduleRepost: "on",
            repostScheduledFor: "nope",
            repostSignedEvent: "not-json",
            alsoScheduleQuote: "on",
            quoteScheduledFor: "91",
            quoteSignedEvent: "not-json",
            quoteCaption: "",
          }),
          { action: "schedule-text" }
        )
      );
      expect(created().repostSchedules).toBeUndefined();
      expect(created().quoteSchedules).toBeUndefined();

      mockCreate.mockClear();
      const blobForm = postForm({
        alsoScheduleQuote: "on",
        quoteScheduledFor: "77",
        quoteSignedEvent: JSON.stringify(quoteEvent),
      });
      blobForm.set("quoteSchedules", new File(["[]"], "quotes.txt"));
      blobForm.set("repostSchedules", new File(["[]"], "reposts.txt"));
      await handlePostOrScheduleText(
        textParams(blobForm, { action: "schedule-text" })
      );
      expect(created().quoteSchedules).toEqual([
        { scheduledFor: 77, signedEvent: quoteEvent },
      ]);
      expect(created().repostSchedules).toBeUndefined();
    });

    it("rejects a bad signed event, a missing pubkey, and an invalid stored event", async () => {
      await expect(
        handlePostOrScheduleText(
          textParams(postForm({ signedEvent: "not-json" }), {
            action: "post-text",
          })
        )
      ).rejects.toThrow("Invalid signedEvent or nostrEvent format");

      await expect(
        handlePostOrScheduleText(
          textParams(postForm({ nostrEvent: "{" }), { action: "schedule-text" })
        )
      ).rejects.toThrow("Invalid signedEvent or nostrEvent format");

      await expect(
        handlePostOrScheduleText(
          textParams(
            postForm({
              signedEvent: JSON.stringify(signedStub({ pubkey: "" })),
            })
          )
        )
      ).rejects.toThrow("Missing signed event pubkey");

      mockCreate.mockResolvedValueOnce({
        post: { id: TEST_POST_ID, signedEvent: { bad: true } },
      });
      await expect(
        handlePostOrScheduleText(
          textParams(postForm(), { action: "post-text" })
        )
      ).rejects.toThrow("Invalid signedEvent after post creation");
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it("returns the contest payload for a scheduled post and propagates thrown failures", async () => {
      const scheduled = await handlePostOrScheduleText(
        textParams(postForm({ _embedContext: "contest" }), {
          action: "schedule-text",
        })
      );
      expect(scheduled).toEqual({ ok: true });
      expect(mockPublish).not.toHaveBeenCalled();

      mockPublish.mockRejectedValueOnce(new Error("publish-down"));
      await expect(
        handlePostOrScheduleText(
          textParams(postForm(), { action: "post-text" })
        )
      ).rejects.toThrow("publish-down");

      mockPublish.mockRejectedValueOnce("publish-string");
      await expect(
        handlePostOrScheduleText(
          textParams(postForm(), { action: "post-text" })
        )
      ).rejects.toBe("publish-string");

      mockCreate.mockRejectedValueOnce(new Error("create-down"));
      await expect(
        handlePostOrScheduleText(
          textParams(postForm(), { action: "schedule-text" })
        )
      ).rejects.toThrow("create-down");
    });
  });
});
