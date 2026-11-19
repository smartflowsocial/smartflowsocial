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
  queueTypeId: string | null | undefined;
  isRecyclable: boolean;
  hashTagPresetId: string | null | undefined;
  sanitizedRelays?: string[];
  action?: string;
  correlationId?: string;
}

interface PollParams {
  userId: string;
  sessionPubkey: string;
  formData: FormData;
  sanitizedRelays: string[];
  action: string;
  correlationId?: string;
  queueType: string;
  queueTypeId: string | null;
  isRecyclable: boolean;
  hashTagPresetId: string | null;
}

interface PostRecord {
  id: string;
  queueTypeId: string | null;
  dependencyMode?: string | null;
  parentScheduledActionId?: string | null;
  draftMeta?: unknown;
  scheduledAtUtc?: Date | null;
  currentState?: string;
}

interface UpdateArgs {
  id: string;
  userId: string;
  data: {
    content: string;
    caption: string;
    fileUrl: string[];
    queueTypeId: string | null;
    scheduledAtUtc?: number;
    signedEvent?: SignedStub;
    nostrEvent?: SignedStub;
    hashTagPresetId: string | null;
  };
}

interface ScheduleArgs {
  postId: string;
  userId: string;
  scheduledAtUtc: unknown;
  signedEvent: SignedStub;
}

interface ValidateRef {
  current: ((formData: FormData, schema: unknown) => unknown) | null;
}

interface ValidationModule {
  validateFormDataOrRespond: (formData: FormData, schema: unknown) => unknown;
  [key: string]: unknown;
}

const EVENT: SignedStub = {
  id: "event-1",
  pubkey: "pk",
  created_at: 1_700_000_000,
  kind: 1,
  tags: [],
  content: "hi",
  sig: "sig",
};

const {
  ScheduleCapExceededError,
  PublishEventMismatchError,
  mockValidate,
  validateRef,
  mockParseFormData,
  mockGetUser,
  mockRelays,
  mockLogInfo,
  mockLogWarning,
  mockDraftText,
  mockPostText,
  mockDraftImages,
  mockPostImages,
  mockScheduleImages,
  mockHashtags,
  mockPoll,
  mockResolvePoll,
  mockUpload,
  mockSaveDraft,
  mockThread,
  mockGetPost,
  mockUpdate,
  mockCascade,
  mockResync,
  mockScheduleExecute,
} = vi.hoisted(() => {
  class ScheduleCapExceededError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ScheduleCapExceededError";
    }
  }

  class PublishEventMismatchError extends Error {
    readonly postId: string;
    readonly existingEventId: string | null;
    readonly attemptedEventId: string;

    constructor(input: {
      postId: string;
      existingEventId: string | null;
      attemptedEventId: string;
    }) {
      super("mismatch");
      this.name = "PublishEventMismatchError";
      this.postId = input.postId;
      this.existingEventId = input.existingEventId;
      this.attemptedEventId = input.attemptedEventId;
    }
  }

  const ref: ValidateRef = { current: null };
  return {
    ScheduleCapExceededError,
    PublishEventMismatchError,
    validateRef: ref,
    mockValidate: vi.fn<(formData: FormData, schema: unknown) => unknown>(),
    mockParseFormData:
      vi.fn<
        (
          request: Request,
          options: { maxFileSize: number }
        ) => Promise<FormData>
      >(),
    mockGetUser: vi.fn<(id: string) => Promise<{ npub: string } | null>>(),
    mockRelays: vi.fn<
      (
        userId: string,
        formData: FormData
      ) => Promise<{
        relays: string[];
        source: string;
      }>
    >(),
    mockLogInfo: vi.fn<(message: string, context?: unknown) => void>(),
    mockLogWarning: vi.fn<(message: string, context?: unknown) => void>(),
    mockDraftText: vi.fn<(params: TextParams) => Promise<unknown>>(),
    mockPostText: vi.fn<(params: TextParams) => Promise<unknown>>(),
    mockDraftImages: vi.fn<(params: TextParams) => Promise<unknown>>(),
    mockPostImages: vi.fn<(params: TextParams) => Promise<unknown>>(),
    mockScheduleImages: vi.fn<(params: TextParams) => Promise<unknown>>(),
    mockHashtags:
      vi.fn<
        (
          userId: string,
          enabled: boolean,
          presetId: string | null,
          queueType: string,
          queueTypeId: string | null | undefined
        ) => Promise<unknown>
      >(),
    mockPoll: vi.fn<(params: PollParams) => Promise<unknown>>(),
    mockResolvePoll:
      vi.fn<
        (
          userId: string,
          enabled: boolean,
          presetId: string | null,
          queueType: string,
          queueTypeId: string | null
        ) => Promise<{ hashTagPresetId: string | null }>
      >(),
    mockUpload:
      vi.fn<
        (formData: FormData) => {
          success: boolean;
          error?: string;
          fileUrls?: string[];
        }
      >(),
    mockSaveDraft:
      vi.fn<(userId: string, formData: FormData) => Promise<unknown>>(),
    mockThread:
      vi.fn<
        (
          userId: string,
          sessionPubkey: string,
          formData: FormData,
          relays: string[]
        ) => Promise<unknown>
      >(),
    mockGetPost:
      vi.fn<
        (input: { id: string; userId: string }) => Promise<PostRecord | null>
      >(),
    mockUpdate: vi.fn<(input: UpdateArgs) => Promise<{ id: string }>>(),
    mockCascade: vi.fn<(input: unknown) => Promise<void>>(),
    mockResync: vi.fn<(input: unknown) => Promise<void>>(),
    mockScheduleExecute: vi.fn<(input: ScheduleArgs) => Promise<void>>(),
  };
});

vi.mock("~/features/payments/entitlements/schedule-cap-policy.server", () => ({
  ScheduleCapExceededError,
}));

vi.mock("~/features/posts/server/publishing", () => ({
  PublishEventMismatchError,
}));

vi.mock("~/lib/validation", async () => {
  const actual = await vi.importActual<ValidationModule>("~/lib/validation");
  return {
    ...actual,
    validateFormDataOrRespond: (formData: FormData, schema: unknown) =>
      mockValidate(formData, schema),
  };
});

vi.mock("@remix-run/form-data-parser", () => ({
  parseFormData: mockParseFormData,
}));

vi.mock("~/features/user", () => ({
  getUserById: mockGetUser,
}));

vi.mock("~/features/relays/relay-resolution.server", () => ({
  resolveExecutionRelaysFromFormDetailed: mockRelays,
}));

vi.mock("~/lib/error-logger.server", () => ({
  logInfo: mockLogInfo,
  logWarning: mockLogWarning,
}));

vi.mock(
  "~/features/posts/composer/services/newpost-action/handlers/text-handlers.server",
  () => {
    function toRecord(value: unknown): Record<string, unknown> | null {
      if (typeof value !== "object" || value === null) return null;
      if (Object.prototype.toString.call(value) === "[object Array]") {
        return null;
      }
      return value as Record<string, unknown>;
    }

    return {
      handleDraftText: mockDraftText,
      handlePostOrScheduleText: mockPostText,
      parseAttachmentMeta: (formData: FormData) => {
        const raw = formData.get("attachmentMeta");
        if (typeof raw !== "string" || raw === "") return [];
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return [];
        }
        if (Object.prototype.toString.call(parsed) !== "[object Array]") {
          return [];
        }
        const items: Array<{ localId: string; url?: string }> = [];
        for (const entry of parsed as unknown[]) {
          const record = toRecord(entry);
          if (!record) continue;
          const localId = record["localId"];
          if (typeof localId !== "string") continue;
          const item: { localId: string; url?: string } = { localId };
          const url = record["url"];
          if (typeof url === "string") item.url = url;
          items.push(item);
        }
        return items;
      },
    };
  }
);

vi.mock(
  "~/features/posts/composer/services/newpost-action/handlers/media-handlers.server",
  () => ({
    handleDraftImages: mockDraftImages,
    handlePostImages: mockPostImages,
    handleScheduleImages: mockScheduleImages,
  })
);

vi.mock(
  "~/features/posts/composer/services/newpost-action/hashtag-preset-utils.server",
  () => ({
    getHashtagPresetTags: mockHashtags,
  })
);

vi.mock(
  "~/features/posts/composer/services/newpost-action/poll-handlers.server",
  () => ({
    handlePostOrSchedulePoll: mockPoll,
    resolvePollHashtagContext: mockResolvePoll,
  })
);

vi.mock(
  "~/features/posts/composer/services/newpost-action/upload-preview-handler.server",
  () => ({
    handleUploadPreview: mockUpload,
  })
);

vi.mock(
  "~/features/posts/composer/services/newpost-action/autosave-draft.server",
  () => ({
    handleSaveDraft: mockSaveDraft,
  })
);

vi.mock(
  "~/features/posts/composer/services/newpost-action/thread-handlers.server",
  () => ({
    handleThreadAction: mockThread,
  })
);

vi.mock("~/features/posts/server", () => ({
  getPostById: mockGetPost,
  updatePost: mockUpdate,
}));

vi.mock("~/features/posts/scheduling/index.server", () => ({
  cascadeAttachedReschedule: mockCascade,
  resyncAttachedChildrenAfterParentMutation: mockResync,
  SchedulePostUseCase: class {
    execute = mockScheduleExecute;
  },
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: { post: { findUnique: vi.fn() } },
}));

import { asRouteResponse } from "../../utils/action-test-helpers";
import {
  createMockUser,
  setupFetchMock,
  TEST_USER_ID,
} from "../../utils/mock-helpers";
import { createActionFormData } from "../../utils/test-helpers";

import { handleNewPostAction } from "~/features/posts/composer/services/newpost-action.server";
import { DEFAULT_MEMORY_PART_BYTES } from "~/features/upload/validation.server";
import { fromUnixTimestamp } from "~/lib/temporal";

const posts = new Map<string, PostRecord>();

function remember(post: PostRecord): void {
  posts.set(post.id, post);
}

function requestFromForm(
  form: FormData,
  headers?: Record<string, string>
): Request {
  const params = new URLSearchParams();
  form.forEach((value, key) => {
    if (typeof value === "string") params.append(key, value);
  });
  return new Request("https://example.test/dashboard/compose", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: params,
  });
}

function multipartRequest(form: FormData): Request {
  return new Request("https://example.test/dashboard/compose", {
    method: "POST",
    body: form,
  });
}

async function bodyOf(
  result: unknown
): Promise<{ status: number; body: unknown; location: string | null }> {
  const response = await asRouteResponse(result);
  let body: unknown = null;
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("json")) {
    body = await response.json();
  }
  return {
    status: response.status,
    body,
    location: response.headers.get("Location"),
  };
}

function errorOf(body: unknown): string {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    throw new Error("missing error");
  }
  if (typeof body.error !== "string") throw new Error("error is not a string");
  return body.error;
}

function scheduledPost(overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    id: "target-1",
    queueTypeId: "from-post",
    dependencyMode: null,
    parentScheduledActionId: null,
    draftMeta: null,
    scheduledAtUtc: null,
    ...overrides,
  };
}

describe("handleNewPostAction", () => {
  beforeEach(async () => {
    posts.clear();
    vi.clearAllMocks();
    setupFetchMock();
    if (!validateRef.current) {
      const actual =
        await vi.importActual<ValidationModule>("~/lib/validation");
      validateRef.current = (formData: FormData, schema: unknown) =>
        actual.validateFormDataOrRespond(formData, schema);
    }
    const validate = validateRef.current;
    mockValidate.mockImplementation((formData, schema) =>
      validate(formData, schema)
    );
    mockGetUser.mockResolvedValue(createMockUser({ npub: "pk-session" }));
    mockRelays.mockResolvedValue({
      relays: ["wss://relay.one", "wss://relay.two"],
      source: "account",
    });
    mockHashtags.mockResolvedValue({ tags: "#tag", presetId: "preset-1" });
    mockResolvePoll.mockResolvedValue({ hashTagPresetId: "preset-resolved" });
    mockParseFormData.mockRejectedValue(new Error("unexpected parseFormData"));
    mockGetPost.mockImplementation(
      async (input) => posts.get(input.id) ?? null
    );
    mockUpdate.mockImplementation(async (input) => ({ id: input.id }));
    mockCascade.mockResolvedValue(undefined);
    mockResync.mockResolvedValue(undefined);
    mockScheduleExecute.mockResolvedValue(undefined);
    const marker = { handled: true };
    mockDraftText.mockResolvedValue(marker);
    mockPostText.mockResolvedValue(marker);
    mockDraftImages.mockResolvedValue(marker);
    mockPostImages.mockResolvedValue(marker);
    mockScheduleImages.mockResolvedValue(marker);
    mockPoll.mockResolvedValue(marker);
    mockThread.mockResolvedValue(marker);
    mockSaveDraft.mockResolvedValue(marker);
    mockUpload.mockReturnValue({
      success: true,
      fileUrls: ["https://cdn/a.png"],
    });
  });

  it("returns 404 when the user is missing and rethrows unknown failures", async () => {
    mockGetUser.mockResolvedValueOnce(null);
    const missing = await asRouteResponse(
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(createActionFormData("draft-text"))
      )
    );
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("User not found");

    mockGetUser.mockRejectedValueOnce("boom");
    await expect(
      handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(createActionFormData("draft-text"))
      )
    ).rejects.toBe("boom");

    const error = new Error("explode");
    mockGetUser.mockRejectedValueOnce(error);
    await expect(
      handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(createActionFormData("draft-text"))
      )
    ).rejects.toBe(error);
  });

  it("maps schedule-cap and publish-mismatch errors to 403 and 409", async () => {
    mockGetUser.mockRejectedValueOnce(new ScheduleCapExceededError("over cap"));
    const capped = await bodyOf(
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(createActionFormData("draft-text"))
      )
    );
    expect(capped.status).toBe(403);
    expect(errorOf(capped.body)).toBe("over cap");

    mockGetUser.mockRejectedValueOnce(
      new PublishEventMismatchError({
        postId: "post-9",
        existingEventId: "old",
        attemptedEventId: "new",
      })
    );
    const mismatch = await bodyOf(
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(createActionFormData("draft-text"))
      )
    );
    expect(mismatch.status).toBe(409);
    expect(mismatch.body).toEqual({
      error:
        "This post id is already published with a different signed event. Please try publishing again as a new post.",
      code: "PUBLISH_EVENT_MISMATCH",
      postId: "post-9",
    });
  });

  it("rejects a multipart body that still contains a file and logs an empty action", async () => {
    const form = new FormData();
    form.set("_action", "");
    form.set("upload", new File(["x"], "a.png", { type: "image/png" }));
    mockParseFormData.mockResolvedValue(form);
    const request = multipartRequest(form);

    const result = await bodyOf(
      await handleNewPostAction(TEST_USER_ID, request)
    );

    expect(result.status).toBe(410);
    expect(errorOf(result.body)).toBe(
      "Upload media client-side via Blossom first, then submit URLs."
    );
    expect(mockParseFormData).toHaveBeenCalledWith(request, {
      maxFileSize: DEFAULT_MEMORY_PART_BYTES,
    });
    expect(mockLogWarning).toHaveBeenCalledWith(
      "Multipart media upload on newpost route rejected",
      {
        userId: TEST_USER_ID,
        action: "unknown",
        route: "/dashboard/compose",
      }
    );
    expect(mockLogInfo).toHaveBeenCalledWith("publish.relays.resolved", {
      userId: TEST_USER_ID,
      action: "unknown",
      source: "account",
      relayCount: 2,
      relays: ["wss://relay.one", "wss://relay.two"],
    });
    expect(mockDraftText).not.toHaveBeenCalled();
  });

  it("parses multipart forms without files and urlencoded forms without the parser", async () => {
    const form = createActionFormData("draft-text", { content: "Hello" });
    mockParseFormData.mockResolvedValue(form);
    const multipart = multipartRequest(form);
    await handleNewPostAction(TEST_USER_ID, multipart);
    expect(mockParseFormData).toHaveBeenCalledTimes(1);
    expect(mockDraftText).toHaveBeenCalledTimes(1);

    mockParseFormData.mockClear();
    mockDraftText.mockClear();
    await handleNewPostAction(
      TEST_USER_ID,
      requestFromForm(
        createActionFormData("draft-text", { content: "Hello" }),
        {
          "X-Correlation-Id": "cid-1",
        }
      )
    );
    expect(mockParseFormData).not.toHaveBeenCalled();
    expect(mockDraftText.mock.calls[0]?.[0].correlationId).toBe("cid-1");
    expect(mockDraftText.mock.calls[0]?.[0].sessionPubkey).toBe("pk-session");
  });

  it("returns upload preview success, a preview error, and the default preview error", async () => {
    for (const action of ["upload-images-preview", "upload-media-preview"]) {
      mockUpload.mockReturnValueOnce({
        success: true,
        fileUrls: ["https://cdn.example/a.png"],
      });
      const success = await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(createActionFormData(action))
      );
      expect(success).toEqual({
        success: true,
        fileUrls: ["https://cdn.example/a.png"],
      });
    }

    mockUpload.mockReturnValueOnce({ success: false, error: "bad files" });
    const failed = await bodyOf(
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(createActionFormData("upload-images-preview"))
      )
    );
    expect(failed.status).toBe(400);
    expect(errorOf(failed.body)).toBe("bad files");

    mockUpload.mockReturnValueOnce({ success: false });
    const fallback = await bodyOf(
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(createActionFormData("upload-media-preview"))
      )
    );
    expect(fallback.status).toBe(400);
    expect(errorOf(fallback.body)).toBe("Upload preview failed");
  });

  it("saves a draft and rejects a missing or non-draft update", async () => {
    const saved = { saved: true };
    mockSaveDraft.mockResolvedValue(saved);
    const draft = await handleNewPostAction(
      TEST_USER_ID,
      requestFromForm(createActionFormData("save-draft", { content: "Hi" }))
    );
    expect(draft).toBe(saved);
    expect(mockSaveDraft.mock.calls[0]?.[0]).toBe(TEST_USER_ID);
    expect(mockSaveDraft.mock.calls[0]?.[1].get("content")).toBe("Hi");

    const missing = await bodyOf(
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(createActionFormData("update-draft", { draftId: "  " }))
      )
    );
    expect(missing.status).toBe(400);
    expect(errorOf(missing.body)).toBe("Missing draftId for update.");

    const absent = await bodyOf(
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(
          createActionFormData("update-draft", { draftId: "missing-draft" })
        )
      )
    );
    expect(absent.status).toBe(404);
    expect(errorOf(absent.body)).toBe(
      "Draft no longer exists or is not editable."
    );

    remember({ id: "draft-1", queueTypeId: null, currentState: "PUBLISHED" });
    const published = await bodyOf(
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(
          createActionFormData("update-draft", { draftId: "draft-1" })
        )
      )
    );
    expect(published.status).toBe(404);

    remember({ id: "draft-2", queueTypeId: null, currentState: "DRAFT" });
    const updated = await handleNewPostAction(
      TEST_USER_ID,
      requestFromForm(
        createActionFormData("update-draft", { draftId: "draft-2" })
      )
    );
    expect(updated).toBe(saved);
    expect(mockGetPost).toHaveBeenCalledWith({
      id: "draft-2",
      userId: TEST_USER_ID,
    });
  });

  it("routes thread and poll actions before schema validation", async () => {
    const threadMarker = { thread: true };
    mockThread.mockResolvedValue(threadMarker);
    for (const action of ["post-thread", "schedule-thread"]) {
      const result = await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(createActionFormData(action))
      );
      expect(result).toBe(threadMarker);
    }
    expect(mockThread).toHaveBeenCalledTimes(2);
    expect(mockThread.mock.calls[0]?.[0]).toBe(TEST_USER_ID);
    expect(mockThread.mock.calls[0]?.[1]).toBe("pk-session");
    expect(mockThread.mock.calls[0]?.[3]).toEqual([
      "wss://relay.one",
      "wss://relay.two",
    ]);
    expect(mockValidate).not.toHaveBeenCalled();

    const pollForm = createActionFormData("post-poll", {
      queueType: "news",
      queueTypeId: "  q1  ",
      isRecyclable: "on",
      useHashtagPresets: "on",
      hashTagPresetId: "preset-9",
    });
    await handleNewPostAction(TEST_USER_ID, requestFromForm(pollForm));
    const poll = mockPoll.mock.calls[0]?.[0];
    expect(poll?.action).toBe("post-poll");
    expect(poll?.queueType).toBe("news");
    expect(poll?.queueTypeId).toBe("  q1  ");
    expect(poll?.isRecyclable).toBe(true);
    expect(poll?.hashTagPresetId).toBe("preset-resolved");
    expect(poll?.sanitizedRelays).toEqual([
      "wss://relay.one",
      "wss://relay.two",
    ]);
    expect(mockResolvePoll).toHaveBeenCalledWith(
      TEST_USER_ID,
      true,
      "preset-9",
      "news",
      "  q1  "
    );

    mockPoll.mockClear();
    mockResolvePoll.mockClear();
    await handleNewPostAction(
      TEST_USER_ID,
      requestFromForm(
        createActionFormData("schedule-poll", {
          queueTypeId: "   ",
          isRecyclable: "true",
          useHashtagPresets: "on",
          hashTagPresetId: "",
        })
      )
    );
    expect(mockPoll.mock.calls[0]?.[0].action).toBe("schedule-poll");
    expect(mockPoll.mock.calls[0]?.[0].queueType).toBe("unassigned");
    expect(mockPoll.mock.calls[0]?.[0].queueTypeId).toBeNull();
    expect(mockPoll.mock.calls[0]?.[0].isRecyclable).toBe(false);
    expect(mockResolvePoll).toHaveBeenCalledWith(
      TEST_USER_ID,
      true,
      null,
      "unassigned",
      null
    );

    mockResolvePoll.mockClear();
    await handleNewPostAction(
      TEST_USER_ID,
      requestFromForm(
        createActionFormData("post-poll", {
          useHashtagPresets: "off",
          hashTagPresetId: "ignored",
        })
      )
    );
    expect(mockResolvePoll).toHaveBeenCalledWith(
      TEST_USER_ID,
      false,
      null,
      "unassigned",
      null
    );
  });

  it("returns 400 for an unknown action and { success: false } when validation is forced through", async () => {
    const invalid = await bodyOf(
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(createActionFormData("nope"))
      )
    );
    expect(invalid.status).toBe(400);
    expect(errorOf(invalid.body).length).toBeGreaterThan(0);
    expect(mockHashtags).not.toHaveBeenCalled();

    mockValidate.mockImplementation(() => ({
      success: true,
      data: {
        _action: "noop",
        queueType: "news",
        queueTypeId: null,
        isRecyclable: false,
        useHashtagPresets: false,
        hashTagPresetId: null,
        caption: "",
        scheduledFor: null,
        content: "",
      },
    }));
    const fallthrough = await handleNewPostAction(
      TEST_USER_ID,
      requestFromForm(createActionFormData("noop"))
    );
    expect(fallthrough).toEqual({ success: false });
    expect(mockDraftText).not.toHaveBeenCalled();
  });

  it("passes validated text and media actions with hashtag and relay context", async () => {
    const textMarker = { kind: "text" };
    mockDraftText.mockResolvedValue(textMarker);
    const draft = await handleNewPostAction(
      TEST_USER_ID,
      requestFromForm(
        createActionFormData("draft-text", {
          content: "Hello",
          queueType: "news",
          queueTypeId: "q-1",
          isRecyclable: "on",
          useHashtagPresets: "on",
          hashTagPresetId: "h-1",
        }),
        { "X-Correlation-Id": "cid-2" }
      )
    );
    expect(draft).toBe(textMarker);
    const params = mockDraftText.mock.calls[0]?.[0];
    expect(params?.queueType).toBe("news");
    expect(params?.queueTypeId).toBe("q-1");
    expect(params?.isRecyclable).toBe(true);
    expect(params?.hashTagPresetId).toBe("preset-1");
    expect(params?.hashTagPresetTags).toBe("#tag");
    expect(params?.showHashTagsinPosts).toBe(true);
    expect(params?.correlationId).toBe("cid-2");
    expect(mockHashtags).toHaveBeenCalledWith(
      TEST_USER_ID,
      true,
      "h-1",
      "news",
      "q-1"
    );

    mockPostText.mockClear();
    for (const action of ["post-text", "schedule-text"]) {
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(createActionFormData(action, { content: "Hello" }))
      );
      expect(mockPostText.mock.calls.at(-1)?.[0].action).toBe(action);
      expect(mockPostText.mock.calls.at(-1)?.[0].sanitizedRelays).toEqual([
        "wss://relay.one",
        "wss://relay.two",
      ]);
    }

    const postActions = ["post-image", "post-images", "post-media"] as const;
    for (const action of postActions) {
      mockPostImages.mockClear();
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(createActionFormData(action, { caption: "pic" }))
      );
      expect(mockPostImages).toHaveBeenCalledTimes(1);
    }

    const scheduleActions = [
      "schedule-image",
      "schedule-images",
      "schedule-media",
    ] as const;
    for (const action of scheduleActions) {
      mockScheduleImages.mockClear();
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(createActionFormData(action, { caption: "pic" }))
      );
      expect(mockScheduleImages).toHaveBeenCalledTimes(1);
      expect(
        mockScheduleImages.mock.calls[0]?.[0].sanitizedRelays
      ).toBeUndefined();
    }

    const draftActions = [
      "draft-image",
      "draft-images",
      "draft-media",
    ] as const;
    for (const action of draftActions) {
      mockDraftImages.mockClear();
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(createActionFormData(action, { caption: "pic" }))
      );
      expect(mockDraftImages).toHaveBeenCalledTimes(1);
    }
  });

  it("normalizes empty queue fields, hashtag shapes, and the hashtag body toggle", async () => {
    await handleNewPostAction(
      TEST_USER_ID,
      requestFromForm(
        createActionFormData("draft-text", {
          content: "Hello",
          queueType: "",
          includeHashtagsInNoteBody: "",
        })
      )
    );
    expect(mockDraftText.mock.calls[0]?.[0].queueType).toBe("unassigned");
    expect(mockDraftText.mock.calls[0]?.[0].showHashTagsinPosts).toBe(false);

    mockDraftText.mockClear();
    await handleNewPostAction(
      TEST_USER_ID,
      requestFromForm(createActionFormData("draft-text", { content: "Hello" }))
    );
    expect(mockDraftText.mock.calls[0]?.[0].showHashTagsinPosts).toBe(true);
    expect(mockDraftText.mock.calls[0]?.[0].isRecyclable).toBe(false);

    const shapes: unknown[] = [
      { tags: 3, presetId: "from-shape" },
      { presetId: null },
      { tags: "#only" },
      ["#a"],
      "nope",
    ];
    const expected: Array<{
      tags: string;
      presetId: string | null | undefined;
    }> = [
      { tags: "", presetId: "from-shape" },
      { tags: "", presetId: null },
      { tags: "#only", presetId: null },
      { tags: "", presetId: null },
      { tags: "", presetId: null },
    ];
    for (let index = 0; index < shapes.length; index += 1) {
      mockDraftText.mockClear();
      mockHashtags.mockResolvedValueOnce(shapes[index]);
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(
          createActionFormData("draft-text", {
            content: "Hello",
            hashTagPresetId: "manual",
          })
        )
      );
      expect(mockDraftText.mock.calls[0]?.[0].hashTagPresetTags).toBe(
        expected[index]?.tags
      );
      expect(mockDraftText.mock.calls[0]?.[0].hashTagPresetId).toBe(
        expected[index]?.presetId
      );
    }

    mockHashtags.mockResolvedValueOnce(null);
    await expect(
      handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(
          createActionFormData("draft-text", { content: "Hello" })
        )
      )
    ).rejects.toThrow(TypeError);

    mockValidate.mockReturnValue({
      success: true,
      data: {
        _action: "draft-text",
        queueType: "",
        queueTypeId: undefined,
        isRecyclable: undefined,
        useHashtagPresets: undefined,
        hashTagPresetId: "ignored",
        includeHashtagsInNoteBody: undefined,
        content: "",
        caption: "",
        scheduledFor: null,
      },
    });
    mockHashtags.mockResolvedValueOnce({ tags: "#t", presetId: "from-preset" });
    mockDraftText.mockClear();
    await handleNewPostAction(
      TEST_USER_ID,
      requestFromForm(createActionFormData("draft-text"))
    );
    expect(mockHashtags).toHaveBeenCalledWith(
      TEST_USER_ID,
      false,
      null,
      "unassigned",
      undefined
    );
    expect(mockDraftText.mock.calls[0]?.[0].isRecyclable).toBe(false);
    expect(mockDraftText.mock.calls[0]?.[0].showHashTagsinPosts).toBe(true);
    expect(mockDraftText.mock.calls[0]?.[0].queueType).toBe("unassigned");
    expect(mockDraftText.mock.calls[0]?.[0].hashTagPresetId).toBe(
      "from-preset"
    );
  });

  describe("composer updates", () => {
    function editForm(extra: Record<string, string> = {}): FormData {
      return createActionFormData("update-scheduled", {
        scheduledActionId: "target-1",
        content: "hello [attach:a]",
        attachmentMeta: JSON.stringify([
          { localId: "a", url: "https://cdn.example/a.png" },
        ]),
        attachmentDiff: JSON.stringify({
          removed: [],
          retained: [{ localId: "a" }],
          added: [{ localId: "a" }],
        }),
        scheduledFor: "1700000000",
        signedEvent: JSON.stringify(EVENT),
        nostrEvent: JSON.stringify(EVENT),
        queueTypeId: "q-9",
        hashTagPresetId: "h-9",
        ...extra,
      });
    }

    it("rejects a missing target, a missing row, and the wrong edit mode", async () => {
      const missingId = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(createActionFormData("update-scheduled"))
        )
      );
      expect(missingId.status).toBe(400);
      expect(errorOf(missingId.body)).toBe("Missing edit target id");

      const missingFollow = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(createActionFormData("update-follow-up"))
        )
      );
      expect(errorOf(missingFollow.body)).toBe("Missing edit target id");

      const missingRow = await bodyOf(
        await handleNewPostAction(TEST_USER_ID, requestFromForm(editForm()))
      );
      expect(missingRow.status).toBe(404);
      expect(errorOf(missingRow.body)).toBe("Scheduled item not found");

      remember(scheduledPost({ dependencyMode: "manual" }));
      const notAttached = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(
            editForm({
              _action: "update-follow-up",
              followUpActionId: "target-1",
            })
          )
        )
      );
      expect(notAttached.status).toBe(400);
      expect(errorOf(notAttached.body)).toBe(
        "This scheduled item is not an attached follow-up."
      );

      remember(scheduledPost({ dependencyMode: "attached" }));
      const attachedParent = await bodyOf(
        await handleNewPostAction(TEST_USER_ID, requestFromForm(editForm()))
      );
      expect(errorOf(attachedParent.body)).toBe(
        "Use follow-up editing for attached follow-ups."
      );
    });

    it("rejects a missing, invalid, or inconsistent attachment diff and a bad time", async () => {
      remember(scheduledPost());
      const required = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(editForm({ attachmentDiff: "", segments: "   " }))
        )
      );
      expect(required.status).toBe(400);
      expect(errorOf(required.body)).toBe(
        "Attachment diff is required when editing scheduled content."
      );

      const invalid = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(editForm({ attachmentDiff: "{" }))
        )
      );
      expect(errorOf(invalid.body)).toBe("Attachment diff is invalid JSON.");

      remember(
        scheduledPost({
          draftMeta: {
            attachmentMeta: [
              null,
              "x",
              { localId: 1 },
              { foo: true },
              { localId: "keep" },
            ],
          },
        })
      );
      const inconsistent = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(
            editForm({
              attachmentDiff: JSON.stringify({
                removed: [{ localId: "missing" }],
              }),
            })
          )
        )
      );
      expect(errorOf(inconsistent.body)).toBe(
        "Attachment removal payload is inconsistent with saved media."
      );

      const badTime = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(editForm({ scheduledFor: "tomorrow" }))
        )
      );
      expect(errorOf(badTime.body)).toBe("Invalid scheduled time.");
    });

    it("updates a scheduled post, cascades, and reschedules when a signed event is present", async () => {
      remember(
        scheduledPost({
          draftMeta: "legacy",
        })
      );
      const result = await bodyOf(
        await handleNewPostAction(TEST_USER_ID, requestFromForm(editForm()))
      );

      expect(result.status).toBe(302);
      expect(result.location).toBe("/dashboard/scheduled?scheduled=target-1");
      expect(mockUpdate.mock.calls[0]?.[0]).toEqual({
        id: "target-1",
        userId: TEST_USER_ID,
        data: {
          content: "hello",
          caption: "hello",
          fileUrl: ["https://cdn.example/a.png"],
          queueTypeId: "q-9",
          scheduledAtUtc: 1_700_000_000,
          signedEvent: EVENT,
          nostrEvent: EVENT,
          hashTagPresetId: "h-9",
        },
      });
      expect(mockCascade).toHaveBeenCalledWith({
        rootPostId: "target-1",
        userId: TEST_USER_ID,
        parentScheduledAtUtc: new Date(1_700_000_000 * 1000),
      });
      expect(mockScheduleExecute).toHaveBeenCalledWith({
        postId: "target-1",
        userId: TEST_USER_ID,
        scheduledAtUtc: fromUnixTimestamp(1_700_000_000, "UTC"),
        signedEvent: EVENT,
      });
      expect(mockResync).toHaveBeenCalledWith({
        parentPostId: "target-1",
        userId: TEST_USER_ID,
        parentPredictedEventId: "event-1",
      });
    });

    it("skips cascade and reschedule when the time or signed event is absent", async () => {
      remember(scheduledPost());
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(
          editForm({
            scheduledFor: "",
            signedEvent: "",
            nostrEvent: "",
            queueTypeId: "",
            hashTagPresetId: "",
          })
        )
      );
      expect(mockUpdate.mock.calls[0]?.[0].data.queueTypeId).toBe("from-post");
      expect(mockUpdate.mock.calls[0]?.[0].data.hashTagPresetId).toBeNull();
      expect(mockUpdate.mock.calls[0]?.[0].data.scheduledAtUtc).toBeUndefined();
      expect(mockUpdate.mock.calls[0]?.[0].data.signedEvent).toBeUndefined();
      expect(mockUpdate.mock.calls[0]?.[0].data.nostrEvent).toBeUndefined();
      expect(mockCascade).not.toHaveBeenCalled();
      expect(mockScheduleExecute).not.toHaveBeenCalled();

      mockUpdate.mockClear();
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(
          editForm({
            scheduledFor: "0",
            signedEvent: JSON.stringify(EVENT),
          })
        )
      );
      expect(mockCascade).not.toHaveBeenCalled();
      expect(mockScheduleExecute).not.toHaveBeenCalled();

      mockCascade.mockClear();
      await handleNewPostAction(
        TEST_USER_ID,
        requestFromForm(editForm({ signedEvent: "", nostrEvent: "" }))
      );
      expect(mockCascade).toHaveBeenCalledTimes(1);
      expect(mockScheduleExecute).not.toHaveBeenCalled();
    });

    it("allows a thread update without an attachment diff and ignores blank removal ids", async () => {
      remember(
        scheduledPost({
          draftMeta: { attachmentMeta: [{ localId: "keep" }] },
        })
      );
      const result = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(
            editForm({
              attachmentDiff: JSON.stringify({
                removed: [{}, { localId: "" }, { localId: "keep" }],
              }),
              segments: "[]",
            })
          )
        )
      );
      expect(result.status).toBe(302);

      const threadOnly = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(
            editForm({
              attachmentDiff: "",
              segments: "one",
            })
          )
        )
      );
      expect(threadOnly.status).toBe(302);
    });

    it("guards follow-up parent timing and a missing parent relationship", async () => {
      const parentAt = new Date(1_700_000_000 * 1000);
      remember(
        scheduledPost({
          dependencyMode: "attached",
          parentScheduledActionId: "parent-1",
          scheduledAtUtc: new Date(1_700_000_100 * 1000),
        })
      );
      remember(
        scheduledPost({
          id: "parent-1",
          scheduledAtUtc: parentAt,
        })
      );

      const early = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(
            editForm({
              _action: "update-follow-up",
              followUpActionId: "target-1",
              scheduledFor: "1699999990",
            })
          )
        )
      );
      expect(early.status).toBe(400);
      expect(errorOf(early.body)).toBe(
        "Follow-up must be scheduled at or after its parent."
      );

      const sameTime = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(
            editForm({
              _action: "update-follow-up",
              followUpActionId: "target-1",
              parentActionId: "parent-1",
              scheduledFor: "1700000000",
            })
          )
        )
      );
      expect(sameTime.status).toBe(302);

      const fromRow = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(
            editForm({
              _action: "update-follow-up",
              followUpActionId: "target-1",
              scheduledFor: "",
            })
          )
        )
      );
      expect(fromRow.status).toBe(302);

      remember(
        scheduledPost({
          id: "early-child",
          dependencyMode: "attached",
          parentScheduledActionId: "parent-1",
          scheduledAtUtc: new Date(1_699_000_000 * 1000),
        })
      );
      const storedEarly = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(
            editForm({
              _action: "update-follow-up",
              followUpActionId: "early-child",
              scheduledFor: "",
            })
          )
        )
      );
      expect(errorOf(storedEarly.body)).toBe(
        "Follow-up must be scheduled at or after its parent."
      );

      const blankParent = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(
            editForm({
              _action: "update-follow-up",
              followUpActionId: "target-1",
              parentActionId: "",
            })
          )
        )
      );
      expect(errorOf(blankParent.body)).toBe(
        "Follow-up parent relationship is missing."
      );

      remember(
        scheduledPost({
          id: "orphan",
          dependencyMode: "attached",
          parentScheduledActionId: null,
        })
      );
      const orphan = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(
            editForm({
              _action: "update-follow-up",
              followUpActionId: "orphan",
            })
          )
        )
      );
      expect(errorOf(orphan.body)).toBe(
        "Follow-up parent relationship is missing."
      );
    });

    it("continues when the parent row or parent time cannot be compared", async () => {
      remember(
        scheduledPost({
          dependencyMode: "attached",
          parentScheduledActionId: "missing-parent",
        })
      );
      const missingParent = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(
            editForm({
              _action: "update-follow-up",
              followUpActionId: "target-1",
              parentActionId: "missing-parent",
              scheduledFor: "1700000000",
            })
          )
        )
      );
      expect(missingParent.status).toBe(302);

      remember(
        scheduledPost({
          id: "untimed",
          scheduledAtUtc: null,
        })
      );
      remember(
        scheduledPost({
          id: "child-untimed",
          dependencyMode: "attached",
          parentScheduledActionId: "untimed",
          scheduledAtUtc: null,
        })
      );
      const untimed = await bodyOf(
        await handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(
            editForm({
              _action: "update-follow-up",
              followUpActionId: "child-untimed",
              scheduledFor: "",
            })
          )
        )
      );
      expect(untimed.status).toBe(302);
    });

    it("rethrows invalid signed JSON and a string thrown by the update", async () => {
      remember(scheduledPost());
      await expect(
        handleNewPostAction(
          TEST_USER_ID,
          requestFromForm(editForm({ signedEvent: "{" }))
        )
      ).rejects.toThrow(SyntaxError);

      mockUpdate.mockRejectedValueOnce("db-down");
      await expect(
        handleNewPostAction(TEST_USER_ID, requestFromForm(editForm()))
      ).rejects.toBe("db-down");
    });
  });
});
