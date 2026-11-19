import { beforeEach, describe, expect, it, vi } from "vitest";

interface ZonedStub {
  timestamp: number;
}

const caps = vi.hoisted(() => {
  class ScheduleCapExceededError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ScheduleCapExceededError";
    }
  }
  const state = { mode: "ok" as "cap" | "error" | "ok" | "string" };
  return {
    ScheduleCapExceededError,
    assertScheduleCapacity: vi.fn(async (_userId: string, _slots: number) => {
      if (state.mode === "cap") throw new ScheduleCapExceededError("cap full");
      if (state.mode === "error") throw new Error("cap down");
      if (state.mode === "string") throw "cap down";
    }),
    state,
  };
});

const createCase = vi.hoisted(() => ({
  execute: vi.fn(async () => ({ post: { id: "lf-9" } })),
}));

const drafts = vi.hoisted(() => ({
  LONGFORM_SNAPSHOT_SCHEMA_VERSION: 3,
  createLongformDraftVersion: vi.fn(async () => undefined),
}));

const logger = vi.hoisted(() => ({
  logError: vi.fn(),
  logWarning: vi.fn(),
}));

const machines = vi.hoisted(() => ({
  transition: vi.fn(async () => undefined),
}));

const markdown = vi.hoisted(() => ({
  generateSummary: vi.fn((value: string) => `sum:${value}`),
  sanitizeMarkdown: vi.fn((value: string) => `safe:${value}`),
}));

const posts = vi.hoisted(() => ({
  createPostWithOutbox: vi.fn(async () => ({ id: "quote-1" })),
  getLongFormPost: vi.fn<
    (args: { id: string; userId: string }) => Promise<unknown>
  >(async () => null),
  resolveQueueTypeId: vi.fn<
    (
      userId: string,
      queueTypeId: string | null,
      queueType: string | null
    ) => Promise<string | null>
  >(async () => "queue-1"),
  updateLongFormPost: vi.fn(async () => ({ id: "lf-1" })),
}));

const publishCase = vi.hoisted(() => ({
  execute: vi.fn(async () => undefined),
}));

const router = vi.hoisted(() => ({
  data: vi.fn((body: unknown, init?: { status?: number }) => ({
    body,
    kind: "data",
    status: init?.status,
  })),
  redirect: vi.fn((location: string) => ({ kind: "redirect", location })),
}));

const session = vi.hoisted(() => ({
  assertSignedEventMatchesSessionPubkey: vi.fn(
    (input: { eventPubkey: string }) => {
      if (input.eventPubkey === "throw-error") throw new Error("bad pubkey");
      if (input.eventPubkey === "throw-string") throw "bad pubkey";
    }
  ),
}));

const temporalState = vi.hoisted(() => ({
  nullTimestamps: new Set<number>(),
}));

const uploads = vi.hoisted(() => ({
  assertMediaUrlsReady: vi.fn(async () => undefined),
  uploadBufferToS3: vi.fn<
    (
      buffer: Buffer,
      userId: string,
      fileName: string,
      fourth: undefined,
      contentType: string
    ) => Promise<string>
  >(async () => "https://cdn.example/cover.png"),
}));

vi.mock("react-router", () => router);
vi.mock(
  "~/features/payments/entitlements/schedule-cap-policy.server",
  () => caps
);
vi.mock(
  "~/features/posts/longform/use-cases/create-longform-post.use-case.server",
  () => ({
    CreateLongFormPostUseCase: class CreateLongFormPostUseCase {
      execute = createCase.execute;
    },
  })
);
vi.mock(
  "~/features/posts/longform/use-cases/publish-longform-now.use-case.server",
  () => ({
    PublishLongFormNowUseCase: class PublishLongFormNowUseCase {
      execute = publishCase.execute;
    },
  })
);
vi.mock("~/features/posts/server", () => posts);
vi.mock("~/features/posts/server/drafts", () => drafts);
vi.mock("~/features/posts/state-machine/post-state-machine.server", () => ({
  PostStateMachine: class PostStateMachine {
    transition = machines.transition;
  },
}));
vi.mock("~/features/upload/s3.server", () => ({
  uploadBufferToS3: uploads.uploadBufferToS3,
}));
vi.mock("~/features/upload/services/media-readiness.server", () => ({
  assertMediaUrlsReady: uploads.assertMediaUrlsReady,
}));
vi.mock("~/features/user", () => ({
  getHashTagPresetById: vi.fn(),
  getQueueTypes: vi.fn(),
}));
vi.mock("~/lib/error-logger.server", () => logger);
vi.mock("~/lib/markdown-sanitizer.server", () => markdown);
vi.mock("~/lib/nostr-session-invariants.server", () => session);
vi.mock("~/lib/temporal", () => ({
  fromUnixTimestamp: (timestamp: number): ZonedStub => ({ timestamp }),
  toPrismaDate: (zoned: ZonedStub | null | undefined): Date | null => {
    if (!zoned || temporalState.nullTimestamps.has(zoned.timestamp))
      return null;
    return new Date(zoned.timestamp * 1000);
  },
}));

import {
  handleImageUpload,
  handlePublish,
  handleSaveDraft,
  handleScheduleLongform,
} from "~/features/posts/longform/services/newlongform-action-handlers.server";

const USER = "user-1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function eventJson(pubkey = "session-pk", publishedAt = "1700000100"): string {
  return JSON.stringify({
    id: "evt-1",
    pubkey,
    created_at: 1_700_000_000,
    kind: 30023,
    content: "c",
    tags: [["published_at", publishedAt]],
    sig: "sig",
  });
}

function quotePayload(): string {
  return JSON.stringify([
    {
      scheduledFor: 1_700_000_300,
      signedEvent: { id: "q1" },
      caption: "Quote",
    },
    { scheduledFor: 1_700_000_400, signedEvent: { id: "q2" } },
  ]);
}

function fields(extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("title", "Hello");
  form.set("content", " Body ");
  form.set("summary", "Sum");
  form.set("image", "https://cdn.example/cover.png");
  form.set("signedEvent", eventJson());
  form.set("nostrEvent", eventJson());
  form.set("tags", "A, b");
  form.set("customTags", "B, c");
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

function readError(value: unknown): string {
  if (!isRecord(value) || value["kind"] !== "data") {
    throw new Error("expected data result");
  }
  const body = value["body"];
  if (!isRecord(body) || typeof body["error"] !== "string") {
    throw new Error("expected error");
  }
  return body["error"];
}

function readRedirect(value: unknown): string {
  if (!isRecord(value) || value["kind"] !== "redirect") {
    throw new Error("expected redirect");
  }
  if (typeof value["location"] !== "string")
    throw new Error("expected location");
  return value["location"];
}

async function responseJson(value: unknown): Promise<Record<string, unknown>> {
  if (!(value instanceof Response)) throw new Error("expected response");
  const body = parseJson(await value.text());
  if (!isRecord(body)) throw new Error("expected json");
  return body;
}

function errorContext(body: Record<string, unknown>): Record<string, unknown> {
  const error = body["error"];
  if (!isRecord(error) || !isRecord(error["context"])) {
    throw new Error("expected error context");
  }
  return error["context"];
}

describe("new longform action handler branches", () => {
  beforeEach(() => {
    caps.state.mode = "ok";
    temporalState.nullTimestamps = new Set([1_700_000_400]);
    posts.resolveQueueTypeId.mockResolvedValue("queue-1");
    posts.getLongFormPost.mockResolvedValue(null);
    createCase.execute.mockResolvedValue({ post: { id: "lf-9" } });
    publishCase.execute.mockResolvedValue(undefined);
    uploads.uploadBufferToS3.mockResolvedValue("https://cdn.example/cover.png");
    uploads.assertMediaUrlsReady.mockResolvedValue(undefined);
    posts.updateLongFormPost.mockClear();
    posts.createPostWithOutbox.mockClear();
    drafts.createLongformDraftVersion.mockClear();
    machines.transition.mockClear();
    createCase.execute.mockClear();
    publishCase.execute.mockClear();
    caps.assertScheduleCapacity.mockClear();
    markdown.generateSummary.mockClear();
    logger.logWarning.mockClear();
    logger.logError.mockClear();
  });

  it("uploads a cover image and reports every failure arm", async () => {
    const https = new FormData();
    https.set("imageFile", "https://cdn.example/already.png");
    await expect(handleImageUpload(USER, https)).resolves.toEqual({
      success: true,
      imageUrl: "https://cdn.example/already.png",
    });

    const file = new File([Uint8Array.from([1, 2])], "cover.png", {
      type: "image/png",
    });
    const upload = new FormData();
    upload.set("imageFile", file);
    await expect(handleImageUpload(USER, upload)).resolves.toEqual({
      success: true,
      imageUrl: "https://cdn.example/cover.png",
    });
    expect(uploads.uploadBufferToS3.mock.calls[0]?.slice(1)).toEqual([
      USER,
      "cover.png",
      undefined,
      "image/png",
    ]);
    expect(String(logger.logWarning.mock.calls[0]?.[0])).toContain("S3");

    uploads.uploadBufferToS3.mockRejectedValueOnce(new Error("s3 down"));
    const errored = await responseJson(await handleImageUpload(USER, upload));
    expect(errored["success"]).toBe(false);
    expect(errorContext(errored)["originalError"]).toBe("s3 down");

    uploads.uploadBufferToS3.mockRejectedValueOnce("s3 string");
    const stringError = await responseJson(
      await handleImageUpload(USER, upload)
    );
    expect(errorContext(stringError)["originalError"]).toBe("s3 string");

    const empty = new FormData();
    expect(readError(await handleImageUpload(USER, empty))).toBe(
      "No image file provided."
    );
    const bad = new FormData();
    bad.set("imageFile", "http://insecure.example/a.png");
    expect(readError(await handleImageUpload(USER, bad))).toBe(
      "Image upload failed. Please try again."
    );
  });

  it("creates, updates, and rejects drafts", async () => {
    const created = await handleSaveDraft(USER, fields(), "Unassigned", null);
    expect(created).toEqual({
      ok: true,
      draftSaved: true,
      longFormPostId: "lf-9",
    });
    expect(posts.resolveQueueTypeId).toHaveBeenCalledWith(USER, null, null);
    expect(markdown.generateSummary).not.toHaveBeenCalled();
    expect(createCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        title: "Hello",
        summary: "Sum",
        content: "safe:Body",
        tags: ["A", "b", "c"],
        queueType: undefined,
        queueTypeId: "queue-1",
        hashTagPresetId: null,
        isPublished: false,
      })
    );
    expect(drafts.createLongformDraftVersion).toHaveBeenCalledWith(
      "lf-9",
      expect.objectContaining({
        schemaVersion: 3,
        title: "Hello",
        summary: "Sum",
        content: " Body ",
        tags: ["A", "b", "c"],
        queueTypeId: "queue-1",
      }),
      USER
    );

    const generated = fields();
    generated.delete("summary");
    await handleSaveDraft(USER, generated, "News", "preset-1");
    expect(markdown.generateSummary).toHaveBeenCalledWith("safe:Body");
    expect(posts.resolveQueueTypeId).toHaveBeenCalledWith(USER, null, "News");
    expect(createCase.execute.mock.calls.at(-1)?.[0]).toMatchObject({
      summary: "sum:safe:Body",
      queueType: "News",
      hashTagPresetId: "preset-1",
    });

    const blankId = fields({ longFormPostId: "   " });
    await handleSaveDraft(USER, blankId, "Unassigned", null);
    expect(posts.getLongFormPost).not.toHaveBeenCalled();

    posts.getLongFormPost.mockResolvedValueOnce(null);
    const missing = await handleSaveDraft(
      USER,
      fields({ longFormPostId: "missing" }),
      "News",
      null
    );
    expect(readError(missing)).toBe("Draft not found");
    expect(drafts.createLongformDraftVersion).toHaveBeenCalledTimes(3);

    posts.getLongFormPost.mockResolvedValueOnce({ currentState: "PUBLISHED" });
    const published = await handleSaveDraft(
      USER,
      fields({ longFormPostId: "lf-1" }),
      "News",
      null
    );
    expect(readError(published)).toBe(
      "Only draft articles can be updated from compose"
    );

    posts.getLongFormPost.mockResolvedValueOnce({ currentState: "DRAFT" });
    const updated = await handleSaveDraft(
      USER,
      fields({ longFormPostId: "lf-1" }),
      "News",
      "preset-1"
    );
    expect(updated).toEqual({
      ok: true,
      draftSaved: true,
      longFormPostId: "lf-1",
    });
    expect(posts.updateLongFormPost).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "lf-1",
        userId: USER,
        title: "Hello",
        queueTypeId: "queue-1",
        hashTagPresetId: "preset-1",
      })
    );
    expect(createCase.execute).toHaveBeenCalledTimes(3);

    createCase.execute.mockResolvedValueOnce({ post: { id: 5 } });
    const weird = await handleSaveDraft(USER, fields(), "Unassigned", null);
    expect(weird).toEqual({ longFormPostId: 5 });
    expect(drafts.createLongformDraftVersion).toHaveBeenCalledTimes(4);

    expect(
      readError(
        await handleSaveDraft(USER, fields({ title: " " }), "News", null)
      )
    ).toBe("Title is required");
    expect(
      readError(
        await handleSaveDraft(USER, fields({ content: " " }), "News", null)
      )
    ).toBe("Content is required");
    expect(posts.resolveQueueTypeId).toHaveBeenCalled();
  });

  it("publishes an article, quote posts, and publish failures", async () => {
    const base = () => fields();
    expect(
      readError(
        await handlePublish(
          USER,
          fields({ title: " " }),
          "News",
          null,
          "#tag",
          true,
          ["wss://r"],
          "session-pk"
        )
      )
    ).toBe("Title is required");
    expect(
      readError(
        await handlePublish(
          USER,
          fields({ content: " " }),
          "News",
          null,
          "#tag",
          true,
          [],
          "session-pk"
        )
      )
    ).toBe("Content is required");
    expect(
      readError(
        await handlePublish(
          USER,
          fields({ summary: " " }),
          "News",
          null,
          "#tag",
          true,
          [],
          "session-pk"
        )
      )
    ).toBe("Summary is required for publishing");
    expect(
      readError(
        await handlePublish(
          USER,
          fields({ image: " " }),
          "News",
          null,
          "#tag",
          true,
          [],
          "session-pk"
        )
      )
    ).toBe("Cover image is required for publishing");
    expect(uploads.assertMediaUrlsReady).not.toHaveBeenCalled();

    const noEvent = fields();
    noEvent.delete("signedEvent");
    const missingEvent = await handlePublish(
      USER,
      noEvent,
      "News",
      null,
      "#tag",
      true,
      [],
      "session-pk"
    );
    expect(readError(missingEvent)).toBe(
      "Missing Nostr event data for publishing"
    );
    expect(uploads.assertMediaUrlsReady).toHaveBeenCalledWith([
      "https://cdn.example/cover.png",
    ]);

    uploads.assertMediaUrlsReady.mockRejectedValueOnce(new Error("media"));
    await expect(
      handlePublish(USER, base(), "News", null, "#tag", true, [], "session-pk")
    ).rejects.toThrow("media");
    uploads.assertMediaUrlsReady.mockRejectedValueOnce("media-string");
    await expect(
      handlePublish(USER, base(), "News", null, "#tag", true, [], "session-pk")
    ).rejects.toBe("media-string");

    const withQuotes = fields({ quoteSchedules: quotePayload() });
    const published = await handlePublish(
      USER,
      withQuotes,
      "News",
      "preset-1",
      "#news",
      true,
      ["wss://relay.example"],
      "session-pk"
    );
    expect(readRedirect(published)).toBe(
      "/dashboard/compose?type=article&published=lf-9"
    );
    expect(caps.assertScheduleCapacity).toHaveBeenCalledWith(USER, 1);
    expect(createCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "safe:Body\n\n#news",
        queueType: "News",
        hashTagPresetId: "preset-1",
        isPublished: true,
      })
    );
    expect(posts.createPostWithOutbox).toHaveBeenCalledTimes(1);
    expect(posts.createPostWithOutbox.mock.calls[0]?.[0]).toMatchObject({
      caption: "Quote",
      quoteOfLongFormPostId: "lf-9",
      postKind: "QUOTE",
      isQuotedPost: true,
      scheduledAtUtc: 1_700_000_300,
    });
    expect(posts.createPostWithOutbox.mock.calls[0]?.[1]).toBe(1_700_000_300);
    expect(machines.transition).toHaveBeenCalledWith(
      "quote-1",
      USER,
      "SCHEDULED",
      "Quote of article created with schedule"
    );
    expect(publishCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: "lf-9",
        relays: ["wss://relay.example"],
      })
    );

    posts.resolveQueueTypeId.mockResolvedValueOnce(null);
    await handlePublish(
      USER,
      fields({ quoteSchedules: quotePayload() }),
      "Unassigned",
      null,
      "",
      true,
      [],
      "session-pk"
    );
    expect(createCase.execute.mock.calls.at(-1)?.[0]).toMatchObject({
      content: "safe:Body",
      queueType: undefined,
      queueTypeId: null,
    });
    expect(caps.assertScheduleCapacity).toHaveBeenCalledTimes(1);
    expect(posts.createPostWithOutbox).toHaveBeenCalledTimes(1);

    await handlePublish(
      USER,
      fields(),
      "News",
      null,
      "",
      false,
      [],
      "session-pk"
    );
    expect(createCase.execute.mock.calls.at(-1)?.[0]).toMatchObject({
      content: "safe:Body",
    });

    caps.state.mode = "cap";
    const capped = await handlePublish(
      USER,
      fields({ quoteSchedules: quotePayload() }),
      "News",
      null,
      "#news",
      true,
      [],
      "session-pk"
    );
    expect(readError(capped)).toBe("cap full");
    caps.state.mode = "error";
    await expect(
      handlePublish(
        USER,
        fields({ quoteSchedules: quotePayload() }),
        "News",
        null,
        "#news",
        true,
        [],
        "session-pk"
      )
    ).rejects.toThrow("cap down");
    caps.state.mode = "string";
    await expect(
      handlePublish(
        USER,
        fields({ quoteSchedules: quotePayload() }),
        "News",
        null,
        "#news",
        true,
        [],
        "session-pk"
      )
    ).rejects.toBe("cap down");

    caps.state.mode = "ok";
    publishCase.execute.mockRejectedValueOnce(new Error("publish down"));
    const failed = await responseJson(
      await handlePublish(
        USER,
        fields(),
        "News",
        null,
        "#news",
        true,
        [],
        "session-pk"
      )
    );
    expect(isRecord(failed["error"]) ? failed["error"]["message"] : "").toBe(
      "publish down"
    );
    publishCase.execute.mockRejectedValueOnce("publish string");
    const stringFailed = await responseJson(
      await handlePublish(
        USER,
        fields(),
        "News",
        null,
        "#news",
        true,
        [],
        "session-pk"
      )
    );
    expect(errorContext(stringFailed)["originalError"]).toBe("publish string");

    await expect(
      handlePublish(
        USER,
        fields({ signedEvent: eventJson("throw-error") }),
        "News",
        null,
        "#news",
        true,
        [],
        "session-pk"
      )
    ).rejects.toThrow("bad pubkey");
    await expect(
      handlePublish(
        USER,
        fields({ signedEvent: "not-json" }),
        "News",
        null,
        "#news",
        true,
        [],
        "session-pk"
      )
    ).rejects.toThrow(SyntaxError);
  });

  it("schedules an article and its quote posts", async () => {
    expect(
      readError(
        await handleScheduleLongform(
          USER,
          fields({ content: " " }),
          "News",
          null,
          "#news",
          true,
          "session-pk"
        )
      )
    ).toBe("Content is required");
    expect(
      readError(
        await handleScheduleLongform(
          USER,
          fields({ image: " " }),
          "News",
          null,
          "#news",
          true,
          "session-pk"
        )
      )
    ).toBe("Cover image is required for publishing");

    const scheduled = await handleScheduleLongform(
      USER,
      fields({
        quoteSchedules: quotePayload(),
        nominalScheduledFor: "1700000200",
      }),
      "News",
      "preset-1",
      "#news",
      true,
      "session-pk"
    );
    expect(readRedirect(scheduled)).toBe(
      "/dashboard/compose?type=article&scheduled=lf-9"
    );
    expect(caps.assertScheduleCapacity).toHaveBeenCalledWith(USER, 3);
    expect(createCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "safe:Body\n\n#news",
        scheduledFor: 1_700_000_100,
        nominalScheduledFor: 1_700_000_200,
        isPublished: false,
        queueType: "News",
      })
    );
    expect(posts.createPostWithOutbox).toHaveBeenCalledTimes(1);
    expect(posts.createPostWithOutbox.mock.calls[0]?.[0]).toMatchObject({
      content: "Quote",
      caption: "Quote",
    });

    posts.resolveQueueTypeId.mockResolvedValueOnce(null);
    await handleScheduleLongform(
      USER,
      fields({
        quoteSchedules: quotePayload(),
        signedEvent: eventJson("session-pk", "nope"),
        nominalScheduledFor: "nope",
      }),
      "Unassigned",
      null,
      "",
      true,
      "session-pk"
    );
    expect(createCase.execute.mock.calls.at(-1)?.[0]).toMatchObject({
      content: "safe:Body",
      queueType: undefined,
      scheduledFor: undefined,
      nominalScheduledFor: undefined,
    });
    expect(posts.createPostWithOutbox).toHaveBeenCalledTimes(1);

    const blankNominal = fields({ nominalScheduledFor: "   " });
    blankNominal.delete("signedEvent");
    blankNominal.set("signedEvent", eventJson("session-pk", ""));
    await handleScheduleLongform(
      USER,
      blankNominal,
      "News",
      null,
      "#news",
      false,
      "session-pk"
    );
    expect(createCase.execute.mock.calls.at(-1)?.[0]).toMatchObject({
      scheduledFor: undefined,
      nominalScheduledFor: undefined,
      content: "safe:Body",
    });

    caps.state.mode = "cap";
    const capped = await handleScheduleLongform(
      USER,
      fields(),
      "News",
      null,
      "#news",
      true,
      "session-pk"
    );
    expect(readError(capped)).toBe("cap full");
    caps.state.mode = "error";
    await expect(
      handleScheduleLongform(
        USER,
        fields(),
        "News",
        null,
        "#news",
        true,
        "session-pk"
      )
    ).rejects.toThrow("cap down");
    caps.state.mode = "string";
    await expect(
      handleScheduleLongform(
        USER,
        fields(),
        "News",
        null,
        "#news",
        true,
        "session-pk"
      )
    ).rejects.toBe("cap down");

    caps.state.mode = "ok";
    await expect(
      handleScheduleLongform(
        USER,
        fields({ signedEvent: eventJson("throw-string") }),
        "News",
        null,
        "#news",
        true,
        "session-pk"
      )
    ).rejects.toBe("bad pubkey");
    uploads.assertMediaUrlsReady.mockRejectedValueOnce("not-ready");
    await expect(
      handleScheduleLongform(
        USER,
        fields(),
        "News",
        null,
        "#news",
        true,
        "session-pk"
      )
    ).rejects.toBe("not-ready");
  });
});
