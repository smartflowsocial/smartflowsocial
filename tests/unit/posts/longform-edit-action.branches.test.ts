// @ts-nocheck -- mocked collaborators are narrower than the production types.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface ValidatedLongform {
  _action: string;
  hashTagPresetId?: string | null;
  includeHashtagsInNoteBody?: boolean;
  queueType?: string;
  useHashtagPresets?: boolean;
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
    assertScheduleCapacity: vi.fn(async () => {
      if (state.mode === "cap") throw new ScheduleCapExceededError("cap full");
      if (state.mode === "error") throw new Error("cap down");
      if (state.mode === "string") throw "cap down";
    }),
    state,
  };
});

const correlation = vi.hoisted(() => ({
  extractCorrelationId: vi.fn<(headers: Headers) => string | null>(() => null),
  getCorrelationId: vi.fn(() => "corr-generated"),
}));

const drafts = vi.hoisted(() => ({
  LONGFORM_SNAPSHOT_SCHEMA_VERSION: 3,
  createLongformDraftVersion: vi.fn(async () => undefined),
  restoreLongformDraftVersion: vi.fn<
    (id: string, userId: string) => Promise<string | null>
  >(async () => "restored-id"),
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

const parser = vi.hoisted(() => {
  const state = { form: new FormData() };
  return {
    parseFormData: vi.fn(
      async (_request: Request, _options: { maxFileSize: number }) => state.form
    ),
    state,
  };
});

const posts = vi.hoisted(() => ({
  getLongFormPost: vi.fn<
    (args: { id: string; userId: string }) => Promise<unknown>
  >(async () => null),
  updateLongFormPost: vi.fn(async () => ({ id: "post-1" })),
}));

const publishCase = vi.hoisted(() => ({
  execute: vi.fn(async () => undefined),
}));

const relays = vi.hoisted(() => ({
  resolveExecutionRelaysFromForm: vi.fn(async () => ["wss://relay.example"]),
}));

const router = vi.hoisted(() => ({
  data: vi.fn((body: unknown, init?: { status?: number }) => ({
    body,
    kind: "data",
    status: init?.status,
  })),
  redirect: vi.fn((location: string) => ({ kind: "redirect", location })),
}));

const scheduleCase = vi.hoisted(() => ({
  execute: vi.fn<(input: Record<string, unknown>) => Promise<void>>(
    async () => undefined
  ),
}));

const session = vi.hoisted(() => ({
  assertSignedEventMatchesSessionPubkey: vi.fn(
    (input: { eventPubkey: string }) => {
      if (input.eventPubkey === "throw-error") throw new Error("bad pubkey");
      if (input.eventPubkey === "throw-string") throw "bad pubkey";
    }
  ),
}));

const uploads = vi.hoisted(() => ({
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

const users = vi.hoisted(() => ({
  getHashTagPresetById: vi.fn<
    (userId: string, id: string) => Promise<{ tags: string | null } | null>
  >(async () => null),
  getQueueTypeByNameForUser: vi.fn<
    (userId: string, name: string) => Promise<{ id: string } | null>
  >(async () => null),
  getQueueTypes: vi.fn<(userId: string) => Promise<unknown[]>>(async () => []),
  getUserById: vi.fn<(id: string) => Promise<{ npub: string } | null>>(
    async () => ({ npub: "session-pk" })
  ),
}));

const validation = vi.hoisted(() => {
  const state: { data: ValidatedLongform; fail: boolean } = {
    fail: false,
    data: {
      _action: "save-draft",
      hashTagPresetId: null,
      includeHashtagsInNoteBody: false,
      queueType: "unassigned",
      useHashtagPresets: false,
    },
  };
  return {
    state,
    validateFormDataOrRespond: vi.fn(() => {
      if (state.fail) {
        return {
          response: new Response("invalid", { status: 400 }),
          success: false,
        };
      }
      return { data: state.data, success: true };
    }),
  };
});

vi.mock("@remix-run/form-data-parser", () => parser);
vi.mock("react-router", () => router);
vi.mock(
  "~/features/payments/entitlements/schedule-cap-policy.server",
  () => caps
);
vi.mock(
  "~/features/posts/longform/state-machine/longform-post-state-machine.server",
  () => ({
    LongFormPostStateMachine: class LongFormPostStateMachine {
      transition = machines.transition;
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
vi.mock(
  "~/features/posts/longform/use-cases/schedule-longform-post.use-case.server",
  () => ({
    ScheduleLongFormPostUseCase: class ScheduleLongFormPostUseCase {
      execute = scheduleCase.execute;
    },
  })
);
vi.mock("~/features/posts/server", () => posts);
vi.mock("~/features/posts/server/drafts", () => drafts);
vi.mock("~/features/relays/relay-resolution.server", () => relays);
vi.mock("~/features/upload/s3.server", () => uploads);
vi.mock("~/features/upload/validation.server", () => ({
  DEFAULT_MEMORY_PART_BYTES: 2048,
}));
vi.mock("~/features/user", () => users);
vi.mock("~/lib/correlation-context.server", () => correlation);
vi.mock("~/lib/error-logger.server", () => logger);
vi.mock("~/lib/markdown-sanitizer.server", () => markdown);
vi.mock("~/lib/nostr-session-invariants.server", () => session);
vi.mock("~/lib/validation", () => ({
  newLongformPostActionSchema: {},
  validateFormDataOrRespond: validation.validateFormDataOrRespond,
}));

import { handleLongFormEditAction } from "~/features/posts/longform/services/longform-edit-action.server";

const USER = "user-1";
const POST = "post-1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function formRequest(
  action: string,
  fields: Record<string, string> = {}
): Request {
  const form = new FormData();
  form.set("_action", action);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const request = new Request("https://app.example/edit", { method: "POST" });
  vi.spyOn(request, "formData").mockResolvedValue(form);
  return request;
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

function publishFields(
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    title: "Hello",
    content: "Body",
    summary: "Sum",
    image: "https://cdn.example/cover.png",
    signedEvent: eventJson(),
    nostrEvent: eventJson(),
    tags: "A, b",
    customTags: "B, c",
    ...extra,
  };
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

function readStatus(value: unknown): number | undefined {
  if (!isRecord(value)) throw new Error("expected result");
  return typeof value["status"] === "number" ? value["status"] : undefined;
}

function lastUpdate(): Record<string, unknown> {
  const call = posts.updateLongFormPost.mock.calls.at(-1)?.[0];
  if (!isRecord(call)) throw new Error("expected update");
  return call;
}

function epochMillis(value: unknown): number {
  if (!isRecord(value)) throw new Error("expected zoned date");
  const raw = value["epochMilliseconds"];
  if (typeof raw === "number" || typeof raw === "bigint") return Number(raw);
  throw new Error("expected epoch");
}

describe("longform edit action branches", () => {
  beforeEach(() => {
    caps.state.mode = "ok";
    validation.state.fail = false;
    validation.state.data = {
      _action: "save-draft",
      hashTagPresetId: null,
      includeHashtagsInNoteBody: false,
      queueType: "unassigned",
      useHashtagPresets: false,
    };
    users.getUserById.mockResolvedValue({ npub: "session-pk" });
    users.getQueueTypeByNameForUser.mockResolvedValue(null);
    users.getQueueTypes.mockResolvedValue([]);
    users.getHashTagPresetById.mockResolvedValue(null);
    posts.getLongFormPost.mockResolvedValue(null);
    correlation.extractCorrelationId.mockReturnValue(null);
    uploads.uploadBufferToS3.mockResolvedValue("https://cdn.example/cover.png");
    drafts.restoreLongformDraftVersion.mockResolvedValue("restored-id");
    posts.updateLongFormPost.mockClear();
    machines.transition.mockClear();
    drafts.createLongformDraftVersion.mockClear();
    publishCase.execute.mockClear();
    scheduleCase.execute.mockClear();
    caps.assertScheduleCapacity.mockClear();
    session.assertSignedEventMatchesSessionPubkey.mockClear();
    logger.logError.mockClear();
    logger.logWarning.mockClear();
  });

  it("rejects a missing user and parses multipart uploads", async () => {
    users.getUserById.mockResolvedValueOnce(null);
    const missing = await handleLongFormEditAction(
      USER,
      POST,
      new Request("https://app.example/edit", { method: "POST" })
    );
    expect(missing).toBeInstanceOf(Response);
    if (missing instanceof Response) {
      expect(missing.status).toBe(404);
      expect(await missing.text()).toBe("User not found");
    }

    const form = new FormData();
    form.set("_action", "upload-image");
    form.set("imageFile", "https://cdn.example/already.png");
    parser.state.form = form;
    const request = new Request("https://app.example/edit", { method: "POST" });
    vi.spyOn(request.headers, "get").mockImplementation((name: string) =>
      name.toLowerCase() === "content-type"
        ? "multipart/form-data; boundary=abc"
        : null
    );
    await expect(
      handleLongFormEditAction(USER, POST, request)
    ).resolves.toEqual({
      success: true,
      imageUrl: "https://cdn.example/already.png",
    });
    expect(parser.parseFormData).toHaveBeenCalledWith(request, {
      maxFileSize: 2048,
    });
    expect(uploads.uploadBufferToS3).not.toHaveBeenCalled();
  });

  it("uploads a file and reports empty, invalid, and thrown upload failures", async () => {
    const file = new File([Uint8Array.from([1, 2, 3])], "cover.png", {
      type: "image/png",
    });
    const form = new FormData();
    form.set("_action", "upload-image");
    form.set("imageFile", file);
    const request = formRequest("upload-image");
    vi.spyOn(request, "formData").mockResolvedValue(form);
    await expect(
      handleLongFormEditAction(USER, POST, request)
    ).resolves.toEqual({
      success: true,
      imageUrl: "https://cdn.example/cover.png",
    });
    const upload = uploads.uploadBufferToS3.mock.calls[0];
    expect(Buffer.isBuffer(upload?.[0])).toBe(true);
    expect(upload?.slice(1)).toEqual([
      USER,
      "cover.png",
      undefined,
      "image/png",
    ]);
    expect(String(logger.logWarning.mock.calls[0]?.[0])).toContain("S3");

    uploads.uploadBufferToS3.mockRejectedValueOnce(new Error("s3 down"));
    const errored = await handleLongFormEditAction(USER, POST, request);
    expect(readStatus(errored)).toBe(500);
    expect(readError(errored)).toBe("Failed to upload image to storage.");
    expect(logger.logError.mock.calls.at(-1)?.[0]).toBeInstanceOf(Error);

    uploads.uploadBufferToS3.mockRejectedValueOnce("s3 string");
    await handleLongFormEditAction(USER, POST, request);
    const logged: unknown = logger.logError.mock.calls.at(-1)?.[0];
    expect(logged).toBeInstanceOf(Error);
    if (logged instanceof Error) expect(logged.message).toBe("s3 string");

    const empty = new FormData();
    empty.set("_action", "upload-image");
    vi.spyOn(request, "formData").mockResolvedValue(empty);
    const missing = await handleLongFormEditAction(USER, POST, request);
    expect(readStatus(missing)).toBe(400);
    expect(readError(missing)).toBe("No image file provided.");

    const bad = new FormData();
    bad.set("_action", "upload-image");
    bad.set("imageFile", "http://insecure.example/a.png");
    vi.spyOn(request, "formData").mockResolvedValue(bad);
    const invalid = await handleLongFormEditAction(USER, POST, request);
    expect(readError(invalid)).toBe("Image upload failed. Please try again.");
  });

  it("restores a version or falls through when the id is unusable", async () => {
    const restored = await handleLongFormEditAction(
      USER,
      POST,
      formRequest("restore-version", { versionId: "ver-1" })
    );
    expect(readRedirect(restored)).toBe(
      "/dashboard/drafts/longform/edit/restored-id"
    );
    expect(drafts.restoreLongformDraftVersion).toHaveBeenCalledWith(
      "ver-1",
      USER
    );

    drafts.restoreLongformDraftVersion.mockResolvedValueOnce(null);
    validation.state.fail = true;
    const missing = await handleLongFormEditAction(
      USER,
      POST,
      formRequest("restore-version", { versionId: "ver-2" })
    );
    expect(missing).toBeInstanceOf(Response);
    if (missing instanceof Response) expect(missing.status).toBe(400);

    validation.state.fail = false;
    validation.state.data._action = "other";
    const blank = await handleLongFormEditAction(
      USER,
      POST,
      formRequest("restore-version", { versionId: "" })
    );
    expect(blank).toEqual({ success: false });

    const fileForm = new FormData();
    fileForm.set("_action", "restore-version");
    fileForm.set("versionId", new File(["x"], "v.txt"));
    const request = formRequest("restore-version");
    vi.spyOn(request, "formData").mockResolvedValue(fileForm);
    await expect(
      handleLongFormEditAction(USER, POST, request)
    ).resolves.toEqual({
      success: false,
    });
  });

  it("returns validation failures, the upload-image schema arm, and unknown actions", async () => {
    validation.state.fail = true;
    const invalid = await handleLongFormEditAction(
      USER,
      POST,
      formRequest("save-draft", { title: "Hello", content: "Body" })
    );
    expect(invalid).toBeInstanceOf(Response);

    validation.state.fail = false;
    validation.state.data._action = "upload-image";
    const forced = await handleLongFormEditAction(
      USER,
      POST,
      formRequest("save-draft")
    );
    expect(readError(forced)).toBe("No image file provided.");

    validation.state.data._action = "other";
    await expect(
      handleLongFormEditAction(USER, POST, formRequest("other"))
    ).resolves.toEqual({ success: false });
  });

  it("saves a draft or returns the missing title and content errors", async () => {
    validation.state.data.queueType = "News";
    users.getQueueTypeByNameForUser.mockResolvedValue({ id: "q-1" });
    const saved = await handleLongFormEditAction(
      USER,
      POST,
      formRequest("save-draft", {
        title: "Hello",
        content: " Body ",
        tags: "A, b",
        customTags: "B, c",
        image: "https://cdn.example/cover.png",
      })
    );
    expect(readRedirect(saved)).toBe("/dashboard/drafts?tab=longform");
    expect(users.getQueueTypeByNameForUser).toHaveBeenCalledWith(USER, "News");
    expect(markdown.generateSummary).toHaveBeenCalledWith("safe:Body");
    expect(lastUpdate()).toMatchObject({
      id: POST,
      userId: USER,
      title: "Hello",
      content: "safe:Body",
      summary: "sum:safe:Body",
      image: "https://cdn.example/cover.png",
      tags: ["A", "b", "c"],
      queueTypeId: "q-1",
      hashTagPresetId: null,
    });
    expect(machines.transition).toHaveBeenCalledWith(
      POST,
      USER,
      "DRAFT",
      "Article saved as draft"
    );
    expect(drafts.createLongformDraftVersion).toHaveBeenCalledWith(
      POST,
      {
        schemaVersion: 3,
        title: "Hello",
        summary: "sum:safe:Body",
        content: "safe:Body",
        image: "https://cdn.example/cover.png",
        tags: ["A", "b", "c"],
        queueTypeId: "q-1",
      },
      USER
    );

    users.getQueueTypeByNameForUser.mockResolvedValue(null);
    const named = await handleLongFormEditAction(
      USER,
      POST,
      formRequest("save-draft", {
        title: "Hello",
        content: "Body",
        summary: "Given",
      })
    );
    expect(readRedirect(named)).toBe("/dashboard/drafts?tab=longform");
    expect(lastUpdate()["summary"]).toBe("Given");
    expect(lastUpdate()["queueTypeId"]).toBeNull();
    expect(markdown.generateSummary).toHaveBeenCalledTimes(1);

    validation.state.data.queueType = "unassigned";
    users.getQueueTypeByNameForUser.mockClear();
    await handleLongFormEditAction(
      USER,
      POST,
      formRequest("save-draft", { title: "Hello", content: "Body" })
    );
    expect(users.getQueueTypeByNameForUser).not.toHaveBeenCalled();

    const missingTitle = await handleLongFormEditAction(
      USER,
      POST,
      formRequest("save-draft", { title: "  ", content: "Body" })
    );
    expect(readStatus(missingTitle)).toBe(400);
    expect(readError(missingTitle)).toBe("Title is required");

    const missingContent = await handleLongFormEditAction(
      USER,
      POST,
      formRequest("save-draft", { title: "Hello", content: "  " })
    );
    expect(readError(missingContent)).toBe("Content is required");
  });

  it("publishes with hashtag, correlation, and pubkey branches", async () => {
    const cases = [
      [{ title: "  " }, "Title is required"],
      [{ title: "Hello", content: " " }, "Content is required"],
      [
        { title: "Hello", content: "Body", summary: " " },
        "Summary is required for publishing",
      ],
      [
        {
          title: "Hello",
          content: "Body",
          summary: "Sum",
          image: " ",
        },
        "Cover image is required for publishing",
      ],
      [
        {
          title: "Hello",
          content: "Body",
          summary: "Sum",
          image: "https://cdn.example/cover.png",
        },
        "Missing Nostr event data for publishing",
      ],
    ] as const;
    for (const [fields, message] of cases) {
      const result = await handleLongFormEditAction(
        USER,
        POST,
        formRequest("publish", fields)
      );
      expect(readError(result)).toBe(message);
    }
    users.getQueueTypes.mockClear();

    validation.state.data.queueType = "News";
    validation.state.data.useHashtagPresets = true;
    validation.state.data.hashTagPresetId = "preset-1";
    validation.state.data.includeHashtagsInNoteBody = true;
    users.getHashTagPresetById.mockResolvedValue({ tags: "#manual" });
    users.getQueueTypeByNameForUser.mockResolvedValue({ id: "q-9" });
    correlation.extractCorrelationId.mockReturnValue("from-header");
    const published = await handleLongFormEditAction(
      USER,
      POST,
      formRequest("publish", publishFields())
    );
    expect(readRedirect(published)).toBe(
      `/dashboard/published?published=${POST}&tab=longform`
    );
    expect(lastUpdate()["content"]).toBe("safe:Body\\n\\n#manual");
    expect(lastUpdate()["queueTypeId"]).toBe("q-9");
    expect(users.getHashTagPresetById).toHaveBeenCalledWith(USER, "preset-1");
    expect(users.getQueueTypes).not.toHaveBeenCalled();
    expect(publishCase.execute).toHaveBeenCalledWith({
      postId: POST,
      userId: USER,
      signedEvent: JSON.parse(eventJson()) as unknown,
      relays: ["wss://relay.example"],
      correlationId: "from-header",
    });

    correlation.extractCorrelationId.mockReturnValue(null);
    users.getHashTagPresetById.mockResolvedValue(null);
    await handleLongFormEditAction(
      USER,
      POST,
      formRequest("publish", publishFields())
    );
    expect(lastUpdate()["content"]).toBe("safe:Body\\n\\n");
    expect(publishCase.execute.mock.calls.at(-1)?.[0]).toMatchObject({
      correlationId: "corr-generated",
    });

    validation.state.data.useHashtagPresets = false;
    validation.state.data.includeHashtagsInNoteBody = undefined;
    users.getQueueTypes.mockResolvedValue([
      { name: "News", hashTagPreset: { tags: "#queue" } },
    ]);
    await handleLongFormEditAction(
      USER,
      POST,
      formRequest("publish", publishFields())
    );
    expect(lastUpdate()["content"]).toBe("safe:Body\\n\\n#queue");

    users.getQueueTypes.mockResolvedValue([
      { name: "News", hashTagPreset: { tags: null } },
      { name: "Bare" },
    ]);
    await handleLongFormEditAction(
      USER,
      POST,
      formRequest("publish", publishFields())
    );
    expect(lastUpdate()["content"]).toBe("safe:Body\\n\\n");

    users.getQueueTypes.mockResolvedValue([{ name: "Other" }]);
    validation.state.data.includeHashtagsInNoteBody = false;
    await handleLongFormEditAction(
      USER,
      POST,
      formRequest("publish", publishFields())
    );
    expect(lastUpdate()["content"]).toBe("safe:Body");

    validation.state.data.queueType = "";
    users.getQueueTypeByNameForUser.mockClear();
    await handleLongFormEditAction(
      USER,
      POST,
      formRequest("publish", publishFields())
    );
    expect(users.getQueueTypeByNameForUser).not.toHaveBeenCalled();

    await expect(
      handleLongFormEditAction(
        USER,
        POST,
        formRequest(
          "publish",
          publishFields({ signedEvent: eventJson("throw-error") })
        )
      )
    ).rejects.toThrow("bad pubkey");
    await expect(
      handleLongFormEditAction(
        USER,
        POST,
        formRequest(
          "publish",
          publishFields({ signedEvent: eventJson("throw-string") })
        )
      )
    ).rejects.toBe("bad pubkey");
    await expect(
      handleLongFormEditAction(
        USER,
        POST,
        formRequest("publish", publishFields({ signedEvent: "not-json" }))
      )
    ).rejects.toThrow(SyntaxError);
  });

  it("schedules, skips scheduling, and enforces the schedule cap", async () => {
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);
    validation.state.data._action = "schedule-longform";
    validation.state.data.queueType = "News";
    validation.state.data.includeHashtagsInNoteBody = true;
    validation.state.data.useHashtagPresets = true;
    validation.state.data.hashTagPresetId = null;
    users.getQueueTypeByNameForUser.mockResolvedValue({ id: "q-1" });

    const missing = await handleLongFormEditAction(
      USER,
      POST,
      formRequest("schedule-longform", { title: " " })
    );
    expect(readError(missing)).toBe("Title is required");

    const unscheduled = await handleLongFormEditAction(
      USER,
      POST,
      formRequest(
        "schedule-longform",
        publishFields({ signedEvent: eventJson("session-pk", "") })
      )
    );
    expect(readRedirect(unscheduled)).toBe(
      `/dashboard/scheduled?scheduled=${POST}&tab=longform`
    );
    expect(lastUpdate()["scheduledAtUtc"]).toBeNull();
    expect(lastUpdate()["content"]).toBe("safe:Body\\n\\n");
    expect(posts.getLongFormPost).not.toHaveBeenCalled();
    expect(scheduleCase.execute).not.toHaveBeenCalled();

    posts.getLongFormPost.mockResolvedValue({
      currentState: "SCHEDULED",
      scheduledAtUtc: future,
    });
    await handleLongFormEditAction(
      USER,
      POST,
      formRequest("schedule-longform", {
        ...publishFields(),
        nominalScheduledFor: "1700000200",
      })
    );
    expect(caps.assertScheduleCapacity).toHaveBeenCalledWith(USER, 0);
    const scheduled = scheduleCase.execute.mock.calls.at(-1)?.[0];
    expect(
      epochMillis(isRecord(scheduled) ? scheduled["scheduledAtUtc"] : null)
    ).toBe(1_700_000_100 * 1000);
    expect(
      epochMillis(
        isRecord(scheduled) ? scheduled["nominalScheduledAtUtc"] : null
      )
    ).toBe(1_700_000_200 * 1000);

    posts.getLongFormPost.mockResolvedValue({
      currentState: "SCHEDULED",
      scheduledAtUtc: past,
    });
    await handleLongFormEditAction(
      USER,
      POST,
      formRequest(
        "schedule-longform",
        publishFields({ nominalScheduledFor: "  " })
      )
    );
    expect(caps.assertScheduleCapacity).toHaveBeenCalledWith(USER, 1);
    expect(
      "nominalScheduledAtUtc" in
        (scheduleCase.execute.mock.calls.at(-1)?.[0] ?? {})
    ).toBe(false);

    posts.getLongFormPost.mockResolvedValue({
      currentState: "DRAFT",
      scheduledAtUtc: future,
    });
    await handleLongFormEditAction(
      USER,
      POST,
      formRequest(
        "schedule-longform",
        publishFields({ nominalScheduledFor: "nope" })
      )
    );
    expect(caps.assertScheduleCapacity).toHaveBeenCalledWith(USER, 1);

    posts.getLongFormPost.mockResolvedValue(null);
    caps.state.mode = "cap";
    const capped = await handleLongFormEditAction(
      USER,
      POST,
      formRequest("schedule-longform", publishFields())
    );
    expect(readStatus(capped)).toBe(403);
    expect(readError(capped)).toBe("cap full");

    caps.state.mode = "error";
    await expect(
      handleLongFormEditAction(
        USER,
        POST,
        formRequest("schedule-longform", publishFields())
      )
    ).rejects.toThrow("cap down");
    caps.state.mode = "string";
    await expect(
      handleLongFormEditAction(
        USER,
        POST,
        formRequest("schedule-longform", publishFields())
      )
    ).rejects.toBe("cap down");

    await expect(
      handleLongFormEditAction(
        USER,
        POST,
        formRequest(
          "schedule-longform",
          publishFields({ signedEvent: eventJson("throw-error") })
        )
      )
    ).rejects.toThrow("bad pubkey");
  });
});
