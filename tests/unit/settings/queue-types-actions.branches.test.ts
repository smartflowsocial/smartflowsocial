import { beforeEach, describe, expect, it, vi } from "vitest";

interface PlanInfo {
  id: string;
  name: string;
  enableLifetimeAccess?: boolean;
}

interface SubscriptionRow {
  planId?: string | null;
  status?: string;
  currentPeriodEnd?: Date | null;
  Plan?: PlanInfo | null;
}

interface OperatorLimits {
  maxAccounts: number | null;
  maxBroadcastRecipients: number | null;
  maxConcurrentBroadcasts: number | null;
  maxDailyBroadcastRecipients: number | null;
  maxDrafts: number | null;
  maxFutureScheduledItems: number | null;
  maxGiveawayWinners: number | null;
  maxQueues: number | null;
  maxTemplates: number | null;
}

interface Deployment {
  mode: "hosted" | "self-hosted";
  operatorLimits: OperatorLimits;
}

interface Entitlements {
  maxQueues: number | null;
}

interface HashPreset {
  id: unknown;
  name?: unknown;
  tags?: unknown;
  description?: unknown;
}

interface QueueRow {
  id: string;
  name: string;
  description: string | null;
  scheduleType: string;
  scheduleConfig: unknown;
  status: string;
  isEnabled: boolean;
  userId: string;
  colorToken?: string | null;
  includeHashtagsInNoteBody?: boolean;
  isDefault?: boolean;
  hashTagPresetId?: string | number | null;
  hashTagPreset?: HashPreset | string | null;
}

interface QueueWrite {
  id?: string;
  name: string;
  scheduleType: string;
  scheduleConfig: {
    useGlobalInterval?: boolean;
    intervalHours?: number;
    slots?: string[];
    weeklySlots?: Array<{ dayOfWeek: number; time: string }>;
    scheduleRandomWindowMinutes?: number;
  };
  colorToken?: string;
  description?: string;
  isEnabled?: boolean;
  hashTagPresetId?: string | null;
  includeHashtagsInNoteBody?: boolean;
}

interface ClientPreset {
  id: string;
  name: string;
  tags: string;
  description: string | null;
}

interface ClientQueue {
  id: string;
  name: string;
  colorToken: string | null;
  color: string;
  description: string | null;
  scheduleType: string;
  scheduleConfig: unknown;
  status: "active" | "paused" | "archived";
  isEnabled: boolean;
  userId: string;
  isDefault: boolean;
  hashTagPresetId: string | null;
  hashTagPreset: ClientPreset | null;
  includeHashtagsInNoteBody: boolean;
}

interface PauseResult {
  queue: QueueRow;
  pausedPostCount: number;
  pausedLongFormCount: number;
}

interface ResumeResult {
  queue: QueueRow;
  resumedCount: number;
  needsResignCount: number;
}

interface ScheduledQuery {
  userId: string;
  queueType: string;
  page: number;
  limit: number;
}

interface ScheduledPage {
  posts: Array<{ id: string }>;
}

interface ActionBody {
  status: number;
  error?: string;
}

const payments = vi.hoisted(() => ({
  getUserSubscription:
    vi.fn<(userId: string) => Promise<SubscriptionRow | null>>(),
}));

const entitlements = vi.hoisted(() => ({
  currentDeployment: vi.fn<() => Deployment>(),
  getEffectivePlanEntitlements: vi.fn<(planType: string) => Entitlements>(),
}));

const queues = vi.hoisted(() => ({
  countQueueTypesForUser: vi.fn<(userId: string) => Promise<number>>(),
  deleteQueueType: vi.fn<(userId: string, id: string) => Promise<void>>(),
  getQueueTypeByIdForUser:
    vi.fn<(userId: string, id: string) => Promise<QueueRow | null>>(),
  hashTagPresetExistsForUser:
    vi.fn<(userId: string, id: string) => Promise<boolean>>(),
  invalidateQueueTypesCache: vi.fn<(userId: string) => Promise<void>>(),
  pauseQueueById:
    vi.fn<
      (params: { userId: string; queueTypeId: string }) => Promise<PauseResult>
    >(),
  resumeQueueById:
    vi.fn<
      (params: { userId: string; queueTypeId: string }) => Promise<ResumeResult>
    >(),
  updateQueueType:
    vi.fn<(userId: string, input: QueueWrite) => Promise<QueueRow | null>>(),
}));

const posts = vi.hoisted(() => ({
  deleteLongFormPost:
    vi.fn<(params: { id: string; userId: string }) => Promise<void>>(),
  deletePost:
    vi.fn<(params: { id: string; userId: string }) => Promise<void>>(),
  getScheduledLongFormPosts:
    vi.fn<(query: ScheduledQuery) => Promise<ScheduledPage>>(),
  getScheduledPosts: vi.fn<(query: ScheduledQuery) => Promise<ScheduledPage>>(),
}));

vi.mock("~/features/payments/data", () => payments);
vi.mock("~/features/payments/entitlements/deployment-mode.server", () => ({
  currentDeployment: entitlements.currentDeployment,
  getEffectivePlanEntitlements: entitlements.getEffectivePlanEntitlements,
}));
vi.mock("~/features/posts/data/queue-pause-resume.server", () => ({
  pauseQueueById: queues.pauseQueueById,
  resumeQueueById: queues.resumeQueueById,
}));
vi.mock("~/features/posts/server", () => posts);
vi.mock("~/features/user", () => ({
  deleteQueueType: queues.deleteQueueType,
  getQueueTypeByIdForUser: queues.getQueueTypeByIdForUser,
  hashTagPresetExistsForUser: queues.hashTagPresetExistsForUser,
  updateQueueType: queues.updateQueueType,
}));
vi.mock("~/features/user/repositories/queue-types-data.server", () => ({
  countQueueTypesForUser: queues.countQueueTypesForUser,
}));
vi.mock("~/features/user/services/user-cache.server", () => ({
  invalidateQueueTypesCache: queues.invalidateQueueTypesCache,
}));

import { QUEUE_COLOR_ACCENTS } from "~/features/posts/queue-colors";
import { handleQueueTypeAction } from "~/features/settings/actions/queue-types-actions.server";

const future = new Date("2099-01-01T00:00:00.000Z");
const past = new Date("2000-01-01T00:00:00.000Z");

function deployment(mode: "hosted" | "self-hosted"): Deployment {
  return {
    mode,
    operatorLimits: {
      maxAccounts: null,
      maxBroadcastRecipients: null,
      maxConcurrentBroadcasts: null,
      maxDailyBroadcastRecipients: null,
      maxDrafts: null,
      maxFutureScheduledItems: null,
      maxGiveawayWinners: null,
      maxQueues: null,
      maxTemplates: null,
    },
  };
}

function maxQueuesFor(planType: string): number | null {
  if (planType === "pro" || planType === "teams") return null;
  if (planType === "creator") return 5;
  if (planType === "starter") return 2;
  return 1;
}

function subscription(
  overrides: Partial<SubscriptionRow> = {}
): SubscriptionRow {
  return {
    planId: "pro",
    status: "ACTIVE",
    currentPeriodEnd: future,
    Plan: { id: "pro", name: "Pro", enableLifetimeAccess: false },
    ...overrides,
  };
}

function form(entries: Record<string, string> = {}): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(entries)) body.set(key, value);
  return body;
}

function brokenForm(): FormData {
  const body = new FormData();
  Object.defineProperty(body, "keys", {
    value: () => {
      throw new Error("unreadable form");
    },
  });
  return body;
}

function simpleRow(): QueueRow {
  return {
    id: "q1",
    name: "Main",
    colorToken: "slate",
    description: null,
    scheduleType: "INTERVAL",
    scheduleConfig: { intervalHours: 2 },
    status: "ACTIVE",
    isEnabled: true,
    userId: "user-1",
    includeHashtagsInNoteBody: true,
  };
}

function simpleClient(): ClientQueue {
  return {
    id: "q1",
    name: "Main",
    colorToken: "slate",
    color: QUEUE_COLOR_ACCENTS.slate,
    description: null,
    scheduleType: "INTERVAL",
    scheduleConfig: { intervalHours: 2 },
    status: "active",
    isEnabled: true,
    userId: "user-1",
    isDefault: false,
    hashTagPresetId: null,
    hashTagPreset: null,
    includeHashtagsInNoteBody: true,
  };
}

function updateForm(extra: Record<string, string> = {}): FormData {
  return form({
    id: "q1",
    name: "Main",
    scheduleType: "INTERVAL",
    intervalHours: "2",
    colorToken: "slate",
    ...extra,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

async function readAction(result: unknown): Promise<ActionBody> {
  if (result instanceof Response) {
    const payload = parseJson(await result.text());
    return {
      status: result.status,
      ...(isRecord(payload) && typeof payload["error"] === "string"
        ? { error: payload["error"] }
        : {}),
    };
  }
  if (
    isRecord(result) &&
    result["type"] === "DataWithResponseInit" &&
    "data" in result
  ) {
    const init = result["init"];
    const status =
      isRecord(init) && typeof init["status"] === "number"
        ? init["status"]
        : 200;
    const payload = result["data"];
    return {
      status,
      ...(isRecord(payload) && typeof payload["error"] === "string"
        ? { error: payload["error"] }
        : {}),
    };
  }
  return { status: 0 };
}

function lastWrite(): QueueWrite {
  const call = queues.updateQueueType.mock.calls.at(-1);
  if (!call) throw new Error("expected updateQueueType");
  return call[1];
}

describe("handleQueueTypeAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    payments.getUserSubscription.mockResolvedValue(subscription());
    entitlements.currentDeployment.mockReturnValue(deployment("hosted"));
    entitlements.getEffectivePlanEntitlements.mockImplementation(
      (planType) => ({
        maxQueues: maxQueuesFor(planType),
      })
    );
    queues.countQueueTypesForUser.mockResolvedValue(0);
    queues.hashTagPresetExistsForUser.mockResolvedValue(true);
    queues.updateQueueType.mockResolvedValue(simpleRow());
    queues.getQueueTypeByIdForUser.mockResolvedValue(simpleRow());
    queues.deleteQueueType.mockResolvedValue(undefined);
    queues.invalidateQueueTypesCache.mockResolvedValue(undefined);
    queues.pauseQueueById.mockResolvedValue({
      queue: simpleRow(),
      pausedPostCount: 2,
      pausedLongFormCount: 4,
    });
    queues.resumeQueueById.mockResolvedValue({
      queue: simpleRow(),
      resumedCount: 3,
      needsResignCount: 1,
    });
    posts.getScheduledPosts.mockResolvedValue({ posts: [] });
    posts.getScheduledLongFormPosts.mockResolvedValue({ posts: [] });
    posts.deletePost.mockResolvedValue(undefined);
    posts.deleteLongFormPost.mockResolvedValue(undefined);
  });

  it("returns null for an unknown action", async () => {
    await expect(
      handleQueueTypeAction("user-1", "rename", form())
    ).resolves.toBeNull();
    expect(payments.getUserSubscription).not.toHaveBeenCalled();
  });

  describe("create_queue_type", () => {
    it("blocks creation at the hosted cap before reading the form", async () => {
      payments.getUserSubscription.mockResolvedValue(
        subscription({
          planId: "free",
          Plan: { id: "free", name: "Free", enableLifetimeAccess: false },
        })
      );
      queues.countQueueTypesForUser.mockResolvedValue(1);

      const body = await readAction(
        await handleQueueTypeAction("user-1", "create_queue_type", brokenForm())
      );
      expect(body).toEqual({
        status: 403,
        error:
          "Your plan includes up to 1 queue. Upgrade to create and manage more.",
      });
      expect(queues.countQueueTypesForUser).toHaveBeenCalledWith("user-1");
      expect(queues.updateQueueType).not.toHaveBeenCalled();
      expect(entitlements.currentDeployment).toHaveBeenCalled();
    });

    it("uses the plural hosted message and the self-hosted install message", async () => {
      payments.getUserSubscription.mockResolvedValue(
        subscription({
          planId: "starter",
          Plan: { id: "starter", name: "Starter", enableLifetimeAccess: false },
        })
      );
      queues.countQueueTypesForUser.mockResolvedValue(2);
      const plural = await readAction(
        await handleQueueTypeAction("user-1", "create_queue_type", form())
      );
      expect(plural.error).toBe(
        "Your plan includes up to 2 queues. Upgrade to create and manage more."
      );

      entitlements.currentDeployment.mockReturnValue(deployment("self-hosted"));
      payments.getUserSubscription.mockResolvedValue(
        subscription({
          planId: "free",
          Plan: { id: "free", name: "Free", enableLifetimeAccess: false },
        })
      );
      queues.countQueueTypesForUser.mockResolvedValue(1);
      const install = await readAction(
        await handleQueueTypeAction("user-1", "create_queue_type", form())
      );
      expect(install).toEqual({
        status: 403,
        error: "This install allows up to 1 queue.",
      });
    });

    it("derives the cap from the subscription row", async () => {
      payments.getUserSubscription.mockResolvedValueOnce(null);
      queues.countQueueTypesForUser.mockResolvedValue(1);
      const missing = await readAction(
        await handleQueueTypeAction("user-1", "create_queue_type", form())
      );
      expect(missing.status).toBe(403);
      expect(entitlements.getEffectivePlanEntitlements).toHaveBeenCalledWith(
        "free"
      );

      payments.getUserSubscription.mockResolvedValueOnce(
        subscription({ planId: "" })
      );
      const blank = await readAction(
        await handleQueueTypeAction("user-1", "create_queue_type", form())
      );
      expect(blank.status).toBe(403);

      payments.getUserSubscription.mockResolvedValueOnce(
        subscription({
          planId: "pro",
          status: "CANCELED",
        })
      );
      const canceled = await readAction(
        await handleQueueTypeAction("user-1", "create_queue_type", form())
      );
      expect(canceled.status).toBe(403);
      expect(
        entitlements.getEffectivePlanEntitlements
      ).toHaveBeenLastCalledWith("free");

      payments.getUserSubscription.mockResolvedValueOnce(
        subscription({
          currentPeriodEnd: past,
          Plan: { id: "pro", name: "Pro", enableLifetimeAccess: false },
        })
      );
      const expired = await readAction(
        await handleQueueTypeAction("user-1", "create_queue_type", form())
      );
      expect(expired.status).toBe(403);

      payments.getUserSubscription.mockResolvedValueOnce(
        subscription({
          currentPeriodEnd: past,
          Plan: { id: "pro", name: "Pro", enableLifetimeAccess: true },
        })
      );
      queues.countQueueTypesForUser.mockClear();
      const lifetime = await handleQueueTypeAction(
        "user-1",
        "create_queue_type",
        brokenForm()
      );
      expect(await readAction(lifetime)).toEqual({
        status: 400,
        error: "Validation failed",
      });
      expect(queues.countQueueTypesForUser).not.toHaveBeenCalled();
      expect(
        entitlements.getEffectivePlanEntitlements
      ).toHaveBeenLastCalledWith("pro");

      payments.getUserSubscription.mockResolvedValueOnce(
        subscription({
          planId: "starter",
          currentPeriodEnd: null,
          Plan: { id: "starter", name: "Starter" },
        })
      );
      queues.countQueueTypesForUser.mockResolvedValue(0);
      await handleQueueTypeAction(
        "user-1",
        "create_queue_type",
        form({
          name: "Main",
          scheduleType: "INTERVAL",
          intervalHours: "2",
        })
      );
      expect(
        entitlements.getEffectivePlanEntitlements
      ).toHaveBeenLastCalledWith("starter");

      payments.getUserSubscription.mockResolvedValueOnce(
        subscription({
          planId: "legacy",
          Plan: {
            id: "legacy",
            name: "Creator Annual",
            enableLifetimeAccess: false,
          },
        })
      );
      await handleQueueTypeAction(
        "user-1",
        "create_queue_type",
        form({
          name: "Main",
          scheduleType: "INTERVAL",
          intervalHours: "2",
        })
      );
      expect(
        entitlements.getEffectivePlanEntitlements
      ).toHaveBeenLastCalledWith("creator");

      payments.getUserSubscription.mockResolvedValueOnce(
        subscription({ Plan: null })
      );
      queues.countQueueTypesForUser.mockClear();
      await handleQueueTypeAction("user-1", "create_queue_type", brokenForm());
      expect(
        entitlements.getEffectivePlanEntitlements
      ).toHaveBeenLastCalledWith("pro");
      expect(queues.countQueueTypesForUser).not.toHaveBeenCalled();
    });

    it("returns validation errors for a broken form and incomplete schedules", async () => {
      const broken = await readAction(
        await handleQueueTypeAction("user-1", "create_queue_type", brokenForm())
      );
      expect(broken).toEqual({ status: 400, error: "Validation failed" });

      const missingName = await readAction(
        await handleQueueTypeAction(
          "user-1",
          "create_queue_type",
          form({ name: " ", scheduleType: "INTERVAL", intervalHours: "2" })
        )
      );
      expect(missingName.status).toBe(400);
      expect(missingName.error).toContain("Name is required");

      const missingInterval = await readAction(
        await handleQueueTypeAction(
          "user-1",
          "create_queue_type",
          form({ name: "Main", scheduleType: "INTERVAL" })
        )
      );
      expect(missingInterval.error).toContain("Interval hours");

      const missingSlots = await readAction(
        await handleQueueTypeAction(
          "user-1",
          "create_queue_type",
          form({ name: "Main", scheduleType: "FIXED_SLOTS" })
        )
      );
      expect(missingSlots.error).toContain("Slots are required");

      const missingWeekly = await readAction(
        await handleQueueTypeAction(
          "user-1",
          "create_queue_type",
          form({ name: "Main", scheduleType: "WEEKLY_SLOTS" })
        )
      );
      expect(missingWeekly.error).toContain("weekly slot");

      const badDay = await readAction(
        await handleQueueTypeAction(
          "user-1",
          "create_queue_type",
          form({
            name: "Main",
            scheduleType: "WEEKLY_SLOTS",
            weeklySlots: JSON.stringify([{ dayOfWeek: 7, time: "09:00" }]),
          })
        )
      );
      expect(badDay.status).toBe(400);
      expect(queues.updateQueueType).not.toHaveBeenCalled();
    });

    it("rejects a hashtag preset the user does not own", async () => {
      queues.hashTagPresetExistsForUser.mockResolvedValue(false);
      const body = await readAction(
        await handleQueueTypeAction(
          "user-1",
          "create_queue_type",
          form({
            name: "Main",
            scheduleType: "INTERVAL",
            intervalHours: "2",
            hashTagPresetId: "preset-x",
          })
        )
      );
      expect(body).toEqual({
        status: 400,
        error: "Selected hashtag preset does not exist",
      });
      expect(queues.hashTagPresetExistsForUser).toHaveBeenCalledWith(
        "user-1",
        "preset-x"
      );
      expect(queues.updateQueueType).not.toHaveBeenCalled();
    });

    it("creates an interval queue with a preset and random window", async () => {
      const result = await handleQueueTypeAction(
        "user-1",
        "create_queue_type",
        form({
          name: " Morning ",
          scheduleType: "INTERVAL",
          intervalHours: "2",
          scheduleRandomWindowMinutes: "5",
          colorToken: "blue",
          description: "Daily",
          hashTagPresetId: "preset-1",
          includeHashtagsInNoteBody: "false",
        })
      );
      expect(result).toEqual({ success: true, queueType: simpleClient() });
      expect(lastWrite()).toEqual({
        name: "Morning",
        scheduleType: "INTERVAL",
        scheduleConfig: {
          intervalHours: 2,
          scheduleRandomWindowMinutes: 5,
        },
        colorToken: "blue",
        description: "Daily",
        hashTagPresetId: "preset-1",
        includeHashtagsInNoteBody: false,
      });
      expect(queues.invalidateQueueTypesCache).toHaveBeenCalledWith("user-1");
    });

    it("creates a global interval without checking a none preset", async () => {
      await handleQueueTypeAction(
        "user-1",
        "create_queue_type",
        form({
          name: "Main",
          scheduleType: "INTERVAL",
          useGlobalInterval: "true",
          hashTagPresetId: "none",
        })
      );
      expect(lastWrite()).toEqual({
        name: "Main",
        scheduleType: "INTERVAL",
        scheduleConfig: { useGlobalInterval: true },
        colorToken: "slate",
        description: undefined,
        hashTagPresetId: null,
        includeHashtagsInNoteBody: true,
      });
      expect(queues.hashTagPresetExistsForUser).not.toHaveBeenCalled();
    });

    it("creates fixed slots and drops blank entries", async () => {
      await handleQueueTypeAction(
        "user-1",
        "create_queue_type",
        form({
          name: "Main",
          scheduleType: "FIXED_SLOTS",
          slots: "09:00, 18:00, , 21:00",
          colorToken: "blue",
          description: "Morning queue",
          hashTagPresetId: "preset-9",
        })
      );
      expect(lastWrite().scheduleConfig).toEqual({
        slots: ["09:00", "18:00", "21:00"],
      });
      expect(queues.hashTagPresetExistsForUser).toHaveBeenCalledWith(
        "user-1",
        "preset-9"
      );
    });

    it("normalizes, dedupes, and sorts weekly slots", async () => {
      await handleQueueTypeAction(
        "user-1",
        "create_queue_type",
        form({
          name: "Main",
          scheduleType: "WEEKLY_SLOTS",
          scheduleRandomWindowMinutes: "15",
          weeklySlots: JSON.stringify([
            { dayOfWeek: 2, time: "10:00" },
            { dayOfWeek: 1, time: "9:30" },
            { dayOfWeek: 2, time: "08:15" },
            { dayOfWeek: 1, time: "09:30" },
            { dayOfWeek: 3, time: "24:00" },
            { dayOfWeek: 4, time: "12:60" },
            { dayOfWeek: 0, time: "0:00" },
          ]),
        })
      );
      expect(lastWrite().scheduleConfig).toEqual({
        weeklySlots: [
          { dayOfWeek: 0, time: "00:00" },
          { dayOfWeek: 1, time: "09:30" },
          { dayOfWeek: 2, time: "08:15" },
          { dayOfWeek: 2, time: "10:00" },
        ],
        scheduleRandomWindowMinutes: 15,
      });
    });

    it("drops weekly slots that fail the clock check", async () => {
      await handleQueueTypeAction(
        "user-1",
        "create_queue_type",
        form({
          name: "Main",
          scheduleType: "WEEKLY_SLOTS",
          weeklySlots: JSON.stringify([{ dayOfWeek: 1, time: "24:00" }]),
        })
      );
      expect(lastWrite().scheduleConfig).toEqual({ weeklySlots: [] });
    });

    it("throws when the saved queue row is missing", async () => {
      queues.updateQueueType.mockResolvedValue(null);
      await expect(
        handleQueueTypeAction(
          "user-1",
          "create_queue_type",
          form({
            name: "Main",
            scheduleType: "INTERVAL",
            intervalHours: "2",
          })
        )
      ).rejects.toThrow("Queue type is required");
    });

    it("propagates subscription lookup failures", async () => {
      payments.getUserSubscription.mockRejectedValueOnce(new Error("db down"));
      await expect(
        handleQueueTypeAction("user-1", "create_queue_type", form())
      ).rejects.toThrow("db down");
      payments.getUserSubscription.mockRejectedValueOnce("db down");
      await expect(
        handleQueueTypeAction("user-1", "create_queue_type", form())
      ).rejects.toBe("db down");
    });
  });

  describe("update_queue_type", () => {
    it("rejects invalid input and a missing preset", async () => {
      const broken = await readAction(
        await handleQueueTypeAction("user-1", "update_queue_type", brokenForm())
      );
      expect(broken).toEqual({ status: 400, error: "Validation failed" });

      const missingColor = await readAction(
        await handleQueueTypeAction(
          "user-1",
          "update_queue_type",
          form({
            id: "q1",
            name: "Main",
            scheduleType: "INTERVAL",
            intervalHours: "2",
          })
        )
      );
      expect(missingColor.status).toBe(400);

      queues.hashTagPresetExistsForUser.mockResolvedValue(false);
      const preset = await readAction(
        await handleQueueTypeAction(
          "user-1",
          "update_queue_type",
          updateForm({ hashTagPresetId: "missing" })
        )
      );
      expect(preset).toEqual({
        status: 400,
        error: "Selected hashtag preset does not exist",
      });
      expect(queues.updateQueueType).not.toHaveBeenCalled();
    });

    it("writes the update and defaults omitted flags", async () => {
      const result = await handleQueueTypeAction(
        "user-1",
        "update_queue_type",
        updateForm()
      );
      expect(result).toEqual({ success: true, queueType: simpleClient() });
      expect(lastWrite()).toEqual({
        id: "q1",
        name: "Main",
        scheduleType: "INTERVAL",
        scheduleConfig: { intervalHours: 2 },
        colorToken: "slate",
        description: undefined,
        isEnabled: false,
        hashTagPresetId: null,
        includeHashtagsInNoteBody: true,
      });
      expect(queues.invalidateQueueTypesCache).toHaveBeenCalledWith("user-1");
    });

    it("maps each stored queue shape into the client payload", async () => {
      const cases: Array<{ row: QueueRow; queueType: ClientQueue }> = [
        {
          row: {
            id: "q-a",
            name: "A",
            colorToken: "blue",
            description: "Notes",
            scheduleType: "INTERVAL",
            scheduleConfig: { intervalHours: 2 },
            status: "PAUSED",
            isEnabled: false,
            userId: "user-1",
            includeHashtagsInNoteBody: true,
            isDefault: true,
            hashTagPresetId: "preset-1",
            hashTagPreset: {
              id: "preset-1",
              name: "Daily",
              tags: "nostr",
              description: "d",
            },
          },
          queueType: {
            id: "q-a",
            name: "A",
            colorToken: "blue",
            color: QUEUE_COLOR_ACCENTS.blue,
            description: "Notes",
            scheduleType: "INTERVAL",
            scheduleConfig: { intervalHours: 2 },
            status: "paused",
            isEnabled: false,
            userId: "user-1",
            isDefault: true,
            hashTagPresetId: "preset-1",
            hashTagPreset: {
              id: "preset-1",
              name: "Daily",
              tags: "nostr",
              description: "d",
            },
            includeHashtagsInNoteBody: true,
          },
        },
        {
          row: {
            id: "q-b",
            name: "B",
            colorToken: null,
            description: null,
            scheduleType: "INTERVAL",
            scheduleConfig: {},
            status: "ARCHIVED",
            isEnabled: true,
            userId: "user-1",
            includeHashtagsInNoteBody: false,
            isDefault: false,
            hashTagPresetId: 4,
            hashTagPreset: { id: 8, name: "Num", tags: 1 },
          },
          queueType: {
            id: "q-b",
            name: "B",
            colorToken: null,
            color: QUEUE_COLOR_ACCENTS.slate,
            description: null,
            scheduleType: "INTERVAL",
            scheduleConfig: {},
            status: "archived",
            isEnabled: true,
            userId: "user-1",
            isDefault: false,
            hashTagPresetId: "8",
            hashTagPreset: {
              id: "8",
              name: "Num",
              tags: "",
              description: null,
            },
            includeHashtagsInNoteBody: false,
          },
        },
        {
          row: {
            id: "q-c",
            name: "C",
            description: null,
            scheduleType: "FIXED_SLOTS",
            scheduleConfig: { slots: ["09:00"] },
            status: "CUSTOM",
            isEnabled: true,
            userId: "user-1",
          },
          queueType: {
            id: "q-c",
            name: "C",
            colorToken: null,
            color: QUEUE_COLOR_ACCENTS.slate,
            description: null,
            scheduleType: "FIXED_SLOTS",
            scheduleConfig: { slots: ["09:00"] },
            status: "active",
            isEnabled: true,
            userId: "user-1",
            isDefault: false,
            hashTagPresetId: null,
            hashTagPreset: null,
            includeHashtagsInNoteBody: true,
          },
        },
        {
          row: {
            id: "q-d",
            name: "D",
            colorToken: "slate",
            description: null,
            scheduleType: "INTERVAL",
            scheduleConfig: {},
            status: "ACTIVE",
            isEnabled: true,
            userId: "user-1",
            hashTagPreset: "raw",
          },
          queueType: {
            id: "q-d",
            name: "D",
            colorToken: "slate",
            color: QUEUE_COLOR_ACCENTS.slate,
            description: null,
            scheduleType: "INTERVAL",
            scheduleConfig: {},
            status: "active",
            isEnabled: true,
            userId: "user-1",
            isDefault: false,
            hashTagPresetId: null,
            hashTagPreset: null,
            includeHashtagsInNoteBody: true,
          },
        },
        {
          row: {
            id: "q-e",
            name: "E",
            colorToken: "slate",
            description: null,
            scheduleType: "INTERVAL",
            scheduleConfig: {},
            status: "ACTIVE",
            isEnabled: true,
            userId: "user-1",
            hashTagPreset: { id: "only-id" },
          },
          queueType: {
            id: "q-e",
            name: "E",
            colorToken: "slate",
            color: QUEUE_COLOR_ACCENTS.slate,
            description: null,
            scheduleType: "INTERVAL",
            scheduleConfig: {},
            status: "active",
            isEnabled: true,
            userId: "user-1",
            isDefault: false,
            hashTagPresetId: "only-id",
            hashTagPreset: null,
            includeHashtagsInNoteBody: true,
          },
        },
        {
          row: {
            id: "q-f",
            name: "F",
            colorToken: "slate",
            description: null,
            scheduleType: "INTERVAL",
            scheduleConfig: {},
            status: "ACTIVE",
            isEnabled: true,
            userId: "user-1",
            hashTagPreset: {
              id: "p",
              name: "N",
              tags: "t",
              description: null,
            },
          },
          queueType: {
            id: "q-f",
            name: "F",
            colorToken: "slate",
            color: QUEUE_COLOR_ACCENTS.slate,
            description: null,
            scheduleType: "INTERVAL",
            scheduleConfig: {},
            status: "active",
            isEnabled: true,
            userId: "user-1",
            isDefault: false,
            hashTagPresetId: "p",
            hashTagPreset: {
              id: "p",
              name: "N",
              tags: "t",
              description: null,
            },
            includeHashtagsInNoteBody: true,
          },
        },
      ];

      for (const example of cases) {
        queues.updateQueueType.mockResolvedValue(example.row);
        const result = await handleQueueTypeAction(
          "user-1",
          "update_queue_type",
          updateForm()
        );
        expect(result).toEqual({ success: true, queueType: example.queueType });
      }
    });
  });

  describe("pause, resume, and enabled toggle", () => {
    it("pauses and resumes by id", async () => {
      const paused = await handleQueueTypeAction(
        "user-1",
        "pause_queue",
        form({ id: "q1" })
      );
      expect(paused).toEqual({
        success: true,
        queueType: simpleClient(),
        pausedPostCount: 2,
        pausedLongFormCount: 4,
      });
      expect(queues.pauseQueueById).toHaveBeenCalledWith({
        userId: "user-1",
        queueTypeId: "q1",
      });

      const resumed = await handleQueueTypeAction(
        "user-1",
        "resume_queue",
        form({ id: "q1" })
      );
      expect(resumed).toEqual({
        success: true,
        queueType: simpleClient(),
        resumedCount: 3,
        needsResignCount: 1,
      });
      expect(queues.resumeQueueById).toHaveBeenCalledWith({
        userId: "user-1",
        queueTypeId: "q1",
      });
      expect(queues.invalidateQueueTypesCache).toHaveBeenCalledTimes(2);
    });

    it("rejects an invalid pause or resume id", async () => {
      const pause = await readAction(
        await handleQueueTypeAction("user-1", "pause_queue", form())
      );
      const resume = await readAction(
        await handleQueueTypeAction("user-1", "resume_queue", brokenForm())
      );
      expect(pause.status).toBe(400);
      expect(resume).toEqual({ status: 400, error: "Validation failed" });
      expect(queues.pauseQueueById).not.toHaveBeenCalled();
      expect(queues.resumeQueueById).not.toHaveBeenCalled();
    });

    it("resumes when enabling and pauses when disabling", async () => {
      const enabled = await handleQueueTypeAction(
        "user-1",
        "toggle_queue_enabled",
        form({ id: "q1", isEnabled: "true" })
      );
      expect(enabled).toEqual({
        success: true,
        queueType: simpleClient(),
        resumedCount: 3,
        needsResignCount: 1,
      });
      expect(queues.resumeQueueById).toHaveBeenCalledWith({
        userId: "user-1",
        queueTypeId: "q1",
      });

      const disabled = await handleQueueTypeAction(
        "user-1",
        "toggle_queue_enabled",
        form({ id: "q1", isEnabled: "false" })
      );
      expect(disabled).toEqual({
        success: true,
        queueType: simpleClient(),
        pausedPostCount: 2,
        pausedLongFormCount: 4,
      });
      expect(queues.pauseQueueById).toHaveBeenCalledWith({
        userId: "user-1",
        queueTypeId: "q1",
      });
    });

    it("returns 404 when the queue is missing and 400 for a bad toggle", async () => {
      queues.getQueueTypeByIdForUser.mockResolvedValue(null);
      const missing = await readAction(
        await handleQueueTypeAction(
          "user-1",
          "toggle_queue_enabled",
          form({ id: "q1", isEnabled: "true" })
        )
      );
      expect(missing).toEqual({ status: 404, error: "Queue type not found" });
      expect(queues.resumeQueueById).not.toHaveBeenCalled();
      expect(queues.invalidateQueueTypesCache).not.toHaveBeenCalled();

      const invalid = await readAction(
        await handleQueueTypeAction("user-1", "toggle_queue_enabled", form())
      );
      expect(invalid.status).toBe(400);
    });
  });

  describe("delete_queue_type", () => {
    it("deletes the queue only", async () => {
      const result = await handleQueueTypeAction(
        "user-1",
        "delete_queue_type",
        form({ id: "q1" })
      );
      expect(result).toEqual({
        success: true,
        deletedId: "q1",
        deleteMode: "queue_only",
      });
      expect(queues.deleteQueueType).toHaveBeenCalledWith("user-1", "q1");
      expect(posts.getScheduledPosts).not.toHaveBeenCalled();
      expect(queues.invalidateQueueTypesCache).toHaveBeenCalledWith("user-1");
    });

    it("returns 404 when the queue to clear is missing", async () => {
      queues.getQueueTypeByIdForUser.mockResolvedValue(null);
      const body = await readAction(
        await handleQueueTypeAction(
          "user-1",
          "delete_queue_type",
          form({ id: "q1", deleteMode: "queue_and_scheduled" })
        )
      );
      expect(body).toEqual({ status: 404, error: "Queue type not found" });
      expect(queues.deleteQueueType).not.toHaveBeenCalled();
      expect(posts.getScheduledPosts).not.toHaveBeenCalled();
    });

    it("pages through scheduled posts and longform notes before deleting", async () => {
      posts.getScheduledPosts
        .mockResolvedValueOnce({ posts: [{ id: "p1" }, { id: "p2" }] })
        .mockResolvedValueOnce({ posts: [{ id: "p3" }] })
        .mockResolvedValue({ posts: [] });
      posts.getScheduledLongFormPosts
        .mockResolvedValueOnce({ posts: [{ id: "l1" }] })
        .mockResolvedValue({ posts: [] });

      const result = await handleQueueTypeAction(
        "user-1",
        "delete_queue_type",
        form({ id: "q1", deleteMode: "queue_and_scheduled" })
      );
      expect(result).toEqual({
        success: true,
        deletedId: "q1",
        deleteMode: "queue_and_scheduled",
      });
      const query = {
        userId: "user-1",
        queueType: "Main",
        page: 1,
        limit: 100,
      };
      expect(posts.getScheduledPosts).toHaveBeenCalledTimes(3);
      expect(posts.getScheduledPosts).toHaveBeenCalledWith(query);
      expect(posts.getScheduledLongFormPosts).toHaveBeenCalledTimes(2);
      expect(posts.getScheduledLongFormPosts).toHaveBeenCalledWith(query);
      expect(posts.deletePost).toHaveBeenCalledWith({
        id: "p1",
        userId: "user-1",
      });
      expect(posts.deletePost).toHaveBeenCalledWith({
        id: "p2",
        userId: "user-1",
      });
      expect(posts.deletePost).toHaveBeenCalledWith({
        id: "p3",
        userId: "user-1",
      });
      expect(posts.deleteLongFormPost).toHaveBeenCalledWith({
        id: "l1",
        userId: "user-1",
      });
    });

    it("stops immediately when both scheduled lists are empty", async () => {
      await handleQueueTypeAction(
        "user-1",
        "delete_queue_type",
        form({ id: "q1", deleteMode: "queue_and_scheduled" })
      );
      expect(posts.getScheduledPosts).toHaveBeenCalledTimes(1);
      expect(posts.getScheduledLongFormPosts).toHaveBeenCalledTimes(1);
      expect(posts.deletePost).not.toHaveBeenCalled();
      expect(posts.deleteLongFormPost).not.toHaveBeenCalled();
      expect(queues.deleteQueueType).toHaveBeenCalledWith("user-1", "q1");
    });

    it("rejects an invalid delete form", async () => {
      const missing = await readAction(
        await handleQueueTypeAction("user-1", "delete_queue_type", form())
      );
      expect(missing.status).toBe(400);
      const mode = await readAction(
        await handleQueueTypeAction(
          "user-1",
          "delete_queue_type",
          form({ id: "q1", deleteMode: "nope" })
        )
      );
      expect(mode.status).toBe(400);
      expect(queues.deleteQueueType).not.toHaveBeenCalled();
    });

    it("propagates a thrown Error or string while clearing scheduled content", async () => {
      posts.getScheduledPosts.mockRejectedValueOnce(new Error("posts down"));
      await expect(
        handleQueueTypeAction(
          "user-1",
          "delete_queue_type",
          form({ id: "q1", deleteMode: "queue_and_scheduled" })
        )
      ).rejects.toThrow("posts down");

      posts.getScheduledPosts.mockResolvedValue({ posts: [] });
      posts.getScheduledLongFormPosts.mockRejectedValueOnce("notes down");
      await expect(
        handleQueueTypeAction(
          "user-1",
          "delete_queue_type",
          form({ id: "q1", deleteMode: "queue_and_scheduled" })
        )
      ).rejects.toBe("notes down");
    });
  });
});
