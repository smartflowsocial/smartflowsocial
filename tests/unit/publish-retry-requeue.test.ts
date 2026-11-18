import { describe, expect, it, vi, beforeEach } from "vitest";

const { noteTransitions, longformTransitions, mockFindPost, mockFindLongForm } =
  vi.hoisted(() => ({
    noteTransitions: [] as string[],
    longformTransitions: [] as string[],
    mockFindPost: vi.fn(),
    mockFindLongForm: vi.fn(),
  }));

vi.mock("~/features/posts/repositories/post-queries-data.server", () => ({
  findPostUnique: mockFindPost,
}));

vi.mock("~/features/posts/repositories/longform-data.server", () => ({
  findLongFormPostUnique: mockFindLongForm,
}));

vi.mock("~/features/posts/state-machine/post-state-machine.server", () => ({
  PostStateMachine: class {
    async transition(
      _postId: string,
      _userId: string,
      target: string
    ): Promise<void> {
      noteTransitions.push(target);
    }
  },
}));

vi.mock("~/features/posts/longform/index.server", () => ({
  LongFormPostStateMachine: class {
    async transition(
      _postId: string,
      _userId: string,
      target: string
    ): Promise<void> {
      longformTransitions.push(target);
    }
  },
}));

vi.mock("~/infra/publishing/publish-lease.server", () => ({
  acquirePostPublishLease: vi.fn(),
  releasePostPublishLease: vi.fn(),
  acquireLongFormPostPublishLease: vi.fn(),
  releaseLongFormPostPublishLease: vi.fn(),
}));

vi.mock("~/infra/queue/dead-letter-queue.server", () => ({
  createDeadLetterEntry: vi.fn(),
}));

vi.mock("~/infra/notifications/push-notification.server", () => ({
  sendPublishFailureNotification: vi.fn(),
}));

vi.mock("~/lib/sentry.server", () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("~/lib/error-logger.server", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("~/lib/queue-metrics.server", () => ({
  recordJobMetrics: vi.fn(),
  recordJobSkipped: vi.fn(),
  recordJobRetry: vi.fn(),
}));

vi.mock("~/lib/metrics/business-metrics.server", () => ({
  recordPostPublished: vi.fn(),
  recordPostPublishFailed: vi.fn(),
}));

import { handleScheduledLongFormPostJobError } from "~/features/posts/queue-handlers/longform-job.server";
import { handleScheduledPostJobError } from "~/features/posts/queue-handlers/post-job.server";

function job(attemptsMade: number) {
  return {
    id: "job-1",
    attemptsMade,
    data: {
      postId: "post-1",
      userId: "user-1",
      correlationId: "corr-1",
      signedEvent: {},
    },
  };
}

describe("retryable publish failures return the row to SCHEDULED", () => {
  beforeEach(() => {
    noteTransitions.length = 0;
    longformTransitions.length = 0;
    mockFindPost.mockReset();
    mockFindLongForm.mockReset();
  });

  it("requeues a note after a connection failure", async () => {
    mockFindPost.mockResolvedValue({
      currentState: "PUBLISHING",
      postType: "TEXT",
      postKind: "POST",
      queueType: { name: "queue" },
    });

    await handleScheduledPostJobError({
      job: job(0) as never,
      startTime: Date.now(),
      lease: { lockId: "lease-1", expiresAt: new Date() },
      error: new Error("connect ECONNREFUSED 127.0.0.1:1"),
    });

    expect(noteTransitions).toEqual(["FAILED", "SCHEDULED"]);
  });

  it("leaves a note FAILED when the relay rejected the event", async () => {
    mockFindPost.mockResolvedValue({
      currentState: "SCHEDULED",
      postType: "TEXT",
      postKind: "POST",
      queueType: { name: "queue" },
      publishAttemptId: "attempt-1",
    });

    await handleScheduledPostJobError({
      job: job(0) as never,
      startTime: Date.now(),
      lease: { lockId: "lease-1", expiresAt: new Date() },
      error: new Error("rejected: blocked"),
    });

    expect(noteTransitions).toEqual(["PUBLISHING", "FAILED"]);
  });

  it("requeues a long-form post after a connection failure", async () => {
    mockFindLongForm.mockResolvedValue({
      currentState: "PUBLISHING",
      postType: "LONGFORM",
    });

    await handleScheduledLongFormPostJobError({
      job: job(0) as never,
      startTime: Date.now(),
      lease: { lockId: "lease-1", expiresAt: new Date() },
      error: new Error("connect ECONNREFUSED 127.0.0.1:1"),
    });

    expect(longformTransitions).toEqual(["FAILED", "SCHEDULED"]);
  });
});
