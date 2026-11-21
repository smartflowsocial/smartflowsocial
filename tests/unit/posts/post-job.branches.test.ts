// @ts-nocheck -- mocked collaborators are narrower than the production types.
import type { Job } from "bullmq";
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

interface JobStubData {
  postId: string;
  userId: string;
  correlationId?: string;
  signedEvent?: unknown;
}

interface JobStub {
  id: string | null;
  attemptsMade: number;
  data: JobStubData;
}

interface JobInput {
  id?: string | null;
  attemptsMade?: number;
  postId?: string;
  userId?: string;
  correlationId?: string;
  signedEvent?: unknown;
  omitSignedEvent?: boolean;
  omitCorrelation?: boolean;
}

interface ScheduledRow {
  scheduledAtUtc: Date | null;
  currentState: string | null;
  queueHoldStatus: string | null;
  queueType: {
    name?: string | null;
    status?: string | null;
    isEnabled?: boolean | null;
  } | null;
}

interface CheckerRow {
  currentState: string | null;
  queueHoldStatus: string | null;
  queueType: { status?: string | null; isEnabled?: boolean | null } | null;
}

interface MetaRow {
  postKind: string | null;
  repostOfPostId: string | null;
  repostConditions: unknown;
  dependencyMode: string | null;
  signingState: string | null;
  parentScheduledActionId: string | null;
  expectedParentEventId: string | null;
  currentState: string | null;
}

interface ParentRow {
  currentState: string | null;
  nostrEventId: string | null;
  signedEvent: unknown;
}

interface SourceRow {
  nostrEventId: string | null;
  signedEvent: unknown;
}

interface MetricsRow {
  postType: string | null;
  postKind: string | null;
  queueType: { name?: string | null } | null;
}

interface StateRow {
  currentState: string | null;
}

interface AttemptRow {
  publishAttemptId: string | null;
}

interface DbState {
  scheduledMisses: number;
  scheduled: ScheduledRow | null;
  checker: CheckerRow | null;
  meta: MetaRow | null;
  parentRow: ParentRow | null;
  sourceRow: SourceRow | null;
  signedRow: { signedEvent: unknown } | null;
  metricsRow: MetricsRow | null;
  attemptRow: AttemptRow | null;
  stateQueue: Array<StateRow | null>;
  stateRow: StateRow | null;
}

interface InfoContext {
  postId?: string;
  userId?: string;
  correlationId?: string;
  jobId?: string;
  attemptsMade?: number;
  queueStatus?: string | null;
  queueHoldStatus?: string | null;
  reason?: string;
  parentEventId?: string | null;
  parentState?: string | null;
  attempt?: number;
  delayMs?: number;
  sourceEventId?: string;
}

interface ErrorContext {
  message?: string;
  postId?: string;
  willRetry?: boolean;
  attemptsMade?: number;
}

interface TransitionOptions {
  additionalPostData?: {
    publishingLockId?: null;
    publishingLockExpiresAt?: null;
    nostrEventId?: string;
    publishAttemptId?: string;
    publishedAt?: Date;
  };
}

interface PublishArgs {
  queueName: string;
  attributes: {
    queue: string;
    postId: string;
    userId: string;
    correlationId?: string;
    relayCount: number;
    attempt: number;
  };
  event: { id: string };
  relays: string[];
  correlationId?: string;
}

interface CaptureContext {
  tags: { queue: string; job: string };
  extra: {
    postId: string;
    userId: string;
    correlationId?: string;
    jobId: string;
    attempt: number;
    attemptsMade: number;
    willRetry: boolean;
    errorType: string;
  };
  level: string;
}

interface JobResult {
  success: true;
  postId: string;
  skipped?: boolean;
}

interface ImportedModule {
  [key: string]: unknown;
}

const {
  mockFindPostUnique,
  mockDelayMs,
  mockEnqueuePostJob,
  mockAcquireLease,
  mockReleaseLease,
  mockTransition,
  mockRecordJobMetrics,
  mockRecordJobSkipped,
  mockRecordJobRetry,
  mockLogInfo,
  mockLogError,
  mockValidateCrypto,
  mockGetRelays,
  mockPublish,
  mockGetStats,
  mockCountReactions,
  mockPersistAcks,
  mockDeadLetter,
  mockCapture,
  mockBreadcrumb,
  mockRecordPublished,
  mockRecordFailed,
  mockRecordLatency,
  mockRecordLateness,
  mockDiscard,
  mockWillRetry,
  mockActivateContest,
  mockSendSuccess,
  mockSendFailure,
} = vi.hoisted(() => ({
  mockFindPostUnique:
    vi.fn<
      (
        where: { id: string; userId?: string },
        args: { select: Record<string, unknown> }
      ) => Promise<unknown>
    >(),
  mockDelayMs: vi.fn<(ms: number) => Promise<void>>(),
  mockEnqueuePostJob:
    vi.fn<
      (
        postId: string,
        userId: string,
        event: unknown,
        when: number
      ) => Promise<void>
    >(),
  mockAcquireLease: vi.fn<
    (input: { postId: string; userId: string }) => Promise<{
      lockId: string;
      expiresAt: Date;
    } | null>
  >(),
  mockReleaseLease:
    vi.fn<
      (input: {
        postId: string;
        userId: string;
        lockId: string;
      }) => Promise<void>
    >(),
  mockTransition:
    vi.fn<
      (
        postId: string,
        userId: string,
        target: string,
        reason: string,
        options?: TransitionOptions
      ) => Promise<void>
    >(),
  mockRecordJobMetrics:
    vi.fn<
      (queueName: string, duration: number, ok: boolean, error?: Error) => void
    >(),
  mockRecordJobSkipped: vi.fn<(queueName: string, reason: string) => void>(),
  mockRecordJobRetry: vi.fn<(queueName: string) => void>(),
  mockLogInfo: vi.fn<(message: string, context?: InfoContext) => void>(),
  mockLogError: vi.fn<(error: Error, context?: ErrorContext) => void>(),
  mockValidateCrypto: vi.fn<(event: unknown) => unknown>(),
  mockGetRelays: vi.fn<(userId: string) => Promise<string[]>>(),
  mockPublish: vi.fn<(input: PublishArgs) => Promise<unknown>>(),
  mockGetStats: vi.fn<(ids: string[]) => Promise<Record<string, unknown>>>(),
  mockCountReactions:
    vi.fn<
      (
        eventId: string,
        relays: string[],
        atLeast: number
      ) => Promise<number | null>
    >(),
  mockPersistAcks: vi.fn<(input: unknown) => Promise<void>>(),
  mockDeadLetter:
    vi.fn<
      (
        queueName: string,
        jobId: string,
        jobName: string,
        data: unknown,
        error: Error,
        attempts: number,
        correlationId?: string
      ) => Promise<void>
    >(),
  mockCapture: vi.fn<(error: Error, context: CaptureContext) => void>(),
  mockBreadcrumb: vi.fn<(crumb: { message: string }) => void>(),
  mockRecordPublished:
    vi.fn<(postType: string | null, source: string) => void>(),
  mockRecordFailed:
    vi.fn<
      (postType: string | null, source: string, errorType: string) => void
    >(),
  mockRecordLatency:
    vi.fn<
      (postType: string | null, source: string, latencyMs: number) => void
    >(),
  mockRecordLateness:
    vi.fn<(postType: string | null, latenessSeconds: number) => void>(),
  mockDiscard:
    vi.fn<
      (input: {
        postId: string;
        userId: string;
        reason: string;
        cancelJob: boolean;
      }) => Promise<boolean>
    >(),
  mockWillRetry:
    vi.fn<
      (input: {
        queueName: string;
        attemptsMade: number;
        error: Error;
      }) => boolean
    >(),
  mockActivateContest:
    vi.fn<
      (input: {
        postId: string;
        userId: string;
        publishedEventId: string;
      }) => Promise<void>
    >(),
  mockSendSuccess: vi.fn<
    (
      userId: string,
      postId: string,
      attemptId: string,
      meta: {
        isLongForm: boolean;
        source: string;
        postKind: string | null | undefined;
        queueName: string | null;
      }
    ) => Promise<void>
  >(),
  mockSendFailure:
    vi.fn<
      (
        userId: string,
        postId: string,
        attemptId: string,
        message: string
      ) => Promise<void>
    >(),
}));

vi.mock("~/features/posts/repositories/post-queries-data.server", () => ({
  findPostUnique: mockFindPostUnique,
}));

vi.mock("~/features/posts/queue-payload.server", async () => {
  const actual = await vi.importActual<ImportedModule>(
    "~/features/posts/queue-payload.server"
  );
  return {
    ...actual,
    delayMs: mockDelayMs,
  };
});

vi.mock("~/features/posts/queue-handlers/shared.server", () => ({
  QUEUE_SCHEDULED_POSTS: "scheduled-posts",
  getSanitizedUserRelays: mockGetRelays,
  publishWithQueueSpan: mockPublish,
  computeWillRetry: mockWillRetry,
}));

vi.mock("~/features/posts/state-machine/post-state-machine.server", () => ({
  PostStateMachine: class {
    transition = mockTransition;
  },
}));

vi.mock("~/features/posts/note-reactions.server", () => ({
  countNoteReactionsOnRelays: mockCountReactions,
}));

vi.mock("~/features/posts/stats.server", () => ({
  getPostStats: mockGetStats,
}));

vi.mock(
  "~/features/posts/scheduling/services/attached-followups.server",
  () => ({
    discardScheduledPost: mockDiscard,
  })
);

vi.mock("~/features/relays/publish-relay-acks.server", () => ({
  persistPublishRelayAcks: mockPersistAcks,
}));

vi.mock("~/infra/publishing/publish-lease.server", () => ({
  acquirePostPublishLease: mockAcquireLease,
  releasePostPublishLease: mockReleaseLease,
}));

vi.mock("~/infra/queue/dead-letter-queue.server", () => ({
  createDeadLetterEntry: mockDeadLetter,
}));

vi.mock("~/infra/queue", () => ({
  enqueuePostJob: mockEnqueuePostJob,
}));

vi.mock("~/infra/notifications/push-notification.server", () => ({
  sendPublishFailureNotification: mockSendFailure,
  sendPublishSuccessNotification: mockSendSuccess,
}));

vi.mock("~/features/contest", () => ({
  maybeActivateContestAfterSourcePostPublish: mockActivateContest,
}));

vi.mock("~/lib/error-logger.server", () => ({
  logInfo: mockLogInfo,
  logError: mockLogError,
}));

vi.mock("~/lib/queue-metrics.server", () => ({
  recordJobMetrics: mockRecordJobMetrics,
  recordJobSkipped: mockRecordJobSkipped,
  recordJobRetry: mockRecordJobRetry,
}));

vi.mock("~/lib/metrics/business-metrics.server", () => ({
  recordPostPublished: mockRecordPublished,
  recordPostPublishFailed: mockRecordFailed,
}));

vi.mock("~/lib/metrics/performance-metrics.server", () => ({
  recordPublishLatency: mockRecordLatency,
  recordPublishLateness: mockRecordLateness,
}));

vi.mock("~/lib/sentry.server", () => ({
  addBreadcrumb: mockBreadcrumb,
  captureException: mockCapture,
}));

vi.mock("~/lib/validation/nostr-cryptographic.server", () => ({
  validateSignedEventCryptographically: mockValidateCrypto,
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: {
    post: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("~/lib/redis-cache.server", () => ({
  buildCacheKey: vi.fn(),
  getOrSetJson: vi.fn(),
}));

import {
  setupFetchMock,
  TEST_POST_ID,
  TEST_USER_ID,
} from "../../utils/mock-helpers";

import {
  handleScheduledPostJobError,
  processPost,
  runScheduledPostJob,
} from "~/features/posts/queue-handlers/post-job.server";
import { computeScheduledForUnix } from "~/features/posts/queue-payload.server";
import { relaysForReactionCount } from "~/features/posts/repost-conditions";
import type { PublishLease } from "~/infra/publishing/publish-lease.server";
import type { PostJobData } from "~/infra/queue";
import { generatePublishAttemptId } from "~/lib/idempotency.server";

const QUEUE = "scheduled-posts";
const FUTURE = new Date("2030-01-01T00:00:00.000Z");
const PAST = new Date("2020-01-01T00:00:00.000Z");
const LEASE: PublishLease = {
  lockId: "lease-1",
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
};

function signedStub(overrides: Partial<SignedStub> = {}): SignedStub {
  return {
    id: "event-1",
    pubkey: "pk",
    created_at: 1_700_000_000,
    kind: 1,
    tags: [],
    content: "hello",
    sig: "sig",
    ...overrides,
  };
}

function scheduledRow(overrides: Partial<ScheduledRow> = {}): ScheduledRow {
  return {
    scheduledAtUtc: FUTURE,
    currentState: "SCHEDULED",
    queueHoldStatus: "NONE",
    queueType: { name: "Main", status: "ACTIVE", isEnabled: true },
    ...overrides,
  };
}

function attachedMeta(overrides: Partial<MetaRow> = {}): MetaRow {
  return {
    postKind: "QUOTE",
    repostOfPostId: null,
    repostConditions: null,
    dependencyMode: "attached",
    signingState: "signed",
    parentScheduledActionId: "parent-1",
    expectedParentEventId: "parent-event",
    currentState: "SCHEDULED",
    ...overrides,
  };
}

function createDb(): DbState {
  return {
    scheduledMisses: 0,
    scheduled: scheduledRow(),
    checker: null,
    meta: null,
    parentRow: null,
    sourceRow: null,
    signedRow: null,
    metricsRow: {
      postType: "TEXT",
      postKind: "POST",
      queueType: { name: "Main" },
    },
    attemptRow: { publishAttemptId: "attempt-db" },
    stateQueue: [],
    stateRow: { currentState: "PUBLISHING" },
  };
}

let db = createDb();

function installFindRouter(): void {
  mockFindPostUnique.mockImplementation(
    async (
      _where: { id: string; userId?: string },
      args: { select: Record<string, unknown> }
    ): Promise<unknown> => {
      const select = args.select;
      if ("scheduledAtUtc" in select) {
        if (db.scheduledMisses > 0) {
          db.scheduledMisses -= 1;
          return null;
        }
        return db.scheduled;
      }
      if ("repostConditions" in select) return db.meta;
      if ("publishAttemptId" in select) return db.attemptRow;
      if ("postType" in select) return db.metricsRow;
      if ("nostrEventId" in select && "currentState" in select) {
        return db.parentRow;
      }
      if ("nostrEventId" in select) return db.sourceRow;
      if ("queueHoldStatus" in select) return db.checker;
      if ("signedEvent" in select) return db.signedRow;
      if ("currentState" in select) {
        if (db.stateQueue.length > 0) return db.stateQueue.shift();
        return db.stateRow;
      }
      return null;
    }
  );
}

function asPostJob(job: JobStub): Job<PostJobData> {
  return job as Job<PostJobData>;
}

function buildJob(input: JobInput = {}): Job<PostJobData> {
  const data: JobStubData = {
    postId: input.postId ?? TEST_POST_ID,
    userId: input.userId ?? TEST_USER_ID,
  };
  if (!input.omitCorrelation) {
    data.correlationId = input.correlationId ?? "corr-1";
  }
  if (!input.omitSignedEvent) {
    data.signedEvent =
      "signedEvent" in input ? input.signedEvent : signedStub();
  }
  return asPostJob({
    id: input.id === undefined ? "job-1" : input.id,
    attemptsMade: input.attemptsMade ?? 0,
    data,
  });
}

async function run(input: JobInput = {}): Promise<{
  result: JobResult;
  ctx: { lease: PublishLease | null };
}> {
  const ctx: { lease: PublishLease | null } = { lease: null };
  const result = await runScheduledPostJob({
    job: buildJob(input),
    startTime: 1_700_000_000_000,
    ctx,
  });
  return { result, ctx };
}

function infoLogs(message: string): InfoContext[] {
  const contexts: InfoContext[] = [];
  for (const call of mockLogInfo.mock.calls) {
    if (call[0] === message && call[1]) contexts.push(call[1]);
  }
  return contexts;
}

function errorLog(message: string): Error | undefined {
  for (const call of mockLogError.mock.calls) {
    if (call[1]?.message === message) return call[0];
  }
  return undefined;
}

describe("post job branches", () => {
  beforeEach(() => {
    db = createDb();
    vi.clearAllMocks();
    setupFetchMock();
    installFindRouter();
    mockDelayMs.mockResolvedValue(undefined);
    mockEnqueuePostJob.mockResolvedValue(undefined);
    mockAcquireLease.mockResolvedValue(LEASE);
    mockReleaseLease.mockResolvedValue(undefined);
    mockTransition.mockResolvedValue(undefined);
    mockDiscard.mockResolvedValue(true);
    mockWillRetry.mockReturnValue(false);
    mockValidateCrypto.mockImplementation((event: unknown) => event);
    mockGetRelays.mockResolvedValue(["wss://relay.example"]);
    mockPublish.mockResolvedValue({
      publishLatencyMs: 15,
      publishResult: {
        results: [{ relay: "wss://relay.example", ok: true }],
      },
    });
    mockPersistAcks.mockResolvedValue(undefined);
    mockGetStats.mockImplementation(async (ids: string[]) => {
      const stats: Record<string, unknown> = {};
      for (const id of ids) {
        stats[id] = {
          likes: 5,
          zaps: 5,
          replies: 5,
          reposts: 5,
          satszapped: 5,
        };
      }
      return stats;
    });
    mockCountReactions.mockResolvedValue(5);
    mockDeadLetter.mockResolvedValue(undefined);
    mockActivateContest.mockResolvedValue(undefined);
    mockSendSuccess.mockResolvedValue(undefined);
    mockSendFailure.mockResolvedValue(undefined);
  });

  describe("processPost", () => {
    it("returns false when the post row is missing", async () => {
      const enqueued = await processPost(
        {
          id: TEST_POST_ID,
          userId: TEST_USER_ID,
          signedEvent: signedStub(),
          scheduledFor: "100",
        },
        100
      );

      expect(enqueued).toBe(false);
      expect(mockEnqueuePostJob).not.toHaveBeenCalled();
    });

    it("returns false unless the row is scheduled, free, and the queue is active", async () => {
      const cases: CheckerRow[] = [
        {
          currentState: "PUBLISHED",
          queueHoldStatus: "NONE",
          queueType: { status: "ACTIVE", isEnabled: true },
        },
        {
          currentState: "SCHEDULED",
          queueHoldStatus: "HELD_BY_QUEUE",
          queueType: { status: "ACTIVE", isEnabled: true },
        },
        {
          currentState: "SCHEDULED",
          queueHoldStatus: "NONE",
          queueType: { status: "PAUSED", isEnabled: true },
        },
      ];

      for (const checker of cases) {
        db.checker = checker;
        const enqueued = await processPost(
          {
            id: TEST_POST_ID,
            userId: TEST_USER_ID,
            signedEvent: signedStub(),
            scheduledFor: "100",
          },
          99
        );
        expect(enqueued).toBe(false);
      }
      expect(mockEnqueuePostJob).not.toHaveBeenCalled();
    });

    it("returns false when the signed event or schedule time is unusable", async () => {
      db.checker = {
        currentState: "SCHEDULED",
        queueHoldStatus: null,
        queueType: null,
      };
      const missingEvent = await processPost(
        {
          id: TEST_POST_ID,
          userId: TEST_USER_ID,
          signedEvent: { id: "only-id" },
          scheduledFor: "100",
        },
        100
      );
      const badTime = await processPost(
        {
          id: TEST_POST_ID,
          userId: TEST_USER_ID,
          signedEvent: signedStub(),
          scheduledFor: "abc",
        },
        100
      );

      expect(missingEvent).toBe(false);
      expect(badTime).toBe(false);
      expect(mockEnqueuePostJob).not.toHaveBeenCalled();
    });

    it("enqueues a due post with zero delay or the original timestamp", async () => {
      db.checker = {
        currentState: "SCHEDULED",
        queueHoldStatus: "NONE",
        queueType: { status: "ACTIVE", isEnabled: true },
      };
      const event = signedStub();
      const overdue = await processPost(
        {
          id: TEST_POST_ID,
          userId: TEST_USER_ID,
          signedEvent: event,
          scheduledFor: "100",
        },
        101
      );
      const exact = await processPost(
        {
          id: TEST_POST_ID,
          userId: TEST_USER_ID,
          signedEvent: event,
          scheduledFor: "100",
        },
        100
      );
      const withinSecond = await processPost(
        {
          id: TEST_POST_ID,
          userId: TEST_USER_ID,
          signedEvent: event,
          scheduledFor: "100",
        },
        99
      );
      const later = await processPost(
        {
          id: TEST_POST_ID,
          userId: TEST_USER_ID,
          signedEvent: event,
          scheduledFor: "1000",
        },
        0
      );

      expect(overdue).toBe(true);
      expect(exact).toBe(true);
      expect(withinSecond).toBe(true);
      expect(later).toBe(false);
      expect(mockEnqueuePostJob).toHaveBeenNthCalledWith(
        1,
        TEST_POST_ID,
        TEST_USER_ID,
        event,
        0
      );
      expect(mockEnqueuePostJob).toHaveBeenNthCalledWith(
        2,
        TEST_POST_ID,
        TEST_USER_ID,
        event,
        0
      );
      expect(mockEnqueuePostJob).toHaveBeenNthCalledWith(
        3,
        TEST_POST_ID,
        TEST_USER_ID,
        event,
        100
      );
      expect(mockEnqueuePostJob).toHaveBeenCalledTimes(3);
    });
  });

  describe("runScheduledPostJob guards", () => {
    it("skips when the post is still missing after lookup retries", async () => {
      db.scheduled = null;
      const { result } = await run({ id: null, attemptsMade: 2 });

      expect(result).toEqual({
        success: true,
        postId: TEST_POST_ID,
        skipped: true,
      });
      expect(mockDelayMs).toHaveBeenNthCalledWith(1, 1000);
      expect(mockDelayMs).toHaveBeenNthCalledWith(2, 2000);
      expect(mockRecordJobSkipped).toHaveBeenCalledWith(
        QUEUE,
        "post_not_found"
      );
      expect(mockAcquireLease).not.toHaveBeenCalled();
      const retryLogs = infoLogs(
        "Post not found on first lookup, retrying after delay (possible replica lag)"
      );
      expect(retryLogs[0]?.delayMs).toBe(1000);
      expect(retryLogs[0]?.attempt).toBe(2);
      expect(retryLogs[1]?.delayMs).toBe(2000);
      expect(retryLogs[1]?.attempt).toBe(3);
      expect(
        infoLogs("Scheduled post not found when processing job, skipping")[0]
          ?.jobId
      ).toBe("unknown");
      expect(
        infoLogs("Scheduled post not found when processing job, skipping")[0]
          ?.attemptsMade
      ).toBe(3);
    });

    it("finds the post on the third lookup and skips an already published row", async () => {
      db.scheduledMisses = 2;
      db.scheduled = scheduledRow({ currentState: "PUBLISHED" });

      const { result } = await run();

      expect(result).toEqual({
        success: true,
        postId: TEST_POST_ID,
        skipped: true,
      });
      expect(mockDelayMs).toHaveBeenNthCalledWith(1, 1000);
      expect(mockDelayMs).toHaveBeenNthCalledWith(2, 2000);
      expect(mockRecordJobSkipped).toHaveBeenCalledWith(
        QUEUE,
        "already_published"
      );
      expect(mockAcquireLease).not.toHaveBeenCalled();
    });

    it("skips a held row before a paused queue and records the hold", async () => {
      db.scheduled = scheduledRow({
        queueHoldStatus: "NEEDS_RESIGN_AFTER_QUEUE_RESUME",
        queueType: null,
      });

      const { result } = await run();

      expect(result.skipped).toBe(true);
      expect(mockRecordJobSkipped).toHaveBeenCalledWith(QUEUE, "queue_held");
      const held = infoLogs(
        "Skipping scheduled post because queue is paused or held"
      )[0];
      expect(held?.queueStatus).toBeNull();
      expect(held?.queueHoldStatus).toBe("NEEDS_RESIGN_AFTER_QUEUE_RESUME");
      expect(mockAcquireLease).not.toHaveBeenCalled();
    });

    it("skips a paused queue when the row is not held", async () => {
      db.scheduled = scheduledRow({
        queueHoldStatus: "NONE",
        queueType: { status: "PAUSED", isEnabled: true, name: "Main" },
      });

      const { result } = await run();

      expect(result.skipped).toBe(true);
      expect(mockRecordJobSkipped).toHaveBeenCalledWith(QUEUE, "queue_paused");
      expect(
        infoLogs("Skipping scheduled post because queue is paused or held")[0]
          ?.queueStatus
      ).toBe("PAUSED");
    });

    it("skips when another worker holds the publish lease", async () => {
      mockAcquireLease.mockResolvedValue(null);

      const { result, ctx } = await run();

      expect(result.skipped).toBe(true);
      expect(ctx.lease).toBeNull();
      expect(mockAcquireLease).toHaveBeenCalledWith({
        postId: TEST_POST_ID,
        userId: TEST_USER_ID,
      });
      expect(mockRecordJobSkipped).toHaveBeenCalledWith(
        QUEUE,
        "publish_lease_held"
      );
      expect(mockReleaseLease).not.toHaveBeenCalled();
    });
  });

  describe("attached parent guards", () => {
    it("discards an attached child that is no longer signed, and skips discard when it is not scheduled", async () => {
      db.meta = attachedMeta({ signingState: "stale" });
      const unsigned = await run();

      expect(unsigned.result.skipped).toBe(true);
      expect(unsigned.ctx.lease).toBeNull();
      expect(mockReleaseLease).toHaveBeenCalledWith({
        postId: TEST_POST_ID,
        userId: TEST_USER_ID,
        lockId: "lease-1",
      });
      expect(mockDiscard).toHaveBeenCalledWith({
        postId: TEST_POST_ID,
        userId: TEST_USER_ID,
        reason:
          "Follow-up discarded: Attached child signing state is not signed",
        cancelJob: false,
      });
      expect(mockRecordJobSkipped).toHaveBeenCalledWith(
        QUEUE,
        "attached_dependency_invalid"
      );

      mockDiscard.mockClear();
      mockRecordJobSkipped.mockClear();
      db.meta = attachedMeta({
        currentState: "CANCELLED",
        signingState: "signed",
      });
      const unscheduled = await run();

      expect(unscheduled.result.skipped).toBe(true);
      expect(mockDiscard).not.toHaveBeenCalled();
      const guardLogs = infoLogs(
        "Skipping attached child publish due to dependency guard"
      );
      expect(guardLogs[guardLogs.length - 1]?.reason).toBe(
        "Attached child is no longer scheduled"
      );
    });

    it("publishes when the dependency is not an attached child", async () => {
      db.meta = attachedMeta({
        dependencyMode: "standalone",
        parentScheduledActionId: "parent-1",
      });
      const standalone = await run();
      db.meta = attachedMeta({ parentScheduledActionId: "" });
      const missingParent = await run();

      expect(standalone.result).toEqual({
        success: true,
        postId: TEST_POST_ID,
      });
      expect(missingParent.result).toEqual({
        success: true,
        postId: TEST_POST_ID,
      });
      expect(mockDiscard).not.toHaveBeenCalled();
      expect(mockPublish).toHaveBeenCalledTimes(2);
    });

    it("reads parent event ids and discards terminal parents", async () => {
      const shapes: Array<{ value: unknown; eventId: string | null }> = [
        { value: null, eventId: null },
        { value: undefined, eventId: null },
        { value: 0, eventId: null },
        { value: "", eventId: null },
        { value: "str", eventId: null },
        { value: 5, eventId: null },
        { value: [], eventId: null },
        { value: { pubkey: "p" }, eventId: null },
        { value: { id: 12 }, eventId: null },
        { value: { id: "" }, eventId: null },
        { value: { id: "abc" }, eventId: "abc" },
      ];

      for (const shape of shapes) {
        db.meta = attachedMeta();
        db.parentRow = {
          currentState: "CANCELLED",
          nostrEventId: null,
          signedEvent: shape.value,
        };
        await run();
        const logs = infoLogs(
          "Skipping attached child publish due to parent guard"
        );
        expect(logs[logs.length - 1]?.parentEventId).toBe(shape.eventId);
      }

      expect(mockEnqueuePostJob).not.toHaveBeenCalled();
      expect(mockRecordJobSkipped).toHaveBeenCalledWith(
        QUEUE,
        "attached_parent_failed"
      );
      expect(mockDiscard).toHaveBeenCalledWith({
        postId: TEST_POST_ID,
        userId: TEST_USER_ID,
        reason: "Parent post did not publish; follow-up discarded",
        cancelJob: false,
      });
    });

    it("discards when the parent failed, was drafted, mismatched, or timed out", async () => {
      for (const parentState of ["FAILED", "DRAFT"]) {
        mockDiscard.mockClear();
        mockRecordJobSkipped.mockClear();
        db.meta = attachedMeta();
        db.parentRow = {
          currentState: parentState,
          nostrEventId: null,
          signedEvent: null,
        };
        const failed = await run();
        expect(failed.result.skipped).toBe(true);
        expect(mockRecordJobSkipped).toHaveBeenCalledWith(
          QUEUE,
          "attached_parent_failed"
        );
      }

      mockDiscard.mockClear();
      mockRecordJobSkipped.mockClear();
      db.scheduled = scheduledRow({ scheduledAtUtc: PAST });
      db.meta = attachedMeta();
      db.parentRow = {
        currentState: "PUBLISHING",
        nostrEventId: null,
        signedEvent: null,
      };
      const timedOut = await run();
      expect(timedOut.result.skipped).toBe(true);
      expect(mockRecordJobSkipped).toHaveBeenCalledWith(
        QUEUE,
        "attached_parent_timeout"
      );

      mockDiscard.mockClear();
      mockRecordJobSkipped.mockClear();
      db.scheduled = scheduledRow({ scheduledAtUtc: FUTURE });
      db.parentRow = {
        currentState: "PUBLISHED",
        nostrEventId: "other-event",
        signedEvent: { id: "ignored" },
      };
      const mismatched = await run();
      expect(mismatched.result.skipped).toBe(true);
      expect(mockDiscard).toHaveBeenCalledWith({
        postId: TEST_POST_ID,
        userId: TEST_USER_ID,
        reason: "Follow-up discarded: parent signing changed",
        cancelJob: false,
      });
      expect(mockRecordJobSkipped).toHaveBeenCalledWith(
        QUEUE,
        "attached_parent_event_mismatch"
      );
    });

    it("defers while the parent is unpublished and a signed event can be resolved", async () => {
      db.meta = attachedMeta();
      db.parentRow = {
        currentState: "SCHEDULED",
        nostrEventId: null,
        signedEvent: null,
      };
      db.signedRow = { signedEvent: signedStub({ id: "from-db" }) };

      const fromJob = await run({
        signedEvent: signedStub({ id: "from-job" }),
      });
      expect(fromJob.result.skipped).toBe(true);
      expect(mockEnqueuePostJob).toHaveBeenCalledTimes(1);
      const fromJobEvent = mockEnqueuePostJob.mock.calls[0]?.[2] as {
        id?: string;
      };
      expect(fromJobEvent.id).toBe("from-job");
      const deferredFor = mockEnqueuePostJob.mock.calls[0]?.[3] ?? 0;
      expect(deferredFor).toBeGreaterThan(Math.floor(Date.now() / 1000) + 50);

      mockEnqueuePostJob.mockClear();
      await run({ signedEvent: ["not-an-event"] });
      const fromDbEvent = mockEnqueuePostJob.mock.calls[0]?.[2] as {
        id?: string;
      };
      expect(fromDbEvent.id).toBe("from-db");
      expect(mockRecordJobSkipped).toHaveBeenCalledWith(
        QUEUE,
        "attached_parent_not_ready"
      );

      const unresolved: Array<JobInput & { dbEvent: unknown; row: boolean }> = [
        { signedEvent: null, dbEvent: null, row: true },
        { signedEvent: "x", dbEvent: [], row: true },
        { signedEvent: 4, dbEvent: "nope", row: true },
        { omitSignedEvent: true, dbEvent: 9, row: true },
        { omitSignedEvent: true, dbEvent: null, row: false },
      ];
      for (const item of unresolved) {
        mockEnqueuePostJob.mockClear();
        db.signedRow = item.row ? { signedEvent: item.dbEvent } : null;
        await run(item);
        expect(mockEnqueuePostJob).not.toHaveBeenCalled();
      }
    });

    it("continues when the published parent event matches, including empty ids", async () => {
      db.meta = attachedMeta();
      db.parentRow = {
        currentState: "PUBLISHED",
        nostrEventId: "parent-event",
        signedEvent: { id: "other" },
      };
      const matched = await run();

      db.meta = attachedMeta({ expectedParentEventId: null });
      db.parentRow = {
        currentState: "PUBLISHED",
        nostrEventId: "anything",
        signedEvent: null,
      };
      const missingExpectation = await run();

      db.meta = attachedMeta({ expectedParentEventId: "" });
      db.parentRow = {
        currentState: "PUBLISHED",
        nostrEventId: "",
        signedEvent: null,
      };
      const emptyIds = await run();

      expect(matched.result.skipped).toBeUndefined();
      expect(missingExpectation.result.skipped).toBeUndefined();
      expect(emptyIds.result.skipped).toBeUndefined();
      expect(mockDiscard).not.toHaveBeenCalled();
      expect(mockPublish).toHaveBeenCalledTimes(3);
    });
  });

  describe("repost conditions", () => {
    function repostMeta(
      conditions: unknown,
      repostOfPostId = "orig-1"
    ): MetaRow {
      return {
        postKind: "REPOST",
        repostOfPostId,
        repostConditions: conditions,
        dependencyMode: null,
        signingState: null,
        parentScheduledActionId: null,
        expectedParentEventId: null,
        currentState: "SCHEDULED",
      };
    }

    it("publishes when conditions are absent, empty, or not an object", async () => {
      db.meta = repostMeta(null);
      await run();
      db.meta = repostMeta({});
      await run();
      db.meta = repostMeta("nope");
      await run();
      db.meta = repostMeta({ minReactions: 1 }, "");
      await run();

      expect(mockGetStats).not.toHaveBeenCalled();
      expect(mockPublish).toHaveBeenCalledTimes(4);
      expect(mockDiscard).not.toHaveBeenCalled();
    });

    it("skips a repost when the source event id cannot be read", async () => {
      const sources: Array<SourceRow | null> = [
        null,
        { nostrEventId: null, signedEvent: null },
        { nostrEventId: null, signedEvent: [] },
        { nostrEventId: null, signedEvent: "x" },
        { nostrEventId: null, signedEvent: { id: 4 } },
        { nostrEventId: null, signedEvent: { id: "" } },
        { nostrEventId: null, signedEvent: { pubkey: "p" } },
      ];

      for (const source of sources) {
        mockGetStats.mockClear();
        mockDiscard.mockClear();
        db.meta = repostMeta({ minReactions: 1 });
        db.sourceRow = source;
        const { result } = await run();
        expect(result.skipped).toBe(true);
        expect(mockGetStats).not.toHaveBeenCalled();
        expect(mockDiscard).toHaveBeenCalledWith({
          postId: TEST_POST_ID,
          userId: TEST_USER_ID,
          reason: "Repost skipped: could not verify engagement conditions",
          cancelJob: false,
        });
        expect(mockRecordJobSkipped).toHaveBeenCalledWith(
          QUEUE,
          "repost_conditions_unverifiable"
        );
      }
    });

    it("counts reactions from the nostr id or a signed-event id", async () => {
      const sources: Array<{ source: SourceRow; eventId: string }> = [
        {
          source: { nostrEventId: null, signedEvent: { id: "from-signed" } },
          eventId: "from-signed",
        },
        {
          source: {
            nostrEventId: "nostr-src",
            signedEvent: { id: "other" },
          },
          eventId: "nostr-src",
        },
      ];

      for (const item of sources) {
        mockGetStats.mockClear();
        mockCountReactions.mockClear();
        mockGetRelays.mockClear();
        mockDiscard.mockClear();
        db.meta = repostMeta({ minReactions: 1 });
        db.sourceRow = item.source;
        const { result } = await run();
        expect(result.skipped).toBeUndefined();
        expect(mockDiscard).not.toHaveBeenCalled();
        expect(mockGetStats).toHaveBeenCalledWith([item.eventId]);
        expect(mockCountReactions).toHaveBeenCalledWith(
          item.eventId,
          relaysForReactionCount(["wss://relay.example"]),
          1
        );
        expect(mockGetRelays).toHaveBeenCalledTimes(1);
      }
    });

    it("discards when engagement conditions are not met and logs numeric reaction minima", async () => {
      db.meta = repostMeta({ minReactions: 3, minZaps: 1 });
      db.sourceRow = { nostrEventId: "src-low", signedEvent: null };
      mockCountReactions.mockResolvedValue(0);
      mockGetStats.mockResolvedValue({
        "src-low": { likes: 0, zaps: 0, replies: 0, reposts: 0, satszapped: 0 },
      });

      const unmet = await run();

      expect(unmet.result.skipped).toBe(true);
      expect(unmet.ctx.lease).toBeNull();
      expect(mockDiscard).toHaveBeenCalledWith({
        postId: TEST_POST_ID,
        userId: TEST_USER_ID,
        reason: "Repost skipped: engagement conditions not met",
        cancelJob: false,
      });
      expect(mockRecordJobSkipped).toHaveBeenCalledWith(
        QUEUE,
        "repost_conditions_not_met"
      );
      expect(
        infoLogs("Repost reaction condition not met")[0]?.countedReactions
      ).toBe(0);
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it("does not count reactions for a zero minimum and fails closed without stats", async () => {
      db.meta = repostMeta({ minReactions: 0 });
      db.sourceRow = { nostrEventId: "src-zero", signedEvent: null };
      const zeroMin = await run();

      expect(zeroMin.result.skipped).toBeUndefined();
      expect(mockCountReactions).not.toHaveBeenCalled();
      expect(infoLogs("Repost reaction condition met").length).toBeGreaterThan(
        0
      );

      mockPublish.mockClear();
      db.meta = repostMeta({ minZaps: 1 });
      mockGetStats.mockResolvedValue({});
      const noStats = await run();

      expect(noStats.result.skipped).toBe(true);
      expect(mockCountReactions).not.toHaveBeenCalled();
      expect(mockPublish).not.toHaveBeenCalled();
    });
  });

  describe("publish path", () => {
    it("publishes the job event, records metrics, and notifies", async () => {
      const event = signedStub();
      const scheduledForUnix = computeScheduledForUnix(FUTURE);
      const attemptId = generatePublishAttemptId(
        TEST_POST_ID,
        scheduledForUnix,
        0
      );

      const { result, ctx } = await run({ signedEvent: event });

      expect(result).toEqual({ success: true, postId: TEST_POST_ID });
      expect(ctx.lease).toBe(LEASE);
      expect(mockPublish).toHaveBeenCalledWith({
        queueName: QUEUE,
        userId: TEST_USER_ID,
        attributes: {
          queue: QUEUE,
          postId: TEST_POST_ID,
          userId: TEST_USER_ID,
          correlationId: "corr-1",
          relayCount: 1,
          attempt: 0,
        },
        event,
        relays: ["wss://relay.example"],
        correlationId: "corr-1",
      });
      expect(mockPersistAcks).toHaveBeenCalledWith({
        publishAttemptId: attemptId,
        userId: TEST_USER_ID,
        eventId: event.id,
        results: [{ relay: "wss://relay.example", ok: true }],
      });
      expect(mockTransition.mock.calls.map((call) => call[2])).toEqual([
        "PUBLISHING",
        "PUBLISHED",
      ]);
      expect(mockTransition.mock.calls[1]?.[3]).toBe(
        "Successfully published to Nostr"
      );
      expect(
        mockTransition.mock.calls[1]?.[4]?.additionalPostData?.publishAttemptId
      ).toBe(attemptId);
      expect(
        mockTransition.mock.calls[1]?.[4]?.additionalPostData?.publishedAt
      ).toBeInstanceOf(Date);
      expect(mockRecordPublished).toHaveBeenCalledWith("TEXT", "scheduled");
      expect(mockRecordLatency).toHaveBeenCalledWith("TEXT", "scheduled", 15);
      const lateness = mockRecordLateness.mock.calls[0]?.[1] ?? 0;
      expect(
        Math.abs(lateness - (Math.floor(Date.now() / 1000) - scheduledForUnix))
      ).toBeLessThanOrEqual(1);
      expect(mockSendSuccess).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_POST_ID,
        attemptId,
        {
          isLongForm: false,
          source: "scheduled",
          postKind: "POST",
          queueName: "Main",
        }
      );
      expect(mockActivateContest).toHaveBeenCalledWith({
        postId: TEST_POST_ID,
        userId: TEST_USER_ID,
        publishedEventId: event.id,
      });
      expect(mockBreadcrumb).toHaveBeenCalledWith({
        message: "scheduled_post_job_succeeded",
        category: "worker",
        level: "info",
        data: {
          queue: QUEUE,
          postId: TEST_POST_ID,
          userId: TEST_USER_ID,
          correlationId: "corr-1",
          publishAttemptId: attemptId,
          jobId: "job-1",
        },
      });
      expect(mockRecordJobMetrics.mock.calls[0]?.[0]).toBe(QUEUE);
      expect(mockRecordJobMetrics.mock.calls[0]?.[2]).toBe(true);
    });

    it("loads a signed event from the row when the job payload is not an object", async () => {
      db.signedRow = { signedEvent: signedStub({ id: "from-db" }) };

      const recovered = await run({ signedEvent: ["array"] });
      expect(recovered.result.success).toBe(true);
      expect(mockPublish.mock.calls[0]?.[0].event.id).toBe("from-db");
      expect(
        infoLogs("Using signedEvent from post row (job payload missing)")
      ).toHaveLength(1);

      db.signedRow = { signedEvent: signedStub({ id: "from-null-job" }) };
      mockPublish.mockClear();
      await run({ signedEvent: null });
      expect(mockPublish.mock.calls[0]?.[0].event.id).toBe("from-null-job");
    });

    it("throws when neither the job nor the row has a signed event object", async () => {
      const message = `Post ${TEST_POST_ID}: no signedEvent in job data or post row; cannot publish to Nostr`;
      db.signedRow = null;
      await expect(run({ omitSignedEvent: true })).rejects.toThrow(message);

      db.signedRow = { signedEvent: [] };
      await expect(run({ signedEvent: "text" })).rejects.toThrow(message);

      db.signedRow = { signedEvent: 12 };
      await expect(run({ signedEvent: null })).rejects.toThrow(message);

      db.signedRow = { signedEvent: null };
      await expect(run({ omitSignedEvent: true })).rejects.toThrow(message);
      expect(mockReleaseLease).not.toHaveBeenCalled();
    });

    it("continues when relay ack persistence throws an Error or a string", async () => {
      mockPersistAcks.mockRejectedValueOnce(new Error("ack-down"));
      const fromError = await run();
      mockPersistAcks.mockRejectedValueOnce("ack-string");
      const fromString = await run();

      expect(fromError.result.success).toBe(true);
      expect(fromString.result.success).toBe(true);
      const ackErrors = mockLogError.mock.calls.filter(
        (call) =>
          call[1]?.message ===
          "Scheduled posts worker: Failed to persist publish ACKs"
      );
      expect(ackErrors[0]?.[0].message).toBe("ack-down");
      expect(ackErrors[1]?.[0].message).toBe("ack-string");
    });

    it("throws when every relay rejects and keeps the lease for the error handler", async () => {
      mockPublish.mockResolvedValue({
        publishLatencyMs: 4,
        publishResult: {
          results: [
            { relay: "wss://a", ok: false, error: "blocked" },
            { relay: "wss://b", ok: false, error: "nope" },
          ],
        },
      });

      await expect(run()).rejects.toThrow(
        "Publish failed on all relays: blocked; nope"
      );
      expect(mockReleaseLease).not.toHaveBeenCalled();
      expect(mockTransition.mock.calls.map((call) => call[2])).toEqual([
        "PUBLISHING",
      ]);
    });

    it("releases the lease and rethrows when the published transition fails", async () => {
      mockTransition.mockImplementation(
        async (
          _postId: string,
          _userId: string,
          target: string
        ): Promise<void> => {
          if (target === "PUBLISHED") throw new Error("transition-down");
        }
      );
      const ctx: { lease: PublishLease | null } = { lease: null };

      await expect(
        runScheduledPostJob({
          job: buildJob(),
          startTime: 0,
          ctx,
        })
      ).rejects.toThrow("transition-down");
      expect(mockReleaseLease).toHaveBeenCalledWith({
        postId: TEST_POST_ID,
        userId: TEST_USER_ID,
        lockId: "lease-1",
      });
      expect(ctx.lease).toBe(LEASE);
    });

    it("still returns success when contest activation or the notification throws", async () => {
      mockActivateContest.mockRejectedValueOnce(new Error("contest-down"));
      mockSendSuccess.mockRejectedValueOnce("notify-string");
      const first = await run();

      mockActivateContest.mockRejectedValueOnce("contest-string");
      mockSendSuccess.mockRejectedValueOnce(new Error("notify-down"));
      db.metricsRow = {
        postType: "IMAGE",
        postKind: "QUOTE",
        queueType: null,
      };
      const second = await run();

      expect(first.result).toEqual({ success: true, postId: TEST_POST_ID });
      expect(second.result).toEqual({ success: true, postId: TEST_POST_ID });
      const contestLogs = mockLogError.mock.calls.filter(
        (call) =>
          call[1]?.message ===
          "Contest launch hook after scheduled publish failed"
      );
      expect(contestLogs[0]?.[0].message).toBe("contest-down");
      expect(contestLogs[1]?.[0].message).toBe("contest-string");
      const notifyLogs = mockLogError.mock.calls.filter(
        (call) =>
          call[1]?.message === "Failed to send publish success notification"
      );
      expect(notifyLogs[0]?.[0].message).toBe("notify-string");
      expect(notifyLogs[1]?.[0].message).toBe("notify-down");
      expect(mockSendSuccess.mock.calls[1]?.[3]).toEqual({
        isLongForm: false,
        source: "scheduled",
        postKind: "QUOTE",
        queueName: null,
      });
      expect(mockRecordPublished).toHaveBeenCalledWith("IMAGE", "scheduled");
    });

    it("skips publish metrics when the metrics row is missing", async () => {
      db.metricsRow = null;
      const { result } = await run();

      expect(result.success).toBe(true);
      expect(mockRecordPublished).not.toHaveBeenCalled();
      expect(mockRecordLatency).not.toHaveBeenCalled();
      expect(mockSendSuccess.mock.calls[0]?.[3]).toEqual({
        isLongForm: false,
        source: "scheduled",
        postKind: undefined,
        queueName: null,
      });
    });
  });

  describe("handleScheduledPostJobError", () => {
    async function failJob(input: {
      error: unknown;
      willRetry: boolean;
      lease: PublishLease | null;
      job?: Job<PostJobData>;
    }): Promise<void> {
      mockWillRetry.mockReturnValue(input.willRetry);
      await handleScheduledPostJobError({
        job: input.job ?? buildJob(),
        startTime: 0,
        lease: input.lease,
        error: input.error,
      });
    }

    it("requeues a failed publishing row and wraps a string error", async () => {
      db.stateRow = { currentState: "FAILED" };

      await failJob({
        error: "boom",
        willRetry: true,
        lease: LEASE,
      });

      expect(mockWillRetry.mock.calls[0]?.[0].attemptsMade).toBe(1);
      expect(mockWillRetry.mock.calls[0]?.[0].error.message).toBe("boom");
      expect(mockTransition.mock.calls.map((call) => call[2])).toEqual([
        "SCHEDULED",
      ]);
      expect(mockTransition.mock.calls[0]?.[3]).toBe("Publish will be retried");
      expect(mockRecordJobRetry).toHaveBeenCalledWith(QUEUE);
      expect(mockReleaseLease).toHaveBeenCalledTimes(1);
      expect(mockReleaseLease).toHaveBeenCalledWith({
        postId: TEST_POST_ID,
        userId: TEST_USER_ID,
        lockId: "lease-1",
      });
      expect(mockDeadLetter).not.toHaveBeenCalled();
      expect(mockSendFailure).not.toHaveBeenCalled();
      expect(mockCapture.mock.calls[0]?.[1].level).toBe("warning");
      expect(mockRecordFailed).toHaveBeenCalledWith(
        "TEXT",
        "scheduled",
        "Error"
      );
    });

    it("walks PUBLISHING through FAILED before scheduling the retry and clears the lock", async () => {
      db.stateQueue = [
        { currentState: "PUBLISHING" },
        { currentState: "SCHEDULED" },
      ];

      await failJob({
        error: new Error("retry-me"),
        willRetry: true,
        lease: LEASE,
      });

      expect(
        mockTransition.mock.calls.map((call) => [call[2], call[3]])
      ).toEqual([
        ["PUBLISHING", "Job started processing (before error)"],
        ["FAILED", "Publish failed: retry-me"],
        ["SCHEDULED", "Publish will be retried"],
      ]);
      expect(mockTransition.mock.calls[1]?.[4]).toEqual({
        additionalPostData: {
          publishingLockId: null,
          publishingLockExpiresAt: null,
        },
      });
      expect(mockReleaseLease).toHaveBeenCalledTimes(1);
    });

    it("does not transition rows that are neither publishing nor failed", async () => {
      db.stateRow = { currentState: "DRAFT" };
      await failJob({ error: new Error("x"), willRetry: true, lease: LEASE });
      expect(mockTransition).not.toHaveBeenCalled();
      expect(mockReleaseLease).toHaveBeenCalledTimes(1);

      mockReleaseLease.mockClear();
      mockTransition.mockClear();
      db.stateRow = null;
      await failJob({ error: new Error("x"), willRetry: true, lease: null });
      expect(mockTransition).not.toHaveBeenCalled();
      expect(mockReleaseLease).not.toHaveBeenCalled();
    });

    it("releases twice when a retryable state transition throws", async () => {
      mockTransition.mockRejectedValue(new Error("state-down"));

      await failJob({
        error: new Error("publish-down"),
        willRetry: true,
        lease: LEASE,
      });

      expect(mockReleaseLease).toHaveBeenCalledTimes(2);
      expect(
        errorLog("Failed to transition post to FAILED state")?.message
      ).toBe("state-down");
      expect(mockDeadLetter).not.toHaveBeenCalled();
      expect(mockRecordJobMetrics.mock.calls[0]?.[2]).toBe(false);
      expect(mockRecordJobMetrics.mock.calls[0]?.[3]?.message).toBe(
        "publish-down"
      );
    });

    it("logs a thrown string from the state transition without a lease", async () => {
      mockTransition.mockRejectedValue("state-string");

      await failJob({
        error: new Error("terminal"),
        willRetry: false,
        lease: null,
      });

      expect(mockReleaseLease).not.toHaveBeenCalled();
      expect(
        errorLog("Failed to transition post to FAILED state")?.message
      ).toBe("state-string");
      expect(mockDeadLetter).toHaveBeenCalledTimes(1);
      expect(mockCapture.mock.calls[0]?.[1].level).toBe("error");
    });

    it("fails a scheduled row, writes the dead letter, and notifies with the stored attempt", async () => {
      const error = new Error("rejected");
      db.stateQueue = [{ currentState: "SCHEDULED" }];
      const job = buildJob({ id: "job-9", attemptsMade: 0 });

      await failJob({ error, willRetry: false, lease: LEASE, job });

      expect(mockTransition.mock.calls.map((call) => call[2])).toEqual([
        "PUBLISHING",
        "FAILED",
      ]);
      expect(mockTransition.mock.calls[1]?.[4]).toEqual({
        additionalPostData: {
          publishingLockId: null,
          publishingLockExpiresAt: null,
        },
      });
      expect(mockReleaseLease).not.toHaveBeenCalled();
      expect(mockRecordJobRetry).not.toHaveBeenCalled();
      expect(mockDeadLetter).toHaveBeenCalledWith(
        QUEUE,
        "job-9",
        "publish-post",
        job.data,
        error,
        1,
        "corr-1"
      );
      expect(mockSendFailure).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_POST_ID,
        "attempt-db",
        "rejected"
      );
      expect(mockCapture.mock.calls[0]?.[1].extra.errorType).toBe("Error");
      expect(mockCapture.mock.calls[0]?.[1].level).toBe("error");
    });

    it("uses a fallback attempt id when the row or attempt id is missing", async () => {
      const error = new TypeError("typed");
      db.attemptRow = null;
      db.metricsRow = {
        postType: "TEXT",
        postKind: "POST",
        queueType: { name: "Main" },
      };
      const job = buildJob({
        id: null,
        attemptsMade: 4,
        omitCorrelation: true,
      });

      await failJob({ error, willRetry: false, lease: null, job });

      expect(mockRecordFailed).toHaveBeenCalledWith(
        "TEXT",
        "scheduled",
        "TypeError"
      );
      expect(mockDeadLetter.mock.calls[0]?.[1]).toBe("unknown");
      expect(mockDeadLetter.mock.calls[0]?.[5]).toBe(5);
      expect(mockDeadLetter.mock.calls[0]?.[6]).toBeUndefined();
      expect(mockSendFailure.mock.calls[0]?.[2]).toMatch(
        /^failed_post-123_\d+$/
      );
      expect(mockCapture.mock.calls[0]?.[1].extra).toEqual({
        postId: TEST_POST_ID,
        userId: TEST_USER_ID,
        correlationId: undefined,
        jobId: "unknown",
        attempt: 4,
        attemptsMade: 5,
        willRetry: false,
        errorType: "TypeError",
      });
      expect(mockTransition.mock.calls[0]?.[4]).toBeUndefined();

      mockSendFailure.mockClear();
      mockRecordFailed.mockClear();
      db.attemptRow = { publishAttemptId: null };
      db.metricsRow = null;
      await failJob({
        error: new Error("again"),
        willRetry: false,
        lease: null,
      });
      expect(mockSendFailure.mock.calls[0]?.[2]).toMatch(
        /^failed_post-123_\d+$/
      );
      expect(mockRecordFailed).not.toHaveBeenCalled();
    });

    it("still finishes when the failure notification throws", async () => {
      mockSendFailure.mockRejectedValueOnce(new Error("notify-down"));
      await failJob({
        error: new Error("rejected"),
        willRetry: false,
        lease: null,
      });
      mockSendFailure.mockRejectedValueOnce("notify-string");
      await failJob({
        error: new Error("rejected"),
        willRetry: false,
        lease: null,
      });

      const notifyLogs = mockLogError.mock.calls.filter(
        (call) =>
          call[1]?.message === "Failed to send publish failure notification"
      );
      expect(notifyLogs[0]?.[0].message).toBe("notify-down");
      expect(notifyLogs[1]?.[0].message).toBe("notify-string");
      expect(mockCapture).toHaveBeenCalledTimes(2);
      expect(errorLog("Error processing scheduled post")?.message).toBe(
        "rejected"
      );
    });
  });
});
