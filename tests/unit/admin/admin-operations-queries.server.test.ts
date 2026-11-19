import { PublishRelayAckStatus, ReferralEarningStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  deadLetterJob: { findMany: vi.fn() },
  longFormPost: { findMany: vi.fn() },
  post: { count: vi.fn(), findMany: vi.fn() },
  publishRelayAck: { groupBy: vi.fn() },
  referralEarning: {
    findMany: vi.fn(async (_args?: { where?: { status?: string } }) => []),
  },
}));

const queueApi = vi.hoisted(() => ({
  getQueueInstance: vi.fn(),
}));

const outboxApi = vi.hoisted(() => ({
  getOutboxBacklogCounts: vi.fn(),
}));

const signerApi = vi.hoisted(() => ({
  getSignerConnectHealthBundle: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));
vi.mock("~/infra/queue/queue-client.server", () => ({
  getQueueInstance: queueApi.getQueueInstance,
}));
vi.mock("~/infra/outbox/outbox.server", () => ({
  getOutboxBacklogCounts: outboxApi.getOutboxBacklogCounts,
}));
vi.mock(
  "~/features/admin/repositories/admin-signer-connect-bundle.server",
  () => ({
    getSignerConnectHealthBundle: signerApi.getSignerConnectHealthBundle,
  })
);

import { getBoundsForPreset } from "~/features/admin/metrics/date-range";
import { getAdminOperationsPageData } from "~/features/admin/repositories/admin-operations-queries.server";

const NOW = new Date("2026-06-15T12:00:00.000Z");

const SIGNER = {
  distinctUsersWithFailureInRange: 0,
  enabledUsers: 1,
  failuresByBucket: [],
  reconnectAttemptsInRange: 0,
  reconnectConfidence: { confidence: "insufficient_sample" },
  reconnectFailureRatePct: null,
  reconnectFailuresInRange: 0,
  usersExtensionOrUnset: 1,
  usersWithNip46Profile: 0,
};

interface MockReset {
  mockReset: () => void;
}

function isMockReset(value: unknown): value is MockReset {
  if (typeof value !== "function" || !("mockReset" in value)) return false;
  return typeof value.mockReset === "function";
}

function resetTree(tree: Record<string, unknown>): void {
  for (const value of Object.values(tree)) {
    if (isMockReset(value)) {
      value.mockReset();
      continue;
    }
    if (value && typeof value === "object") {
      resetTree(value as Record<string, unknown>);
    }
  }
}

function installQueues(counts: Record<string, number>): void {
  queueApi.getQueueInstance.mockImplementation(() => ({
    getJobCounts: vi.fn().mockResolvedValue(counts),
  }));
}

describe("getAdminOperationsPageData", () => {
  beforeEach(() => {
    resetTree(prismaMock);
    resetTree(queueApi);
    resetTree(outboxApi);
    resetTree(signerApi);
    prismaMock.deadLetterJob.findMany.mockResolvedValue([]);
    prismaMock.longFormPost.findMany.mockResolvedValue([]);
    prismaMock.post.count.mockResolvedValue(0);
    prismaMock.post.findMany.mockResolvedValue([]);
    prismaMock.publishRelayAck.groupBy.mockResolvedValue([]);
    prismaMock.referralEarning.findMany.mockResolvedValue([]);
    installQueues({});
    outboxApi.getOutboxBacklogCounts.mockResolvedValue({
      pending: 0,
      ready: 0,
      deadLettered: 0,
    });
    signerApi.getSignerConnectHealthBundle.mockResolvedValue(SIGNER);
  });

  it("describes a quiet range when every sample is empty", async () => {
    const data = await getAdminOperationsPageData("24h", NOW);

    expect(data.rangePreset).toBe("24h");
    expect(data.generatedAt).toBe(NOW.toISOString());
    expect(data.failedPosts).toEqual([]);
    expect(data.deadLetters).toEqual([]);
    expect(data.failedPayouts).toEqual([]);
    expect(data.queueError).toBeNull();
    expect(data.queueDepths).toEqual([
      {
        queue: "scheduled-posts",
        waiting: 0,
        active: 0,
        failed: 0,
        delayed: 0,
      },
      {
        queue: "scheduled-longform-posts",
        waiting: 0,
        active: 0,
        failed: 0,
        delayed: 0,
      },
      {
        queue: "post-checker",
        waiting: 0,
        active: 0,
        failed: 0,
        delayed: 0,
      },
    ]);
    expect(data.outbox).toEqual({ pending: 0, ready: 0, deadLettered: 0 });
    expect(data.operationalSummary.headline).toBe(
      "No failed publishes, dead letters, or payout failures in sampled tables  -  queues look quiet."
    );
    expect(data.operationalSummary.nextStep).toContain("Keep monitoring");
    expect(data.operationalSummary.oldestUnresolvedIso).toBeNull();
    expect(data.relayAcks).toEqual({ accepted: 0, failed: 0, ratePct: null });
    expect(data.failuresByReason).toEqual([]);
    expect(data.signerConnect).toEqual(SIGNER);
    expect(prismaMock.post.findMany).toHaveBeenCalled();
    expect(prismaMock.deadLetterJob.findMany).toHaveBeenCalled();
    expect(outboxApi.getOutboxBacklogCounts).toHaveBeenCalledWith(NOW);
    expect(signerApi.getSignerConnectHealthBundle).toHaveBeenCalledWith(
      getBoundsForPreset("24h", NOW)
    );
    expect(queueApi.getQueueInstance).toHaveBeenCalledTimes(3);
  });

  it("merges failures, dead letters, payouts, and relay rates", async () => {
    prismaMock.post.findMany.mockResolvedValue([
      {
        id: "short-new",
        userId: "user-1",
        updatedAt: new Date("2026-06-03T00:00:00.000Z"),
        user: { npub: "npub-short" },
        stateTransitions: [{ reason: "relay down" }],
      },
      {
        id: "short-blank",
        userId: "user-1",
        updatedAt: new Date("2026-06-01T00:00:00.000Z"),
        user: { npub: "npub-short" },
        stateTransitions: [{ reason: "   " }],
      },
    ]);
    prismaMock.longFormPost.findMany.mockResolvedValue([
      {
        id: "long-unknown",
        userId: "user-2",
        updatedAt: new Date("2026-06-02T00:00:00.000Z"),
        user: { npub: "npub-long" },
        stateTransitions: [],
      },
    ]);
    prismaMock.deadLetterJob.findMany.mockResolvedValue([
      {
        id: "dl-old",
        queueType: "scheduled-posts",
        jobId: "job-old",
        error: "timeout",
        createdAt: new Date("2026-01-15T00:00:00.000Z"),
        jobData: { postId: "post-9" },
      },
      {
        id: "dl-null",
        queueType: "post-checker",
        jobId: "job-null",
        error: "missing",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        jobData: null,
      },
      {
        id: "dl-number",
        queueType: "post-checker",
        jobId: "job-number",
        error: "bad id",
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        jobData: { postId: 5 },
      },
    ]);
    prismaMock.referralEarning.findMany.mockResolvedValue([
      {
        id: "earn-1",
        referrerNpub: "npub-referrer",
        commissionSats: 1000,
        payoutFailureReason: null,
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    ]);
    prismaMock.post.count.mockResolvedValue(2);
    prismaMock.publishRelayAck.groupBy.mockResolvedValue([
      { status: PublishRelayAckStatus.ACCEPTED, _count: { _all: 1 } },
      { status: PublishRelayAckStatus.FAILED, _count: { _all: 1 } },
      { status: PublishRelayAckStatus.TIMEOUT, _count: { _all: 1 } },
    ]);
    installQueues({ waiting: 1, active: 2, failed: 3, delayed: 4 });
    outboxApi.getOutboxBacklogCounts.mockResolvedValue({
      pending: 4,
      ready: 5,
      deadLettered: 6,
    });

    const data = await getAdminOperationsPageData("7d", NOW);

    expect(data.failedPosts.map((row) => row.id)).toEqual([
      "short-new",
      "long-unknown",
      "short-blank",
    ]);
    expect(data.failedPosts[1]).toMatchObject({
      kind: "long",
      reason: "Unknown",
      npub: "npub-long",
    });
    expect(data.failuresByReason).toEqual([
      { reason: "Unknown", count: 2 },
      { reason: "relay down", count: 1 },
    ]);
    expect(data.deadLetters.map((row) => row.postId)).toEqual([
      "post-9",
      null,
      null,
    ]);
    expect(data.failedPayouts).toEqual([
      {
        id: "earn-1",
        referrerNpub: "npub-referrer",
        commissionSats: 1000,
        payoutFailureReason: null,
        createdAt: "2026-02-01T00:00:00.000Z",
      },
    ]);
    expect(data.relayAcks).toEqual({ accepted: 1, failed: 2, ratePct: 33.3 });
    expect(data.queueDepths[0]).toMatchObject({
      queue: "scheduled-posts",
      waiting: 1,
      active: 2,
      failed: 3,
      delayed: 4,
    });
    expect(data.queueError).toBeNull();
    expect(data.outbox?.deadLettered).toBe(6);
    expect(data.operationalSummary.oldestUnresolvedIso).toBe(
      "2026-01-15T00:00:00.000Z"
    );
    expect(data.operationalSummary.stuckPublishing).toBe(2);
    expect(data.operationalSummary.headline).toContain("2 stuck in publishing");
    expect(data.operationalSummary.headline).toContain(
      "6 outbox dead-letter row(s)"
    );
    expect(data.operationalSummary.headline).toContain("3 failed publish");
    expect(data.operationalSummary.headline).toContain("3 dead-letter");
    expect(data.operationalSummary.headline).toContain("1 failed payout");
    expect(data.operationalSummary.headline).toContain("9 failed job(s)");
    expect(data.operationalSummary.nextStep).toContain("dead letters");
    const statuses = prismaMock.referralEarning.findMany.mock.calls.map(
      (call) => call[0]?.where?.status
    );
    expect(statuses).toContain(ReferralEarningStatus.FAILED);
  });

  it("points the next step at stuck publishes ahead of failed rows", async () => {
    prismaMock.post.count.mockResolvedValue(2);
    prismaMock.post.findMany.mockResolvedValue([
      {
        id: "short-1",
        userId: "user-1",
        updatedAt: new Date("2026-06-02T00:00:00.000Z"),
        user: { npub: "npub-short" },
        stateTransitions: [{ reason: "signer" }],
      },
    ]);
    outboxApi.getOutboxBacklogCounts.mockResolvedValue({
      pending: 0,
      ready: 0,
      deadLettered: 1,
    });

    const data = await getAdminOperationsPageData("7d", NOW);

    expect(data.operationalSummary.nextStep).toContain("stuck publishing");
    expect(data.operationalSummary.headline).toContain("2 stuck");
    expect(data.operationalSummary.headline).toContain("1 outbox");
    expect(data.operationalSummary.headline).toContain("1 failed publish");
  });

  it("caps failure reasons at 12 and points at those rows", async () => {
    prismaMock.post.findMany.mockResolvedValue(
      Array.from({ length: 13 }, (_, index) => ({
        id: `post-${index}`,
        userId: "user-1",
        updatedAt: new Date(Date.UTC(2026, 0, index + 1)),
        user: { npub: "npub-short" },
        stateTransitions: [{ reason: `reason-${index}` }],
      }))
    );

    const data = await getAdminOperationsPageData("30d", NOW);

    expect(data.failuresByReason).toHaveLength(12);
    expect(data.failuresByReason[0]?.reason).toBe("reason-12");
    expect(data.failuresByReason.map((row) => row.reason)).not.toContain(
      "reason-0"
    );
    expect(data.operationalSummary.headline).toContain(
      "13 failed publish row(s)"
    );
    expect(data.operationalSummary.nextStep).toContain("Group failures");
    expect(prismaMock.post.findMany).toHaveBeenCalled();
  });

  it("points the next step at failed payouts when they are the only issue", async () => {
    prismaMock.referralEarning.findMany.mockResolvedValue([
      {
        id: "earn-1",
        referrerNpub: "npub-a",
        commissionSats: 10,
        payoutFailureReason: "invoice",
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
      },
      {
        id: "earn-2",
        referrerNpub: "npub-b",
        commissionSats: 20,
        payoutFailureReason: "timeout",
        createdAt: new Date("2026-06-02T00:00:00.000Z"),
      },
    ]);

    const data = await getAdminOperationsPageData("7d", NOW);

    expect(data.operationalSummary.failedPayoutCount).toBe(2);
    expect(data.operationalSummary.headline).toBe("2 failed payout(s)");
    expect(data.operationalSummary.nextStep).toContain(
      "Retry failed referral payouts"
    );
    expect(data.failedPayouts.map((row) => row.payoutFailureReason)).toEqual([
      "invoice",
      "timeout",
    ]);
  });

  it("mentions failed Bull jobs when the tables are otherwise clear", async () => {
    queueApi.getQueueInstance.mockImplementation((name: string) => ({
      getJobCounts: vi.fn().mockResolvedValue({
        waiting: 0,
        active: 0,
        failed: name === "post-checker" ? 1 : 2,
        delayed: 0,
      }),
    }));

    const data = await getAdminOperationsPageData("7d", NOW);

    expect(data.operationalSummary.headline).toBe(
      "5 failed job(s) across Bull queues"
    );
    expect(data.operationalSummary.nextStep).toContain("Keep monitoring");
    expect(data.queueError).toBeNull();
  });

  it("records an Error from redis and still returns database rows", async () => {
    prismaMock.post.findMany.mockResolvedValue([
      {
        id: "short-1",
        userId: "user-1",
        updatedAt: new Date("2026-06-02T00:00:00.000Z"),
        user: { npub: "npub-short" },
        stateTransitions: [{ reason: "relay" }],
      },
    ]);
    queueApi.getQueueInstance.mockImplementation(() => {
      throw new Error("redis unavailable");
    });

    const data = await getAdminOperationsPageData("7d", NOW);

    expect(data.queueError).toBe("redis unavailable");
    expect(data.queueDepths).toEqual([]);
    expect(data.operationalSummary.nextStep).toContain("Group failures");
    expect(data.failedPosts).toHaveLength(1);
  });

  it("uses a generic queue error when redis throws a non-Error", async () => {
    queueApi.getQueueInstance.mockImplementation(() => {
      throw "nope";
    });

    const data = await getAdminOperationsPageData("7d", NOW);

    expect(data.queueError).toBe("Redis unavailable");
    expect(data.queueDepths).toEqual([]);
    expect(data.operationalSummary.headline).toContain("queues look quiet");
  });

  it("drops the outbox block when that probe throws", async () => {
    outboxApi.getOutboxBacklogCounts.mockRejectedValue(new Error("outbox"));

    const data = await getAdminOperationsPageData("all", NOW);

    expect(data.outbox).toBeNull();
    expect(data.operationalSummary.outboxDeadLettered).toBe(0);
    expect(data.operationalSummary.headline).toContain("queues look quiet");
    expect(signerApi.getSignerConnectHealthBundle).toHaveBeenCalled();
  });
});
