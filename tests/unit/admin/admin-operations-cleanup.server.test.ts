import { beforeEach, describe, expect, it, vi } from "vitest";

const queueApi = vi.hoisted(() => ({
  getQueueInstance: vi.fn(),
}));

const retentionApi = vi.hoisted(() => ({
  cleanupPublishRelayAcks: vi.fn(),
}));

const logApi = vi.hoisted(() => ({
  logInfo: vi.fn(),
}));

vi.mock("~/infra/queue/queue-client.server", () => ({
  getQueueInstance: queueApi.getQueueInstance,
}));
vi.mock(
  "~/features/relays/repositories/publish-relay-ack-retention.server",
  () => ({
    cleanupPublishRelayAcks: retentionApi.cleanupPublishRelayAcks,
  })
);
vi.mock("~/lib/error-logger.server", () => ({
  logInfo: logApi.logInfo,
}));

import {
  ADMIN_OPERATIONS_QUEUE_NAMES,
  cleanFailedJobsInAllQueues,
  purgePublishRelayAcksAdmin,
} from "~/features/admin/repositories/admin-operations-cleanup.server";

function installClean(
  nextIds: (name: string, call: number) => string[]
): Map<string, ReturnType<typeof vi.fn>> {
  const cleans = new Map<string, ReturnType<typeof vi.fn>>();
  queueApi.getQueueInstance.mockImplementation((name: string) => {
    let call = 0;
    const clean = vi.fn(() => {
      call += 1;
      return Promise.resolve(nextIds(name, call));
    });
    cleans.set(name, clean);
    return { clean };
  });
  return cleans;
}

describe("admin operations cleanup", () => {
  beforeEach(() => {
    queueApi.getQueueInstance.mockReset();
    retentionApi.cleanupPublishRelayAcks.mockReset();
    logApi.logInfo.mockReset();
  });

  it("names the queues operators can clean", () => {
    expect(ADMIN_OPERATIONS_QUEUE_NAMES).toEqual([
      "scheduled-posts",
      "scheduled-longform-posts",
      "post-checker",
      "broadcast-dm",
    ]);
  });

  it("returns zeros when every queue is already clear", async () => {
    const cleans = installClean(() => []);

    const result = await cleanFailedJobsInAllQueues({
      operatorNpub: "npub-operator",
    });

    expect(result).toEqual({
      ok: true,
      total: 0,
      byQueue: {
        "scheduled-posts": 0,
        "scheduled-longform-posts": 0,
        "post-checker": 0,
        "broadcast-dm": 0,
      },
    });
    expect(cleans.get("scheduled-posts")).toHaveBeenCalledWith(
      0,
      500,
      "failed"
    );
    expect(logApi.logInfo).toHaveBeenCalledWith(
      "Admin cleaned failed BullMQ jobs",
      expect.objectContaining({
        operatorNpub: "npub-operator",
        total: 0,
      })
    );
  });

  it("sums partial batches and stops a queue at the 10000 cap", async () => {
    const cleans = installClean((name, call) => {
      if (name === "scheduled-posts" && call <= 20) {
        return Array.from({ length: 500 }, () => "job");
      }
      if (name === "broadcast-dm" && call === 1) return ["a", "b"];
      if (name === "broadcast-dm" && call === 2) return ["c"];
      if (name === "post-checker" && call === 1) return ["x"];
      return [];
    });

    const result = await cleanFailedJobsInAllQueues({
      operatorNpub: "npub-operator",
    });

    expect(result).toEqual({
      ok: true,
      total: 10_004,
      byQueue: {
        "scheduled-posts": 10_000,
        "scheduled-longform-posts": 0,
        "post-checker": 1,
        "broadcast-dm": 3,
      },
    });
    expect(cleans.get("scheduled-posts")).toHaveBeenCalledTimes(20);
    expect(cleans.get("broadcast-dm")).toHaveBeenCalledTimes(3);
    expect(cleans.get("post-checker")).toHaveBeenCalledTimes(2);
    expect(cleans.get("scheduled-longform-posts")).toHaveBeenCalledTimes(1);
  });

  it("returns the error message when a queue clean fails", async () => {
    queueApi.getQueueInstance.mockReturnValue({
      clean: vi.fn().mockRejectedValue(new Error("redis locked")),
    });

    await expect(
      cleanFailedJobsInAllQueues({ operatorNpub: "npub-operator" })
    ).resolves.toEqual({ ok: false, error: "redis locked" });
    expect(logApi.logInfo).not.toHaveBeenCalled();
  });

  it("uses a generic message when the queue failure is not an Error", async () => {
    queueApi.getQueueInstance.mockReturnValue({
      clean: vi.fn().mockRejectedValue("disk"),
    });

    await expect(
      cleanFailedJobsInAllQueues({ operatorNpub: "npub-operator" })
    ).resolves.toEqual({
      ok: false,
      error: "Failed to clean failed jobs",
    });
  });

  it("clamps purge age and returns the retention result", async () => {
    retentionApi.cleanupPublishRelayAcks.mockResolvedValue({
      success: true,
      deletedCount: 4,
      cutoffIso: "2020-01-01T00:00:00.000Z",
    });

    const tooSmall = await purgePublishRelayAcksAdmin({
      olderThanDays: 1.2,
      operatorNpub: "npub-operator",
    });
    const tooLarge = await purgePublishRelayAcksAdmin({
      olderThanDays: 900,
      operatorNpub: "npub-operator",
    });
    const fractional = await purgePublishRelayAcksAdmin({
      olderThanDays: 30.9,
      operatorNpub: "npub-operator",
    });

    expect(tooSmall).toMatchObject({
      ok: true,
      deletedCount: 4,
      cutoffIso: "2020-01-01T00:00:00.000Z",
      olderThanDays: 7,
    });
    expect(tooLarge).toMatchObject({ ok: true, olderThanDays: 365 });
    expect(fractional).toMatchObject({ ok: true, olderThanDays: 30 });
    expect(retentionApi.cleanupPublishRelayAcks).toHaveBeenNthCalledWith(1, {
      olderThanDays: 7,
    });
    expect(retentionApi.cleanupPublishRelayAcks).toHaveBeenNthCalledWith(2, {
      olderThanDays: 365,
    });
    expect(retentionApi.cleanupPublishRelayAcks).toHaveBeenNthCalledWith(3, {
      olderThanDays: 30,
    });
    expect(logApi.logInfo).toHaveBeenCalledWith(
      "Admin purged old PublishRelayAck rows",
      expect.objectContaining({
        operatorNpub: "npub-operator",
        deletedCount: 4,
        olderThanDays: 7,
      })
    );
  });

  it("returns the purge error message", async () => {
    retentionApi.cleanupPublishRelayAcks.mockRejectedValue(
      new Error("db timeout")
    );

    await expect(
      purgePublishRelayAcksAdmin({
        olderThanDays: 14,
        operatorNpub: "npub-operator",
      })
    ).resolves.toEqual({ ok: false, error: "db timeout" });
    expect(logApi.logInfo).not.toHaveBeenCalled();
  });

  it("uses a generic message when purge fails with a non-Error", async () => {
    retentionApi.cleanupPublishRelayAcks.mockRejectedValue("nope");

    await expect(
      purgePublishRelayAcksAdmin({
        olderThanDays: 14,
        operatorNpub: "npub-operator",
      })
    ).resolves.toEqual({
      ok: false,
      error: "Failed to purge relay acknowledgements",
    });
  });
});
