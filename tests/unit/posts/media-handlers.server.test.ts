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

interface MediaParams {
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
  correlationId?: string;
}

interface CreateInput {
  userId: string;
  content: string | null;
  caption: string | null;
  fileUrl: string[] | null;
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
  mockPublish:
    vi.fn<
      (input: {
        postId: string;
        userId: string;
        signedEvent: unknown;
        relays: string[];
        correlationId?: string;
      }) => Promise<void>
    >(),
  mockAssertMedia: vi.fn<(urls: string[] | null) => Promise<void>>(),
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
  handleDraftImages,
  handlePostImages,
  handleScheduleImages,
} from "~/features/posts/composer/services/newpost-action/handlers/media-handlers.server";

function signedStub(overrides: Partial<SignedStub> = {}): SignedStub {
  return {
    id: "event-1",
    pubkey: PK,
    created_at: 1_700_000_050,
    kind: 1,
    tags: [],
    content: "caption",
    sig: "sig",
    ...overrides,
  };
}

function mediaParams(
  formData: FormData,
  overrides: Partial<MediaParams> = {}
): MediaParams {
  return {
    userId: TEST_USER_ID,
    sessionPubkey: PK,
    formData,
    hashTagPresetTags: "#pic",
    showHashTagsinPosts: true,
    queueType: "photos",
    queueTypeId: "queue-9",
    isRecyclable: false,
    hashTagPresetId: "preset-9",
    sanitizedRelays: ["wss://relay.example"],
    correlationId: "cid-9",
    ...overrides,
  };
}

function created(): CreateInput {
  const input = mockCreate.mock.calls[0]?.[0];
  if (!input) throw new Error("create was not called");
  return input;
}

function imageForm(extra: Record<string, string> = {}): FormData {
  return createActionFormData("post-images", {
    caption: "look",
    fileUrl: JSON.stringify(["https://cdn.example/a.png"]),
    signedEvent: JSON.stringify(signedStub()),
    nostrEvent: JSON.stringify(signedStub()),
    submissionId: "sub-9",
    ...extra,
  });
}

describe("media handlers", () => {
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

  describe("handlePostImages", () => {
    it("publishes an image and a video, and treats an empty file list as an image", async () => {
      const image = await asRouteResponse(
        await handlePostImages(mediaParams(imageForm()))
      );
      expect(image.status).toBe(302);
      expect(image.headers.get("Location")).toBe(
        `/dashboard/compose?type=post&published=${TEST_POST_ID}`
      );
      expect(created().postType).toBe("IMAGE");
      expect(created().content).toBe("look\n#pic");
      expect(created().fileUrl).toEqual(["https://cdn.example/a.png"]);
      expect(created().submissionId).toBe("sub-9");
      expect(mockPublish).toHaveBeenCalledWith({
        postId: TEST_POST_ID,
        userId: TEST_USER_ID,
        signedEvent: signedStub(),
        relays: ["wss://relay.example"],
        correlationId: "cid-9",
      });

      mockCreate.mockClear();
      const params = mediaParams(
        imageForm({
          fileUrl: JSON.stringify(["https://cdn.example/clip.MP4"]),
          caption: "look #pic",
        }),
        { showHashTagsinPosts: true }
      );
      delete params.sanitizedRelays;
      await handlePostImages(params);
      expect(created().postType).toBe("VIDEO");
      expect(created().content).toBe("look #pic");
      expect(mockPublish.mock.calls[1]?.[0].relays).toEqual([]);

      mockCreate.mockClear();
      await handlePostImages(
        mediaParams(imageForm({ fileUrl: "", caption: "" }), {
          hashTagPresetTags: "",
          showHashTagsinPosts: false,
        })
      );
      expect(created().postType).toBe("IMAGE");
      expect(created().fileUrl).toEqual([]);
      expect(created().content).toBe("");
      expect(mockAssertMedia).toHaveBeenCalledWith([]);
    });

    it("publishes a null file list as an image and rejects invalid file JSON", async () => {
      await handlePostImages(mediaParams(imageForm({ fileUrl: "null" })));
      expect(created().postType).toBe("IMAGE");
      expect(created().fileUrl).toBeNull();
      expect(mockAssertMedia).toHaveBeenCalledWith(null);

      mockCreate.mockClear();
      mockAssertMedia.mockClear();
      await expect(
        handlePostImages(mediaParams(imageForm({ fileUrl: "[" })))
      ).rejects.toThrow(SyntaxError);
      expect(mockAssertMedia).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns contest JSON and rejects bad events", async () => {
      const result = await handlePostImages(
        mediaParams(imageForm({ _embedContext: "contest" }))
      );
      expect(result).toEqual({ ok: true });
      expect(mockJsonContest).toHaveBeenCalledWith(TEST_USER_ID, TEST_POST_ID);

      await expect(
        handlePostImages(mediaParams(imageForm({ signedEvent: "nope" })))
      ).rejects.toThrow("Invalid signedEvent or nostrEvent format");
      await expect(
        handlePostImages(mediaParams(imageForm({ nostrEvent: "{" })))
      ).rejects.toThrow("Invalid signedEvent or nostrEvent format");
      await expect(
        handlePostImages(
          mediaParams(
            imageForm({
              signedEvent: JSON.stringify(signedStub({ pubkey: "" })),
            })
          )
        )
      ).rejects.toThrow("Missing signed event pubkey");

      mockCreate.mockResolvedValueOnce({
        post: { id: TEST_POST_ID, signedEvent: { bad: true } },
      });
      await expect(handlePostImages(mediaParams(imageForm()))).rejects.toThrow(
        "Invalid signedEvent after post creation"
      );

      mockPublish.mockRejectedValueOnce(new Error("publish-down"));
      await expect(handlePostImages(mediaParams(imageForm()))).rejects.toThrow(
        "publish-down"
      );
      mockPublish.mockRejectedValueOnce("publish-string");
      await expect(handlePostImages(mediaParams(imageForm()))).rejects.toBe(
        "publish-string"
      );
      mockAssertMedia.mockRejectedValueOnce("media-string");
      await expect(handlePostImages(mediaParams(imageForm()))).rejects.toBe(
        "media-string"
      );
    });
  });

  describe("handleScheduleImages", () => {
    it("schedules an image with repost conditions, quotes, and a nominal time", async () => {
      const repostEvent = signedStub({ id: "repost-1" });
      const quoteEvent = signedStub({ id: "quote-1" });
      const response = await asRouteResponse(
        await handleScheduleImages(
          mediaParams(
            imageForm({
              fileUrl: JSON.stringify(["https://cdn.example/a.png"]),
              nominalScheduledFor: "1700002222",
              repostSchedules: JSON.stringify([
                {
                  scheduledFor: 10,
                  signedEvent: repostEvent,
                  minReactions: 1,
                  minZaps: 0,
                  minComments: -1,
                  minReposts: null,
                  minSats: 8,
                },
                { scheduledFor: "bad", signedEvent: repostEvent },
              ]),
              quoteSchedules: JSON.stringify([
                { scheduledFor: 30, signedEvent: quoteEvent, caption: "q" },
              ]),
              alsoScheduleRepost: "on",
              repostScheduledFor: "1",
              repostSignedEvent: JSON.stringify(signedStub({ id: "ignored" })),
            })
          )
        )
      );

      expect(response.headers.get("Location")).toBe(
        `/dashboard/compose?type=post&scheduled=${TEST_POST_ID}`
      );
      expect(created().postType).toBe("IMAGE");
      expect(created().scheduledFor).toBe(1_700_000_050);
      expect(created().nominalScheduledFor).toBe(1_700_002_222);
      expect(created().repostSchedules).toEqual([
        {
          scheduledFor: 10,
          signedEvent: repostEvent,
          repostConditions: { minReactions: 1, minZaps: 0, minSats: 8 },
        },
      ]);
      expect(created().quoteSchedules).toEqual([
        { scheduledFor: 30, signedEvent: quoteEvent, caption: "q" },
      ]);
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it("schedules a video and falls back to single repost and quote fields", async () => {
      const repostEvent = signedStub({ id: "repost-fallback" });
      const quoteEvent = signedStub({ id: "quote-fallback" });
      await handleScheduleImages(
        mediaParams(
          imageForm({
            fileUrl: JSON.stringify(["https://cdn.example/a.webm"]),
            repostSchedules: "not-json",
            alsoScheduleRepost: "on",
            repostScheduledFor: "40",
            repostSignedEvent: JSON.stringify(repostEvent),
            quoteSchedules: "[]",
            alsoScheduleQuote: "on",
            quoteScheduledFor: "50",
            quoteSignedEvent: JSON.stringify(quoteEvent),
            quoteCaption: "",
            nominalScheduledFor: "   ",
          }),
          { showHashTagsinPosts: false }
        )
      );

      expect(created().postType).toBe("VIDEO");
      expect(created().content).toBe("look");
      expect(created().nominalScheduledFor).toBeUndefined();
      expect(created().repostSchedules).toEqual([
        { scheduledFor: 40, signedEvent: repostEvent },
      ]);
      expect(created().quoteSchedules).toEqual([
        {
          scheduledFor: 50,
          signedEvent: quoteEvent,
          caption: undefined,
        },
      ]);

      mockCreate.mockClear();
      await handleScheduleImages(
        mediaParams(
          imageForm({
            alsoScheduleRepost: "on",
            repostScheduledFor: "nope",
            repostSignedEvent: "{",
            alsoScheduleQuote: "true",
            quoteScheduledFor: "60",
            quoteSignedEvent: JSON.stringify(quoteEvent),
          })
        )
      );
      expect(created().repostSchedules).toBeUndefined();
      expect(created().quoteSchedules).toBeUndefined();
    });

    it("swallows a null schedule row and rejects an invalid signed event", async () => {
      const swallowed = await asRouteResponse(
        await handleScheduleImages(
          mediaParams(imageForm({ repostSchedules: JSON.stringify([null]) }))
        )
      );
      expect(swallowed.status).toBe(302);
      expect(created().repostSchedules).toBeUndefined();

      await expect(
        handleScheduleImages(mediaParams(imageForm({ signedEvent: "bad" })))
      ).rejects.toThrow("Invalid signedEvent or nostrEvent format");

      const contest = await handleScheduleImages(
        mediaParams(imageForm({ _embedContext: "contest" }))
      );
      expect(contest).toEqual({ ok: true });

      mockCreate.mockRejectedValueOnce("create-string");
      await expect(handleScheduleImages(mediaParams(imageForm()))).rejects.toBe(
        "create-string"
      );
    });

    it("drops a non-finite nominal time", async () => {
      await handleScheduleImages(
        mediaParams(imageForm({ nominalScheduledFor: "nope" }))
      );
      expect(created().nominalScheduledFor).toBeUndefined();
      expect(created().scheduledFor).toBe(1_700_000_050);
    });
  });

  describe("handleDraftImages", () => {
    it("stores an image, a video, or an empty draft and redirects", async () => {
      const image = await asRouteResponse(
        await handleDraftImages(
          mediaParams(
            createActionFormData("draft-images", {
              caption: "draft",
              fileUrl: JSON.stringify(["https://cdn.example/a.png"]),
              submissionId: "draft-sub",
            })
          )
        )
      );
      expect(image.headers.get("Location")).toBe("/dashboard/drafts");
      expect(created().postType).toBe("IMAGE");
      expect(created().content).toBe("draft\n#pic");
      expect(created().submissionId).toBe("draft-sub");
      expect(created().signedEvent).toBeUndefined();

      mockCreate.mockClear();
      await handleDraftImages(
        mediaParams(
          createActionFormData("draft-images", {
            caption: "clip",
            fileUrl: JSON.stringify(["https://cdn.example/a.mov"]),
          }),
          { showHashTagsinPosts: false }
        )
      );
      expect(created().postType).toBe("VIDEO");
      expect(created().content).toBe("clip");

      mockCreate.mockClear();
      await handleDraftImages(
        mediaParams(createActionFormData("draft-images", { fileUrl: "[]" }), {
          hashTagPresetTags: "",
          showHashTagsinPosts: false,
        })
      );
      expect(created().postType).toBe("IMAGE");
      expect(created().fileUrl).toEqual([]);
      expect(created().content).toBeNull();
    });

    it("throws when caption is missing and hashtags must be applied, or file JSON is bad", async () => {
      await expect(
        handleDraftImages(
          mediaParams(createActionFormData("draft-images", { fileUrl: "" }))
        )
      ).rejects.toThrow(TypeError);

      await expect(
        handleDraftImages(
          mediaParams(
            createActionFormData("draft-images", {
              fileUrl: "null",
              caption: "ok",
            })
          )
        )
      ).rejects.toThrow(TypeError);

      await expect(
        handleDraftImages(
          mediaParams(
            createActionFormData("draft-images", {
              fileUrl: "[",
              caption: "ok",
            }),
            { showHashTagsinPosts: false }
          )
        )
      ).rejects.toThrow(SyntaxError);

      mockAssertMedia.mockRejectedValueOnce(new Error("media-down"));
      await expect(
        handleDraftImages(
          mediaParams(
            createActionFormData("draft-images", {
              caption: "ok",
              fileUrl: "[]",
            }),
            { showHashTagsinPosts: false }
          )
        )
      ).rejects.toThrow("media-down");
    });
  });
});
