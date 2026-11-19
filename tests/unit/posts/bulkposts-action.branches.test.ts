import { beforeEach, describe, expect, it, vi } from "vitest";

interface RuntimeFlags {
  allowBulk: boolean;
  deployment: "hosted" | "self-hosted";
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  error?: string;
}

interface PlanRow {
  name: string;
  id: string;
  enableLifetimeAccess?: boolean;
}

interface SubscriptionRow {
  planId?: string;
  status?: string;
  currentPeriodEnd?: Date | null;
  Plan?: PlanRow | null;
}

interface Note {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  tags: string[][];
  sig: string;
}

interface SignExtras {
  captions?: string[];
  fileUrls?: string[][];
  queueTypes?: string[];
  recyclable?: string[];
  originalIds?: string[];
  nominal?: string[];
  repostSchedules?: string[];
  quoteSchedules?: string[];
  inModal?: boolean;
}

interface CreateInput {
  userId: string;
  content: string;
  caption?: string;
  fileUrl: string[];
  postType: string;
  queueType?: string;
  tags?: string[];
  isRecyclable: boolean;
  repost?: boolean;
  isQuotedPost?: boolean;
  repostOfPostId?: string;
  quoteOfPostId?: string;
  postKind?: string;
  nominalScheduledFor?: number;
  scheduledFor?: number;
}

interface CreateResult {
  post:
    | {
        id?: string;
        postType?: string;
        scheduledAtUtc?: Date | string | number | null;
        nostrEventId?: unknown;
        signedEvent?: unknown;
        rootScheduledActionId?: string | null;
      }
    | undefined;
}

interface FollowUpInput {
  userId: string;
  content: string;
  caption: string;
  postType: string;
  queueTypeId: string | null;
  isRecyclable: boolean;
  dependencyMode?: string;
  targetMode?: string;
  postKind?: string;
  repost?: boolean;
  isQuotedPost?: boolean;
  repostOfPostId?: string;
  quoteOfPostId?: string;
  parentScheduledActionId?: string;
  rootScheduledActionId?: string;
  expectedParentEventId?: string;
  followUpOffsetSeconds?: number;
  followUpTimingMode?: string;
  signingState?: string;
  signedChildEventId?: string;
  repostConditions?: Record<string, number> | null;
  signedEvent?: unknown;
}

interface SnapshotRow {
  caption: string;
  fileUrl: string[];
  queueTypeId: string | null;
  scheduledFor: string | null;
  sortOrder: number;
  isRecyclable: boolean;
}

interface RouteBody {
  status: number;
  body: Record<string, unknown>;
  location: string | null;
}

const flags = vi.hoisted((): RuntimeFlags => ({
  allowBulk: true,
  deployment: "hosted",
}));

const auth = vi.hoisted(() => ({
  requireUserId: vi.fn(
    async (_request: Request): Promise<string | null> => "user-123"
  ),
}));

const payments = vi.hoisted(() => ({
  getUserSubscription: vi.fn(
    async (_userId: string): Promise<SubscriptionRow | null> => null
  ),
}));

const entitlements = vi.hoisted(() => ({
  currentDeployment: vi.fn(() => ({ mode: flags.deployment })),
  getEffectivePlanEntitlements: vi.fn((_planType: string) => ({
    canExecuteBulkActions: flags.allowBulk,
  })),
}));

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

const limits = vi.hoisted(() => ({
  checkUserPostCreationLimit: vi.fn(
    async (
      _userId: string,
      _count: number,
      _windowMinutes: number,
      _max: number
    ): Promise<RateLimitResult> => ({
      allowed: true,
      remaining: 10,
      resetTime: 1_700_000_100,
    })
  ),
}));

const composer = vi.hoisted(() => ({
  execute: vi.fn(async (_input: CreateInput): Promise<CreateResult> => ({
    post: { id: "post-1", postType: "TEXT", scheduledAtUtc: null },
  })),
}));

const postsApi = vi.hoisted(() => ({
  createPostWithOutbox: vi.fn(
    async (
      _input: FollowUpInput,
      _unix: number,
      _correlationId?: string
    ): Promise<{ id: string }> => ({ id: "follow-1" })
  ),
  updatePost: vi.fn(
    async (_input: {
      id: string;
      userId: string;
      data: { isRecyclable: boolean };
    }): Promise<void> => undefined
  ),
}));

const drafts = vi.hoisted(() => ({
  getOrCreateDraftGroup: vi.fn(
    async (
      _userId: string,
      _groupId: string | null
    ): Promise<{ groupId: string }> => ({ groupId: "group-1" })
  ),
  deleteDraftGroupPosts: vi.fn(
    async (_groupId: string, _userId: string): Promise<void> => undefined
  ),
  createDraftGroupVersion: vi.fn(
    async (
      _groupId: string,
      _rows: SnapshotRow[],
      _userId: string
    ): Promise<void> => undefined
  ),
}));

const repo = vi.hoisted(() => ({
  updateDraftGroup: vi.fn(
    async (
      _groupId: string,
      _userId: string,
      _data: { updatedAt: Date }
    ): Promise<void> => undefined
  ),
  updatePost: vi.fn(
    async (
      _id: string,
      _userId: string,
      _data: { draftGroupId: string }
    ): Promise<void> => undefined
  ),
}));

const queues = vi.hoisted(() => ({
  resolveQueueTypeId: vi.fn(
    async (
      _userId: string,
      _queueTypeId: string | null,
      name: string | null
    ): Promise<string | null> => (name === null ? null : `id-${name}`)
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

const metrics = vi.hoisted(() => ({
  recordPostScheduled: vi.fn((_postType: string): void => undefined),
}));

const correlation = vi.hoisted(() => ({
  getCorrelationId: vi.fn((): string => "corr-1"),
}));

const logger = vi.hoisted(() => ({
  logInfo: vi.fn(
    (_message: string, _context?: Record<string, unknown>): void => undefined
  ),
  logWarning: vi.fn(
    (_message: string, _context?: Record<string, unknown>): void => undefined
  ),
  logError: vi.fn(
    (_error: unknown, _context?: Record<string, unknown>): void => undefined
  ),
}));

vi.mock("~/features/auth/auth.server", () => ({
  requireUserId: auth.requireUserId,
}));
vi.mock("~/features/payments/data/payment.queries.server", () => ({
  getUserSubscription: payments.getUserSubscription,
}));
vi.mock("~/features/payments/entitlements/deployment-mode.server", () => ({
  currentDeployment: entitlements.currentDeployment,
  getEffectivePlanEntitlements: entitlements.getEffectivePlanEntitlements,
}));
vi.mock("~/features/payments/entitlements/schedule-cap-policy.server", () => ({
  assertScheduleCapacity: caps.assertScheduleCapacity,
  ScheduleCapExceededError: caps.ScheduleCapExceededError,
}));
vi.mock("~/lib/rate-limit.server", () => ({
  checkUserPostCreationLimit: limits.checkUserPostCreationLimit,
}));
vi.mock("~/features/posts/composer/index.server", () => ({
  CreatePostUseCase: class CreatePostUseCase {
    execute = composer.execute;
  },
}));
vi.mock("~/features/posts/server", () => ({
  createPostWithOutbox: postsApi.createPostWithOutbox,
  updatePost: postsApi.updatePost,
}));
vi.mock("~/features/posts/server/drafts", () => drafts);
vi.mock("~/features/posts/repositories/draft-data.server", () => ({
  updateDraftGroup: repo.updateDraftGroup,
}));
vi.mock("~/features/posts/repositories/post-queries-data.server", () => ({
  updatePost: repo.updatePost,
}));
vi.mock("~/features/posts/services/queue-type-resolver.server", () => ({
  resolveQueueTypeId: queues.resolveQueueTypeId,
}));
vi.mock("~/features/posts/state-machine/post-state-machine.server", () => ({
  PostStateMachine: class PostStateMachine {
    transition = machine.transition;
  },
}));
vi.mock("~/lib/metrics/business-metrics.server", () => ({
  recordPostScheduled: metrics.recordPostScheduled,
}));
vi.mock("~/lib/correlation-context.server", () => ({
  getCorrelationId: correlation.getCorrelationId,
}));
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

import { postFactory } from "../../factories";
import { asRouteResponse } from "../../utils/action-test-helpers";
import {
  createMockPost,
  setupFetchMock,
  TEST_USER_ID,
} from "../../utils/mock-helpers";

import {
  bulkPostsAction,
  handleSaveAsDraft,
  handleSignAndSchedule,
  handleUploadImagesPreview,
} from "~/features/posts/bulkposts.action.server";

const PARENT_UNIX = 1_700_000_000;

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "evt-1",
    pubkey: "pk",
    created_at: PARENT_UNIX,
    kind: 1,
    content: "hello world",
    tags: [["t", "tag"]],
    sig: "sig",
    ...overrides,
  };
}

function signForm(notes: Note[], extras: SignExtras = {}): FormData {
  const form = new FormData();
  form.append("_action", "sign_and_schedule");
  notes.forEach((item, index) => {
    form.append("signedEvents", JSON.stringify(item));
    form.append(
      "nostrEvent",
      JSON.stringify({
        id: item.id,
        pubkey: item.pubkey,
        created_at: item.created_at,
        kind: item.kind,
        content: item.content,
        tags: item.tags,
      })
    );
    form.append(
      "caption",
      JSON.stringify(extras.captions?.[index] ?? "caption")
    );
    form.append("fileUrl", JSON.stringify(extras.fileUrls?.[index] ?? []));
    form.append("queueType", extras.queueTypes?.[index] ?? "posts");
    form.append("isRecyclable", extras.recyclable?.[index] ?? "false");
    form.append("originalPostId", extras.originalIds?.[index] ?? "");
    form.append("nominalScheduledFor", extras.nominal?.[index] ?? "");
  });
  for (const raw of extras.repostSchedules ?? []) {
    form.append("repostSchedules", raw);
  }
  for (const raw of extras.quoteSchedules ?? []) {
    form.append("quoteSchedules", raw);
  }
  if (extras.inModal) form.append("_inModal", "1");
  return form;
}

function childEvent(id: string, when: number): Note {
  return note({ id, kind: 6, content: "", created_at: when, tags: [] });
}

async function readRoute(result: unknown): Promise<RouteBody> {
  const response = await asRouteResponse(result);
  const location = response.headers.get("Location");
  if (response.status >= 300 && response.status < 400) {
    return { status: response.status, body: {}, location };
  }
  const raw: unknown = await response.json();
  const body =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return { status: response.status, body, location };
}

function errorText(body: Record<string, unknown>): string {
  const error = body["error"];
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object" && "message" in error) {
    const message = error["message"];
    return typeof message === "string" ? message : "";
  }
  return "";
}

function errorCode(body: Record<string, unknown>): string {
  const error = body["error"];
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = error["code"];
    return typeof code === "string" ? code : "";
  }
  return "";
}

function createInputs(): CreateInput[] {
  return composer.execute.mock.calls.map((call) => call[0]);
}

function followUps(): FollowUpInput[] {
  return postsApi.createPostWithOutbox.mock.calls.map((call) => call[0]);
}

describe("bulk posts action branches", () => {
  beforeEach(async () => {
    flags.allowBulk = true;
    flags.deployment = "hosted";
    setupFetchMock();
    await import("~/lib/prisma.server");
    await import("~/infra/queue/queue-client.server");

    auth.requireUserId.mockReset();
    auth.requireUserId.mockResolvedValue(TEST_USER_ID);
    payments.getUserSubscription.mockReset();
    payments.getUserSubscription.mockResolvedValue(null);
    entitlements.getEffectivePlanEntitlements.mockClear();
    caps.assertScheduleCapacity.mockReset();
    caps.assertScheduleCapacity.mockResolvedValue(undefined);
    limits.checkUserPostCreationLimit.mockReset();
    limits.checkUserPostCreationLimit.mockResolvedValue({
      allowed: true,
      remaining: 9,
      resetTime: 1_700_000_100,
    });
    composer.execute.mockReset();
    composer.execute.mockResolvedValue({
      post: {
        ...createMockPost({ id: "post-1", postType: "TEXT" }),
        scheduledAtUtc: null,
        nostrEventId: null,
        rootScheduledActionId: null,
      },
    });
    postsApi.createPostWithOutbox.mockReset();
    postsApi.createPostWithOutbox.mockResolvedValue({ id: "follow-1" });
    postsApi.updatePost.mockReset();
    postsApi.updatePost.mockResolvedValue(undefined);
    drafts.getOrCreateDraftGroup.mockReset();
    drafts.getOrCreateDraftGroup.mockResolvedValue({ groupId: "group-1" });
    drafts.deleteDraftGroupPosts.mockReset();
    drafts.deleteDraftGroupPosts.mockResolvedValue(undefined);
    drafts.createDraftGroupVersion.mockReset();
    drafts.createDraftGroupVersion.mockResolvedValue(undefined);
    repo.updateDraftGroup.mockReset();
    repo.updateDraftGroup.mockResolvedValue(undefined);
    repo.updatePost.mockReset();
    repo.updatePost.mockResolvedValue(undefined);
    queues.resolveQueueTypeId.mockClear();
    machine.transition.mockClear();
    metrics.recordPostScheduled.mockClear();
    logger.logInfo.mockReset();
    logger.logWarning.mockReset();
    logger.logError.mockReset();
  });

  describe("handleUploadImagesPreview", () => {
    it("returns 400 for a missing, non-string, invalid, or non-array fileUrls", async () => {
      const missing = await readRoute(
        await handleUploadImagesPreview(new FormData())
      );
      expect(missing.status).toBe(400);
      expect(errorText(missing.body)).toContain("fileUrls is required");

      const blobForm = new FormData();
      blobForm.append("fileUrls", new File(["[]"], "urls.txt"));
      const blob = await readRoute(await handleUploadImagesPreview(blobForm));
      expect(blob.status).toBe(400);
      expect(errorText(blob.body)).toContain("fileUrls is required");

      const invalid = new FormData();
      invalid.append("fileUrls", "{");
      const badJson = await readRoute(await handleUploadImagesPreview(invalid));
      expect(badJson.status).toBe(400);
      expect(errorText(badJson.body)).toBe("Invalid fileUrls JSON");

      const objectForm = new FormData();
      objectForm.append("fileUrls", JSON.stringify({ a: 1 }));
      const notArray = await readRoute(
        await handleUploadImagesPreview(objectForm)
      );
      expect(notArray.status).toBe(400);
      expect(errorText(notArray.body)).toBe("Invalid fileUrls format");
    });

    it("returns 400 when fileUrls, dates, and queues have different lengths", async () => {
      const form = new FormData();
      form.append("fileUrls", JSON.stringify([["https://cdn.example/a.jpg"]]));
      form.append("scheduledDates", "2024-01-01");
      form.append("scheduledDates", "2024-01-02");
      form.append("queueTypes", "posts");
      const result = await readRoute(await handleUploadImagesPreview(form));
      expect(result.status).toBe(400);
      expect(errorText(result.body)).toBe(
        "Mismatch between fileUrls and post data"
      );
    });

    it("keeps string urls and drops non-arrays or non-strings", async () => {
      const form = new FormData();
      form.append(
        "fileUrls",
        JSON.stringify([["https://cdn.example/a.jpg", 2, null], "nope"])
      );
      form.append("scheduledDates", "2024-01-01");
      form.append("scheduledDates", "");
      form.append("queueTypes", "posts");
      form.append("queueTypes", "all");
      const result = await handleUploadImagesPreview(form);
      expect(result).toEqual({
        success: true,
        fileUrls: [
          {
            fileUrl: ["https://cdn.example/a.jpg"],
            scheduledFor: "2024-01-01",
          },
          { fileUrl: [], scheduledFor: "" },
        ],
      });
      const previewLog = logger.logInfo.mock.calls.find(
        (call) => call[0] === "[BulkPosts] handleUploadImagesPreview completed"
      );
      expect(previewLog?.[1]?.["postCount"]).toBe(2);
      expect(typeof previewLog?.[1]?.["totalTimeMs"]).toBe("number");
    });

    it("turns a thrown logger Error or string into an action error", async () => {
      const form = new FormData();
      form.append("fileUrls", JSON.stringify([["https://cdn.example/a.jpg"]]));
      form.append("scheduledDates", "2024-01-01");
      form.append("queueTypes", "posts");

      logger.logInfo.mockImplementationOnce(() => {
        throw new Error("preview broke");
      });
      const asError = await readRoute(await handleUploadImagesPreview(form));
      expect(asError.status).toBe(500);
      expect(errorText(asError.body)).toBe("preview broke");

      logger.logInfo.mockImplementationOnce(() => {
        throw "preview string";
      });
      const asString = await readRoute(await handleUploadImagesPreview(form));
      expect(asString.status).toBe(500);
      expect(errorCode(asString.body)).toBe("UNKNOWN_ERROR");
    });
  });

  describe("handleSignAndSchedule", () => {
    it("returns the validation response and does not check the rate limit", async () => {
      const form = new FormData();
      form.append("_action", "sign_and_schedule");
      const result = await readRoute(
        await handleSignAndSchedule(form, TEST_USER_ID, null)
      );
      expect(result.status).toBe(400);
      expect(errorText(result.body).length).toBeGreaterThan(0);
      expect(limits.checkUserPostCreationLimit).not.toHaveBeenCalled();
    });

    it("rejects a rate limit with a custom message and with the default message", async () => {
      limits.checkUserPostCreationLimit.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetTime: 50,
        error: "slow down",
      });
      const custom = await readRoute(
        await handleSignAndSchedule(signForm([note()]), TEST_USER_ID, null)
      );
      expect(custom.status).toBe(429);
      expect(errorText(custom.body)).toBe("slow down");
      expect(errorCode(custom.body)).toBe("RATE_LIMIT_ERROR");

      limits.checkUserPostCreationLimit.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetTime: 50,
      });
      const fallback = await readRoute(
        await handleSignAndSchedule(signForm([note()]), TEST_USER_ID, null)
      );
      expect(fallback.status).toBe(429);
      expect(errorText(fallback.body)).toBe(
        "Post creation limit exceeded. Please try again later."
      );
      expect(limits.checkUserPostCreationLimit).toHaveBeenCalledWith(
        TEST_USER_ID,
        1,
        60,
        2000
      );
      expect(payments.getUserSubscription).not.toHaveBeenCalled();
    });

    it("maps each subscription shape onto a plan type", async () => {
      const future = new Date(Date.now() + 86_400_000);
      payments.getUserSubscription
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ status: "ACTIVE" })
        .mockResolvedValueOnce({
          planId: "creator",
          status: "CANCELED",
          Plan: { name: "Creator", id: "creator", enableLifetimeAccess: true },
        })
        .mockResolvedValueOnce({
          planId: "creator",
          status: "ACTIVE",
          currentPeriodEnd: future,
          Plan: { name: "Creator", id: "creator", enableLifetimeAccess: true },
        })
        .mockResolvedValueOnce({
          planId: "starter",
          status: "ACTIVE",
          currentPeriodEnd: null,
          Plan: {
            name: "Starter",
            id: "starter",
            enableLifetimeAccess: false,
          },
        })
        .mockResolvedValueOnce({
          planId: "pro",
          status: "ACTIVE",
          currentPeriodEnd: future,
          Plan: null,
        });

      for (let i = 0; i < 6; i += 1) {
        await handleSignAndSchedule(signForm([note()]), TEST_USER_ID, null);
      }

      expect(
        entitlements.getEffectivePlanEntitlements.mock.calls.map(
          (call) => call[0]
        )
      ).toEqual(["free", "free", "free", "creator", "starter", "pro"]);
    });

    it("blocks bulk scheduling for hosted and self-hosted installs", async () => {
      flags.allowBulk = false;
      const hosted = await readRoute(
        await handleSignAndSchedule(signForm([note()]), TEST_USER_ID, null)
      );
      expect(hosted.status).toBe(403);
      expect(errorText(hosted.body)).toBe(
        "Bulk scheduling is not available for this plan."
      );

      flags.deployment = "self-hosted";
      const selfHosted = await readRoute(
        await handleSignAndSchedule(signForm([note()]), TEST_USER_ID, null)
      );
      expect(selfHosted.status).toBe(403);
      expect(errorText(selfHosted.body)).toBe(
        "Bulk scheduling is turned off for this install."
      );
      expect(caps.assertScheduleCapacity).not.toHaveBeenCalled();
    });

    it("counts schedule rows and handles cap errors", async () => {
      const form = signForm([note()], {
        repostSchedules: ["", "nope", "42", JSON.stringify([{}, {}])],
        quoteSchedules: [JSON.stringify([{}])],
      });
      caps.assertScheduleCapacity.mockRejectedValueOnce(
        new caps.ScheduleCapExceededError("over cap")
      );
      const capped = await readRoute(
        await handleSignAndSchedule(form, TEST_USER_ID, null)
      );
      expect(capped.status).toBe(403);
      expect(errorText(capped.body)).toBe("over cap");

      caps.assertScheduleCapacity.mockRejectedValueOnce(new Error("cap blew"));
      const generic = await readRoute(
        await handleSignAndSchedule(form, TEST_USER_ID, null)
      );
      expect(generic.status).toBe(500);
      expect(errorText(generic.body)).toBe("cap blew");

      caps.assertScheduleCapacity.mockRejectedValueOnce("cap string");
      const thrownString = await readRoute(
        await handleSignAndSchedule(form, TEST_USER_ID, null)
      );
      expect(thrownString.status).toBe(500);
      expect(errorCode(thrownString.body)).toBe("UNKNOWN_ERROR");
      expect(
        caps.assertScheduleCapacity.mock.calls.map((call) => call[1])
      ).toEqual([4, 4, 4]);
    });

    it("derives content, tags, media type, nominal time, and quote detection", async () => {
      const form = signForm(
        [
          note({
            content:
              "alpha https://cdn.example/a.jpg beta http://cdn.example/b.jpg",
            tags: [["t"], ["t", "kept"], ["p", "also"]],
          }),
          note({
            id: "evt-2",
            content: "",
            kind: 1,
            tags: [["e", "abc", "", "mention"]],
          }),
        ],
        {
          captions: ["cap-0", "fallback caption"],
          fileUrls: [
            ["https://cdn.example/photo.jpg"],
            ["https://cdn.example/clip.mp4"],
          ],
          queueTypes: ["posts", "Unassigned"],
          recyclable: ["true", "false"],
          nominal: ["1500", "   "],
        }
      );
      await handleSignAndSchedule(form, TEST_USER_ID, null);
      const inputs = createInputs();
      expect(inputs[0]).toMatchObject({
        userId: TEST_USER_ID,
        content: "alpha beta",
        caption: "cap-0",
        fileUrl: ["https://cdn.example/photo.jpg"],
        postType: "IMAGE",
        queueType: "posts",
        tags: ["kept", "also"],
        isRecyclable: true,
        isQuotedPost: false,
        repost: false,
        postKind: "POST",
        nominalScheduledFor: 1500,
        scheduledFor: PARENT_UNIX,
        skipScheduleCapacityCheck: true,
      });
      expect(inputs[1]).toMatchObject({
        content: "fallback caption",
        caption: "fallback caption",
        fileUrl: ["https://cdn.example/clip.mp4"],
        postType: "VIDEO",
        queueType: "Unassigned",
        isRecyclable: false,
        isQuotedPost: true,
        postKind: "POST",
      });
      expect(inputs[1]?.nominalScheduledFor).toBeUndefined();
      expect(inputs[1]?.quoteOfPostId).toBeUndefined();
    });

    it("sets quote, repost, and kind-6 modes", async () => {
      await handleSignAndSchedule(
        signForm([note()], {
          originalIds: ["orig-1"],
          fileUrls: [["   "]],
        }),
        TEST_USER_ID,
        "quote"
      );
      expect(createInputs()[0]).toMatchObject({
        postType: "TEXT",
        fileUrl: [],
        isQuotedPost: true,
        postKind: "QUOTE",
        quoteOfPostId: "orig-1",
      });
      expect(createInputs()[0]?.repostOfPostId).toBeUndefined();

      composer.execute.mockClear();
      await handleSignAndSchedule(
        signForm([note({ kind: 1 })], { originalIds: ["orig-2"] }),
        TEST_USER_ID,
        "repost"
      );
      expect(createInputs()[0]).toMatchObject({
        repost: false,
        postKind: "REPOST",
        repostOfPostId: "orig-2",
      });
      expect(createInputs()[0]?.quoteOfPostId).toBeUndefined();

      composer.execute.mockClear();
      await handleSignAndSchedule(
        signForm([note({ kind: 6, content: "" })], {
          captions: ["kind six"],
          nominal: ["Infinity"],
        }),
        TEST_USER_ID,
        null
      );
      expect(createInputs()[0]).toMatchObject({
        content: "kind six",
        repost: true,
        postKind: "POST",
      });
      expect(createInputs()[0]?.nominalScheduledFor).toBeUndefined();
      expect(createInputs()[0]?.repostOfPostId).toBeUndefined();
    });

    it("attaches reposts, skips a missing signature, and keeps threshold arms", async () => {
      const built = postFactory.scheduled(new Date(PARENT_UNIX * 1000), {
        id: "main-1",
        postType: "IMAGE",
      });
      composer.execute.mockResolvedValue({
        post: {
          ...built,
          id: "main-1",
          postType: "IMAGE",
          scheduledAtUtc: new Date(PARENT_UNIX * 1000),
          nostrEventId: "nid",
          rootScheduledActionId: "root-1",
          signedEvent: childEvent("ignored", PARENT_UNIX),
        },
      });
      postsApi.createPostWithOutbox
        .mockResolvedValueOnce({ id: "follow-a" })
        .mockResolvedValueOnce({ id: "follow-b" });
      const reposts = JSON.stringify([
        { scheduledFor: PARENT_UNIX + 10 },
        {
          scheduledFor: PARENT_UNIX - 50,
          signedEvent: childEvent("repost-1", PARENT_UNIX - 50),
          minReactions: 1,
          minZaps: 0,
          minComments: -1,
          minReposts: 2,
          minSats: 3,
        },
        {
          scheduledFor: PARENT_UNIX + 20,
          signedEvent: ["not-an-object"],
        },
      ]);
      await handleSignAndSchedule(
        signForm([note()], {
          queueTypes: ["Unassigned"],
          recyclable: ["true"],
          repostSchedules: [reposts],
        }),
        TEST_USER_ID,
        null
      );

      expect(queues.resolveQueueTypeId).toHaveBeenCalledWith(
        TEST_USER_ID,
        null,
        null
      );
      const created = followUps();
      expect(created).toHaveLength(2);
      expect(created[0]).toMatchObject({
        userId: TEST_USER_ID,
        postType: "IMAGE",
        queueTypeId: null,
        isRecyclable: true,
        repost: true,
        postKind: "REPOST",
        repostOfPostId: "main-1",
        dependencyMode: "attached",
        targetMode: "scheduled_parent",
        parentScheduledActionId: "main-1",
        rootScheduledActionId: "root-1",
        expectedParentEventId: "nid",
        followUpOffsetSeconds: 0,
        followUpTimingMode: "offset_from_parent",
        signingState: "signed",
        signedChildEventId: "repost-1",
        repostConditions: {
          minReactions: 1,
          minZaps: 0,
          minReposts: 2,
          minSats: 3,
        },
      });
      expect(created[0]?.repostConditions?.["minComments"]).toBeUndefined();
      expect(created[1]?.signedEvent).toEqual(["not-an-object"]);
      expect(created[1]?.signingState).toBeUndefined();
      expect(created[1]?.dependencyMode).toBe("attached");
      expect(machine.transition).toHaveBeenNthCalledWith(
        1,
        "follow-a",
        TEST_USER_ID,
        "SCHEDULED",
        "Repost created with schedule"
      );
      expect(metrics.recordPostScheduled).toHaveBeenCalledWith("IMAGE");
      expect(postsApi.createPostWithOutbox.mock.calls[0]?.[2]).toBe("corr-1");
      expect(logger.logInfo).toHaveBeenCalledWith(
        "Bulk repost skipped: missing signedEvent",
        { index: 0, mainPostId: "main-1" }
      );
    });

    it("schedules quotes from a string parent time and a primitive signed event", async () => {
      composer.execute.mockResolvedValue({
        post: {
          id: "main-2",
          postType: "TEXT",
          scheduledAtUtc: new Date(PARENT_UNIX * 1000).toISOString(),
          nostrEventId: "",
          signedEvent: { id: "from-signed" },
          rootScheduledActionId: null,
        },
      });
      const quotes = JSON.stringify([
        { scheduledFor: PARENT_UNIX + 30 },
        {
          scheduledFor: PARENT_UNIX + 40,
          signedEvent: "raw-event",
          caption: "quoted",
        },
        {
          scheduledFor: PARENT_UNIX + 80,
          signedEvent: childEvent("quote-1", PARENT_UNIX + 80),
        },
      ]);
      await handleSignAndSchedule(
        signForm([note()], { quoteSchedules: [quotes] }),
        TEST_USER_ID,
        null
      );
      const created = followUps();
      expect(created).toHaveLength(2);
      expect(created[0]).toMatchObject({
        content: "quoted",
        caption: "quoted",
        isQuotedPost: true,
        postKind: "QUOTE",
        quoteOfPostId: "main-2",
        dependencyMode: "attached",
        rootScheduledActionId: "main-2",
        expectedParentEventId: "from-signed",
        followUpOffsetSeconds: 40,
      });
      expect(created[0]?.signingState).toBeUndefined();
      expect(created[1]).toMatchObject({
        content: "",
        signingState: "signed",
        signedChildEventId: "quote-1",
        followUpOffsetSeconds: 80,
      });
      expect(machine.transition).toHaveBeenCalledWith(
        "follow-1",
        TEST_USER_ID,
        "SCHEDULED",
        "Quote post created with schedule"
      );
    });

    it("stores a standalone follow-up when the parent time is missing or not a date", async () => {
      composer.execute.mockResolvedValue({
        post: {
          id: "main-3",
          postType: "TEXT",
          scheduledAtUtc: 123,
          nostrEventId: null,
          signedEvent: { pubkey: "only" },
          rootScheduledActionId: "",
        },
      });
      await handleSignAndSchedule(
        signForm([note()], {
          repostSchedules: ["{}"],
          quoteSchedules: [
            JSON.stringify([
              {
                scheduledFor: PARENT_UNIX + 5,
                signedEvent: childEvent("quote-standalone", PARENT_UNIX + 5),
              },
            ]),
          ],
        }),
        TEST_USER_ID,
        "other"
      );
      expect(followUps()).toHaveLength(1);
      expect(followUps()[0]).toMatchObject({
        dependencyMode: "standalone",
        targetMode: "direct",
      });
      expect(followUps()[0]?.expectedParentEventId).toBeUndefined();
      expect(followUps()[0]?.repostConditions).toBeUndefined();
    });

    it("logs repost and quote failures for an Error and a thrown string", async () => {
      composer.execute.mockResolvedValue({
        post: {
          id: "main-4",
          postType: "TEXT",
          scheduledAtUtc: new Date("not-a-date"),
          nostrEventId: null,
          signedEvent: null,
        },
      });
      postsApi.createPostWithOutbox.mockRejectedValueOnce(
        new Error("repost broke")
      );
      await handleSignAndSchedule(
        signForm([note()], {
          repostSchedules: [
            JSON.stringify([
              {
                scheduledFor: PARENT_UNIX + 1,
                signedEvent: childEvent("bad-repost", PARENT_UNIX + 1),
              },
            ]),
          ],
        }),
        TEST_USER_ID,
        null
      );
      expect(logger.logInfo).toHaveBeenCalledWith(
        "Bulk repost schedule parse/create failed",
        { index: 0, error: "repost broke" }
      );

      logger.logInfo.mockClear();
      postsApi.createPostWithOutbox.mockRejectedValueOnce("quote broke");
      await handleSignAndSchedule(
        signForm([note()], {
          quoteSchedules: [
            JSON.stringify([
              {
                scheduledFor: PARENT_UNIX + 1,
                signedEvent: childEvent("bad-quote", PARENT_UNIX + 1),
              },
            ]),
          ],
        }),
        TEST_USER_ID,
        null
      );
      expect(logger.logInfo).toHaveBeenCalledWith(
        "Bulk quote schedule parse/create failed",
        { index: 0, error: "quote broke" }
      );

      logger.logInfo.mockClear();
      await handleSignAndSchedule(
        signForm([note()], { quoteSchedules: ["{"] }),
        TEST_USER_ID,
        null
      );
      const parseError = logger.logInfo.mock.calls.find(
        (call) => call[0] === "Bulk quote schedule parse/create failed"
      );
      expect(typeof parseError?.[1]?.["error"]).toBe("string");
      expect(String(parseError?.[1]?.["error"])).toContain("JSON");
    });

    it("marks recycled originals and continues when that update throws", async () => {
      await handleSignAndSchedule(
        signForm([note()], { originalIds: ["orig-a", ""] }),
        TEST_USER_ID,
        "recycle"
      );
      expect(postsApi.updatePost).toHaveBeenCalledWith({
        id: "orig-a",
        userId: TEST_USER_ID,
        data: { isRecyclable: false },
      });
      expect(logger.logWarning).not.toHaveBeenCalled();

      postsApi.updatePost.mockClear();
      postsApi.updatePost
        .mockRejectedValueOnce(new Error("mark failed"))
        .mockRejectedValueOnce("mark string");
      const result = await readRoute(
        await handleSignAndSchedule(
          signForm([note(), note({ id: "evt-2" })], {
            originalIds: ["orig-b", "orig-c"],
          }),
          TEST_USER_ID,
          "recycle"
        )
      );
      expect(result.status).toBeGreaterThanOrEqual(300);
      expect(result.status).toBeLessThan(400);
      const warnings = logger.logWarning.mock.calls.map((call) => ({
        message: call[0],
        error: call[1]?.["error"],
        isDraft: call[1]?.["isDraft"],
      }));
      expect(warnings).toEqual([
        {
          message: "Failed to mark post as non-recyclable",
          error: "mark failed",
          isDraft: false,
        },
        {
          message: "Failed to mark post as non-recyclable",
          error: "mark string",
          isDraft: false,
        },
      ]);
    });

    it("returns modal JSON or redirects for mode, date, and missing ids", async () => {
      composer.execute
        .mockResolvedValueOnce({
          post: {
            id: "first",
            postType: "TEXT",
            scheduledAtUtc: null,
          },
        })
        .mockResolvedValueOnce({
          post: {
            id: "second",
            postType: "TEXT",
            scheduledAtUtc: new Date("2024-06-01T00:00:00.000Z"),
          },
        });
      const modal = await handleSignAndSchedule(
        signForm([note(), note({ id: "evt-2" })], {
          queueTypes: ["posts", ""],
          inModal: true,
        }),
        TEST_USER_ID,
        "quote"
      );
      expect(modal).toEqual({
        bulkScheduled: true,
        count: 2,
        firstPostId: "first",
        lastScheduledAt: "2024-06-01T00:00:00.000Z",
        queueSummary: { posts: 1, unassigned: 1 },
      });

      composer.execute.mockResolvedValueOnce({
        post: {
          id: "only",
          scheduledAtUtc: "2024-07-01T00:00:00.000Z",
        },
      });
      const redirect = await readRoute(
        await handleSignAndSchedule(signForm([note()]), TEST_USER_ID, "quote")
      );
      const redirected = new URL(redirect.location ?? "", "http://localhost");
      expect(redirect.status).toBe(302);
      expect(redirected.pathname).toBe("/dashboard/bulkposts");
      expect(redirected.searchParams.get("mode")).toBe("quote");
      expect(redirected.searchParams.get("firstPostId")).toBe("only");
      expect(redirected.searchParams.get("lastScheduledAt")).toBe(
        "2024-07-01T00:00:00.000Z"
      );

      composer.execute.mockResolvedValueOnce({
        post: { id: "num", scheduledAtUtc: 42 },
      });
      const noDate = await readRoute(
        await handleSignAndSchedule(signForm([note()]), TEST_USER_ID, null)
      );
      const noDateUrl = new URL(noDate.location ?? "", "http://localhost");
      expect(noDateUrl.searchParams.get("mode")).toBeNull();
      expect(noDateUrl.searchParams.get("lastScheduledAt")).toBeNull();

      composer.execute.mockResolvedValueOnce({
        post: { scheduledAtUtc: null },
      });
      const missing = await readRoute(
        await handleSignAndSchedule(signForm([note()]), TEST_USER_ID, null)
      );
      const missingUrl = new URL(missing.location ?? "", "http://localhost");
      expect(missing.status).toBe(302);
      expect(missingUrl.pathname).toBe("/dashboard/scheduled");
    });

    it("returns an action error when creating a post throws an Error or a string", async () => {
      composer.execute.mockRejectedValueOnce(new Error("create blew"));
      const asError = await readRoute(
        await handleSignAndSchedule(signForm([note()]), TEST_USER_ID, null)
      );
      expect(asError.status).toBe(500);
      expect(errorText(asError.body)).toBe("create blew");

      composer.execute.mockRejectedValueOnce("create string");
      const asString = await readRoute(
        await handleSignAndSchedule(signForm([note()]), TEST_USER_ID, null)
      );
      expect(asString.status).toBe(500);
      expect(errorCode(asString.body)).toBe("UNKNOWN_ERROR");
    });
  });

  describe("handleSaveAsDraft", () => {
    function draftForm(options: {
      fileUrls: string[][];
      captions?: string[];
      queues?: string[];
      scheduled?: string[];
      originals?: string[];
      recyclable?: Array<string | File>;
      groupId?: string;
    }): FormData {
      const form = new FormData();
      form.append("_action", "save_as_draft");
      if (options.groupId !== undefined)
        form.append("groupId", options.groupId);
      options.fileUrls.forEach((urls, index) => {
        form.append("fileUrl", JSON.stringify(urls));
        form.append("caption", options.captions?.[index] ?? "");
        form.append("queueType", options.queues?.[index] ?? "posts");
        form.append("scheduledFor", options.scheduled?.[index] ?? "");
        form.append("originalPostId", options.originals?.[index] ?? "");
        const flag = options.recyclable?.[index];
        if (flag instanceof File) form.append("isRecyclable", flag);
        else form.append("isRecyclable", flag ?? "false");
      });
      return form;
    }

    it("returns validation and rate-limit failures before creating drafts", async () => {
      const invalid = await readRoute(
        await handleSaveAsDraft(new FormData(), TEST_USER_ID, null)
      );
      expect(invalid.status).toBe(400);
      expect(drafts.getOrCreateDraftGroup).not.toHaveBeenCalled();

      limits.checkUserPostCreationLimit.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetTime: 9,
        error: "draft slow",
      });
      const custom = await readRoute(
        await handleSaveAsDraft(
          draftForm({ fileUrls: [[]] }),
          TEST_USER_ID,
          null
        )
      );
      expect(custom.status).toBe(429);
      expect(errorText(custom.body)).toBe("draft slow");

      limits.checkUserPostCreationLimit.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetTime: 9,
      });
      const fallback = await readRoute(
        await handleSaveAsDraft(
          draftForm({ fileUrls: [[]] }),
          TEST_USER_ID,
          null
        )
      );
      expect(errorText(fallback.body)).toBe(
        "Post creation limit exceeded. Please try again later."
      );
      expect(composer.execute).not.toHaveBeenCalled();
    });

    it("creates text, image, and video rows and replaces an existing group", async () => {
      drafts.getOrCreateDraftGroup.mockResolvedValue({ groupId: "group-9" });
      composer.execute
        .mockResolvedValueOnce({ post: { id: "d1" } })
        .mockResolvedValueOnce({ post: { id: "d2" } })
        .mockResolvedValueOnce({ post: { id: "d3" } });
      const result = await readRoute(
        await handleSaveAsDraft(
          draftForm({
            groupId: "group-9",
            fileUrls: [
              [],
              ["https://cdn.example/photo.jpg"],
              ["https://cdn.example/clip.mp4"],
            ],
            captions: ["text cap", "image cap", "video cap"],
            queues: ["posts", "Unassigned", "all"],
            scheduled: ["", "170", ""],
            recyclable: ["TRUE", "false", new File(["x"], "flag.txt")],
          }),
          TEST_USER_ID,
          null
        )
      );
      expect(result.status).toBe(302);
      expect(result.location).toBe("/dashboard/drafts?tab=bulk");
      expect(drafts.getOrCreateDraftGroup).toHaveBeenCalledWith(
        TEST_USER_ID,
        "group-9"
      );
      expect(drafts.deleteDraftGroupPosts).toHaveBeenCalledWith(
        "group-9",
        TEST_USER_ID
      );
      expect(createInputs().map((input) => input.postType)).toEqual([
        "TEXT",
        "IMAGE",
        "VIDEO",
      ]);
      expect(createInputs().map((input) => input.queueType)).toEqual([
        "posts",
        "Unassigned",
        "all",
      ]);
      expect(createInputs().map((input) => input.isRecyclable)).toEqual([
        true,
        false,
        true,
      ]);
      expect(
        queues.resolveQueueTypeId.mock.calls.map((call) => call[2])
      ).toEqual(["posts", null, "all"]);
      expect(drafts.createDraftGroupVersion).toHaveBeenCalledWith(
        "group-9",
        [
          {
            caption: "text cap",
            fileUrl: [],
            queueTypeId: "id-posts",
            scheduledFor: null,
            sortOrder: 0,
            isRecyclable: true,
          },
          {
            caption: "image cap",
            fileUrl: ["https://cdn.example/photo.jpg"],
            queueTypeId: null,
            scheduledFor: "170",
            sortOrder: 1,
            isRecyclable: false,
          },
          {
            caption: "video cap",
            fileUrl: ["https://cdn.example/clip.mp4"],
            queueTypeId: "id-all",
            scheduledFor: null,
            sortOrder: 2,
            isRecyclable: true,
          },
        ],
        TEST_USER_ID
      );
      expect(repo.updatePost.mock.calls.map((call) => call[0])).toEqual([
        "d1",
        "d2",
        "d3",
      ]);
      expect(repo.updatePost.mock.calls[0]?.[2]).toEqual({
        draftGroupId: "group-9",
      });
      const draftUpdate = repo.updateDraftGroup.mock.calls[0];
      expect(draftUpdate?.[0]).toBe("group-9");
      expect(draftUpdate?.[1]).toBe(TEST_USER_ID);
      expect(draftUpdate?.[2]?.updatedAt).toBeInstanceOf(Date);
    });

    it("does not delete posts when groupId is missing or empty", async () => {
      await handleSaveAsDraft(
        draftForm({ fileUrls: [[]], groupId: "" }),
        TEST_USER_ID,
        null
      );
      expect(drafts.getOrCreateDraftGroup).toHaveBeenCalledWith(
        TEST_USER_ID,
        null
      );
      expect(drafts.deleteDraftGroupPosts).not.toHaveBeenCalled();

      drafts.getOrCreateDraftGroup.mockClear();
      await handleSaveAsDraft(
        draftForm({ fileUrls: [["plain-url"]] }),
        TEST_USER_ID,
        null
      );
      expect(drafts.getOrCreateDraftGroup).toHaveBeenCalledWith(
        TEST_USER_ID,
        null
      );
      expect(createInputs().at(-1)?.fileUrl).toEqual(["plain-url"]);
    });

    it("marks recycled draft originals and swallows update failures", async () => {
      await handleSaveAsDraft(
        draftForm({
          fileUrls: [[], []],
          originals: ["", "orig-d"],
        }),
        TEST_USER_ID,
        "recycle"
      );
      expect(postsApi.updatePost).toHaveBeenCalledWith({
        id: "orig-d",
        userId: TEST_USER_ID,
        data: { isRecyclable: false },
      });

      postsApi.updatePost.mockRejectedValueOnce("draft mark");
      const result = await readRoute(
        await handleSaveAsDraft(
          draftForm({ fileUrls: [[]], originals: ["orig-e"] }),
          TEST_USER_ID,
          "recycle"
        )
      );
      expect(result.location).toBe("/dashboard/drafts?tab=bulk");
      expect(logger.logWarning.mock.calls[0]?.[1]?.["isDraft"]).toBe(true);
      expect(logger.logWarning.mock.calls[0]?.[1]?.["error"]).toBe(
        "draft mark"
      );
    });

    it("returns an action error when a draft dependency throws", async () => {
      drafts.getOrCreateDraftGroup.mockRejectedValueOnce(
        new Error("group down")
      );
      const asError = await readRoute(
        await handleSaveAsDraft(
          draftForm({ fileUrls: [[]] }),
          TEST_USER_ID,
          null
        )
      );
      expect(asError.status).toBe(500);
      expect(errorText(asError.body)).toBe("group down");

      drafts.createDraftGroupVersion.mockRejectedValueOnce("version string");
      const asString = await readRoute(
        await handleSaveAsDraft(
          draftForm({ fileUrls: [[]] }),
          TEST_USER_ID,
          null
        )
      );
      expect(asString.status).toBe(500);
      expect(errorCode(asString.body)).toBe("UNKNOWN_ERROR");
    });
  });

  describe("bulkPostsAction", () => {
    function requestFor(form: FormData, url: string): Request {
      return new Request(url, { method: "POST", body: form });
    }

    it("rejects a missing user and a thrown auth dependency", async () => {
      auth.requireUserId.mockResolvedValueOnce("");
      const missing = await readRoute(
        await bulkPostsAction({
          request: requestFor(
            new FormData(),
            "http://localhost/dashboard/bulkposts"
          ),
        })
      );
      expect(missing.status).toBe(401);
      expect(errorText(missing.body)).toBe("User not authenticated");

      auth.requireUserId.mockResolvedValueOnce(null);
      const absent = await readRoute(
        await bulkPostsAction({
          request: requestFor(
            new FormData(),
            "http://localhost/dashboard/bulkposts"
          ),
        })
      );
      expect(absent.status).toBe(401);

      auth.requireUserId.mockRejectedValueOnce(new Error("session down"));
      const asError = await readRoute(
        await bulkPostsAction({
          request: requestFor(
            new FormData(),
            "http://localhost/dashboard/bulkposts"
          ),
        })
      );
      expect(asError.status).toBe(500);
      expect(errorText(asError.body)).toBe("session down");

      auth.requireUserId.mockRejectedValueOnce("session string");
      const asString = await readRoute(
        await bulkPostsAction({
          request: requestFor(
            new FormData(),
            "http://localhost/dashboard/bulkposts"
          ),
        })
      );
      expect(asString.status).toBe(500);
      expect(errorCode(asString.body)).toBe("UNKNOWN_ERROR");
    });

    it("dispatches upload, sign, and draft actions and rejects an unknown action", async () => {
      const upload = new FormData();
      upload.append("_action", "_upload_images_preview");
      upload.append("fileUrls", "{");
      const preview = await readRoute(
        await bulkPostsAction({
          request: requestFor(upload, "http://localhost/dashboard/bulkposts"),
        })
      );
      expect(preview.status).toBe(400);
      expect(errorText(preview.body)).toBe("Invalid fileUrls JSON");

      const signed = await readRoute(
        await bulkPostsAction({
          request: requestFor(
            signForm([note()]),
            "http://localhost/dashboard/bulkposts?mode=repost"
          ),
        })
      );
      const signedUrl = new URL(signed.location ?? "", "http://localhost");
      expect(signedUrl.searchParams.get("mode")).toBe("repost");

      const explicit = await readRoute(
        await bulkPostsAction({
          request: requestFor(
            signForm([note()]),
            "http://localhost/dashboard/bulkposts"
          ),
          url: new URL("http://localhost/dashboard/bulkposts?mode=quote"),
        })
      );
      const explicitUrl = new URL(explicit.location ?? "", "http://localhost");
      expect(explicitUrl.searchParams.get("mode")).toBe("quote");

      const draft = new FormData();
      draft.append("_action", "save_as_draft");
      draft.append("fileUrl", JSON.stringify([]));
      draft.append("caption", "");
      draft.append("queueType", "posts");
      draft.append("scheduledFor", "");
      const saved = await readRoute(
        await bulkPostsAction({
          request: requestFor(draft, "http://localhost/dashboard/bulkposts"),
        })
      );
      expect(saved.location).toBe("/dashboard/drafts?tab=bulk");

      const unknown = new FormData();
      unknown.append("_action", new File(["nope"], "action.txt"));
      const invalid = await readRoute(
        await bulkPostsAction({
          request: requestFor(unknown, "http://localhost/dashboard/bulkposts"),
        })
      );
      expect(invalid.status).toBe(400);
      expect(errorText(invalid.body)).toBe("Invalid action");
    });

    it("handles a form body that throws an Error or a string", async () => {
      const errorRequest = new Request("http://localhost/dashboard/bulkposts", {
        method: "POST",
      });
      vi.spyOn(errorRequest, "formData").mockRejectedValueOnce(
        new Error("bad form")
      );
      const asError = await readRoute(
        await bulkPostsAction({ request: errorRequest })
      );
      expect(asError.status).toBe(500);
      expect(errorText(asError.body)).toBe("bad form");

      const stringRequest = new Request(
        "http://localhost/dashboard/bulkposts",
        {
          method: "POST",
        }
      );
      vi.spyOn(stringRequest, "formData").mockRejectedValueOnce(
        "bad form string"
      );
      const asString = await readRoute(
        await bulkPostsAction({ request: stringRequest })
      );
      expect(asString.status).toBe(500);
      expect(errorCode(asString.body)).toBe("UNKNOWN_ERROR");
    });
  });
});
