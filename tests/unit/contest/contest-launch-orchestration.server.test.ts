// @ts-nocheck -- mocked collaborators are narrower than the production types.
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const query = () => vi.fn<(...args: unknown[]) => Promise<unknown>>();
  return {
    $transaction:
      vi.fn<
        (callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>
      >(),
    contestLaunchOrchestration: {
      upsert: query(),
      findUnique: query(),
      findFirst: query(),
      findMany: query(),
      update: query(),
      updateMany: query(),
    },
    contest: { update: query() },
    post: { update: query() },
  };
});

const posts = vi.hoisted(() => ({
  getPostById: vi.fn(),
}));

const queue = vi.hoisted(() => ({
  cancelPostJob: vi.fn(),
  enqueuePostJob: vi.fn(),
}));

const actions = vi.hoisted(() => ({
  appendContestEventLog: vi.fn(),
  getContestById: vi.fn(),
  launchContest: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));
vi.mock("~/features/posts/server", () => posts);
vi.mock("~/infra/queue", () => queue);
vi.mock("~/features/contest/contest-actions.server", () => actions);

import {
  anyDate,
  anything,
  asReturn,
  buildContest,
  match,
  omitMatch,
  signedPostEvent,
} from "./contest-test-doubles";

import {
  appendContestEventLog,
  getContestById,
  launchContest,
} from "~/features/contest/contest-actions.server";
import {
  findOrchestrationByContestId,
  findOrchestrationBySourcePostId,
  getScheduledContestLaunchesForUser,
  markSourcePublishFailed,
  maybeActivateContestAfterSourcePostPublish,
  processDueScheduledContestLaunches,
  rescheduleContestLaunchOrchestration,
  retryContestLaunchOrchestration,
  upsertContestLaunchOrchestration,
} from "~/features/contest/repositories/contest-launch-orchestration.server";
import { getPostById } from "~/features/posts/server";
import { cancelPostJob, enqueuePostJob } from "~/infra/queue";

interface ActivateTx {
  contest: { update: ReturnType<typeof vi.fn> };
  contestLaunchOrchestration: { update: ReturnType<typeof vi.fn> };
}

function isTxCallback(
  value: unknown
): value is (tx: ActivateTx) => Promise<unknown> {
  return typeof value === "function";
}

const future = new Date("2099-07-01T00:00:00.000Z");

describe("contest launch orchestration", () => {
  const tx: ActivateTx = {
    contest: { update: vi.fn() },
    contestLaunchOrchestration: { update: vi.fn() },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => {
      if (!isTxCallback(callback)) {
        throw new Error("expected transaction callback");
      }
      return callback(tx);
    });
  });

  it("upserts with and without an idempotency key", async () => {
    const base = {
      userId: "user-1",
      contestId: "contest-1",
      sourceMode: "new_post" as const,
      launchMode: "schedule" as const,
      scheduledFor: future,
      existingSourcePostId: null,
      sourcePostId: "post-1",
      sourcePostPublishStatus: "scheduled" as const,
      contestActivationStatus: "scheduled" as const,
    };
    await upsertContestLaunchOrchestration(base);
    await upsertContestLaunchOrchestration({ ...base, idempotencyKey: null });
    await upsertContestLaunchOrchestration({
      ...base,
      idempotencyKey: "idem-1",
    });

    expect(
      prismaMock.contestLaunchOrchestration.upsert
    ).toHaveBeenNthCalledWith(
      1,
      match({
        where: { contestId: "contest-1" },
        create: match({ idempotencyKey: undefined }),
        update: omitMatch({
          idempotencyKey: anything(),
        }),
      })
    );
    expect(
      prismaMock.contestLaunchOrchestration.upsert
    ).toHaveBeenNthCalledWith(
      3,
      match({
        create: match({ idempotencyKey: "idem-1" }),
        update: match({ idempotencyKey: "idem-1" }),
      })
    );
  });

  it("finds orchestration by contest and source post, including misses", async () => {
    prismaMock.contestLaunchOrchestration.findUnique.mockResolvedValueOnce(
      null
    );
    prismaMock.contestLaunchOrchestration.findFirst.mockResolvedValueOnce({
      id: "orch-1",
    });
    await expect(findOrchestrationByContestId("contest-1")).resolves.toBeNull();
    await expect(findOrchestrationBySourcePostId("post-1")).resolves.toEqual({
      id: "orch-1",
    });
    expect(
      prismaMock.contestLaunchOrchestration.findUnique
    ).toHaveBeenCalledWith({ where: { contestId: "contest-1" } });
    expect(
      prismaMock.contestLaunchOrchestration.findFirst
    ).toHaveBeenCalledWith({
      where: { sourcePostId: "post-1" },
    });
  });

  it("activates after publish, records launch failure, and catches activation errors", async () => {
    prismaMock.contestLaunchOrchestration.findFirst.mockResolvedValueOnce(null);
    await expect(
      maybeActivateContestAfterSourcePostPublish({
        postId: "post-1",
        userId: "user-1",
        publishedEventId: "event-1",
      })
    ).resolves.toEqual({ activated: false });

    prismaMock.contestLaunchOrchestration.findFirst.mockResolvedValueOnce({
      id: "orch-1",
      contestId: "contest-1",
      contestActivationStatus: "active",
      contest: buildContest(),
    });
    await expect(
      maybeActivateContestAfterSourcePostPublish({
        postId: "post-1",
        userId: "user-1",
        publishedEventId: "event-1",
      })
    ).resolves.toEqual({ activated: false, contestId: "contest-1" });

    prismaMock.contestLaunchOrchestration.findFirst.mockResolvedValueOnce({
      id: "orch-1",
      contestId: "contest-1",
      contestActivationStatus: "scheduled",
      contest: buildContest({ userId: "other-user" }),
    });
    await expect(
      maybeActivateContestAfterSourcePostPublish({
        postId: "post-1",
        userId: "user-1",
        publishedEventId: "event-1",
      })
    ).resolves.toEqual({ activated: false });

    prismaMock.contestLaunchOrchestration.findFirst.mockResolvedValueOnce({
      id: "orch-1",
      contestId: "contest-1",
      contestActivationStatus: "scheduled",
      contest: buildContest(),
    });
    vi.mocked(launchContest).mockResolvedValueOnce({ success: true });
    await expect(
      maybeActivateContestAfterSourcePostPublish({
        postId: "post-1",
        userId: "user-1",
        publishedEventId: "event-1",
      })
    ).resolves.toEqual({ activated: true, contestId: "contest-1" });
    expect(
      prismaMock.contestLaunchOrchestration.findFirst
    ).toHaveBeenCalledWith({
      where: {
        sourcePostId: "post-1",
        userId: "user-1",
        sourceMode: "new_post",
      },
      include: { contest: true },
    });
    expect(launchContest).toHaveBeenCalledWith("user-1", "contest-1");
    expect(prismaMock.contestLaunchOrchestration.update).toHaveBeenCalledWith({
      where: { id: "orch-1" },
      data: { contestActivationStatus: "active" },
    });

    prismaMock.contestLaunchOrchestration.findFirst.mockResolvedValueOnce({
      id: "orch-1",
      contestId: "contest-1",
      contestActivationStatus: "scheduled",
      contest: buildContest(),
    });
    vi.mocked(launchContest).mockResolvedValueOnce({ success: false });
    await expect(
      maybeActivateContestAfterSourcePostPublish({
        postId: "post-1",
        userId: "user-1",
        publishedEventId: "event-1",
      })
    ).resolves.toEqual({ activated: false, contestId: "contest-1" });
    expect(prismaMock.contestLaunchOrchestration.update).toHaveBeenCalledWith({
      where: { id: "orch-1" },
      data: {
        contestActivationStatus: "failed",
        lastErrorCode: "launch_failed",
        lastErrorMessage: "Launch failed",
      },
    });

    prismaMock.contestLaunchOrchestration.findFirst.mockResolvedValueOnce({
      id: "orch-1",
      contestId: "contest-1",
      contestActivationStatus: "scheduled",
      contest: buildContest(),
    });
    vi.mocked(launchContest).mockResolvedValueOnce({
      success: false,
      error: "note missing",
    });
    await maybeActivateContestAfterSourcePostPublish({
      postId: "post-1",
      userId: "user-1",
      publishedEventId: "event-1",
    });
    expect(prismaMock.contestLaunchOrchestration.update).toHaveBeenCalledWith({
      where: { id: "orch-1" },
      data: match({ lastErrorMessage: "note missing" }),
    });

    prismaMock.contestLaunchOrchestration.findFirst.mockResolvedValueOnce({
      id: "orch-1",
      contestId: "contest-1",
      contestActivationStatus: "scheduled",
      contest: buildContest(),
    });
    prismaMock.$transaction.mockRejectedValueOnce(new Error("db down"));
    await expect(
      maybeActivateContestAfterSourcePostPublish({
        postId: "post-1",
        userId: "user-1",
        publishedEventId: "event-1",
      })
    ).resolves.toEqual({ activated: false, contestId: "contest-1" });
    expect(prismaMock.contestLaunchOrchestration.update).toHaveBeenCalledWith({
      where: { id: "orch-1" },
      data: {
        contestActivationStatus: "failed",
        lastErrorCode: "activation_error",
        lastErrorMessage: "db down",
      },
    });

    prismaMock.contestLaunchOrchestration.findFirst.mockResolvedValueOnce({
      id: "orch-1",
      contestId: "contest-1",
      contestActivationStatus: "scheduled",
      contest: buildContest(),
    });
    prismaMock.$transaction.mockRejectedValueOnce("bad");
    await maybeActivateContestAfterSourcePostPublish({
      postId: "post-1",
      userId: "user-1",
      publishedEventId: "event-1",
    });
    expect(prismaMock.contestLaunchOrchestration.update).toHaveBeenCalledWith({
      where: { id: "orch-1" },
      data: match({ lastErrorMessage: "bad" }),
    });
  });

  it("processes due scheduled launches and counts only successful ones", async () => {
    prismaMock.contestLaunchOrchestration.findMany.mockResolvedValueOnce([
      {
        id: "skip",
        userId: "user-1",
        contest: buildContest({ status: "LIVE" }),
      },
      {
        id: "no-post",
        userId: "user-1",
        contest: buildContest({
          id: "c-no-post",
          status: "SCHEDULED_LAUNCH",
          sourcePostId: null,
        }),
      },
      {
        id: "missing-post",
        userId: "user-1",
        contest: buildContest({
          id: "c-missing",
          status: "SCHEDULED_LAUNCH",
          sourcePostId: "missing",
        }),
      },
      {
        id: "blank-note",
        userId: "user-1",
        contest: buildContest({
          id: "c-blank",
          status: "SCHEDULED_LAUNCH",
          sourcePostId: "blank",
        }),
      },
      {
        id: "diff",
        userId: "user-1",
        contest: buildContest({
          id: "c-diff",
          status: "SCHEDULED_LAUNCH",
          sourcePostId: "diff",
          sourceNoteId: "old-note",
        }),
      },
      {
        id: "same",
        userId: "user-1",
        contest: buildContest({
          id: "c-same",
          status: "SCHEDULED_LAUNCH",
          sourcePostId: "same",
          sourceNoteId: "note-same",
        }),
      },
      {
        id: "fail-blank",
        userId: "user-1",
        contest: buildContest({
          id: "c-fail-blank",
          status: "SCHEDULED_LAUNCH",
          sourcePostId: "same",
          sourceNoteId: "note-same",
        }),
      },
    ]);
    vi.mocked(getPostById).mockImplementation(async ({ id }) => {
      if (id === "missing") return null;
      if (id === "blank") return asReturn({ id, nostrEventId: "  " });
      if (id === "diff") return asReturn({ id, nostrEventId: "note-diff" });
      if (id === "same") return asReturn({ id, nostrEventId: "note-same" });
      return null;
    });
    vi.mocked(launchContest).mockImplementation(async (_userId, contestId) => {
      if (contestId === "c-fail-blank") return { success: false };
      if (contestId === "c-same") return { success: false, error: "nope" };
      return { success: true };
    });

    await expect(processDueScheduledContestLaunches()).resolves.toEqual({
      processed: 1,
    });
    expect(prismaMock.contest.update).toHaveBeenCalledWith({
      where: { id: "c-diff" },
      data: { sourceNoteId: "note-diff" },
    });
    expect(prismaMock.contestLaunchOrchestration.update).toHaveBeenCalledWith({
      where: { id: "diff" },
      data: {
        contestActivationStatus: "active",
        sourcePostPublishStatus: "not_needed",
      },
    });
    expect(prismaMock.contestLaunchOrchestration.update).toHaveBeenCalledWith({
      where: { id: "no-post" },
      data: match({ lastErrorCode: "source_missing" }),
    });
    expect(prismaMock.contestLaunchOrchestration.update).toHaveBeenCalledWith({
      where: { id: "same" },
      data: match({
        lastErrorCode: "launch_failed",
        lastErrorMessage: "nope",
      }),
    });
    expect(prismaMock.contestLaunchOrchestration.update).toHaveBeenCalledWith({
      where: { id: "fail-blank" },
      data: match({ lastErrorMessage: "Launch failed" }),
    });
  });

  it("marks the source publish failed", async () => {
    await markSourcePublishFailed("contest-1", "relay rejected");
    expect(
      prismaMock.contestLaunchOrchestration.updateMany
    ).toHaveBeenCalledWith({
      where: { contestId: "contest-1" },
      data: {
        sourcePostPublishStatus: "failed",
        contestActivationStatus: "blocked_by_source_failure",
        lastErrorCode: "source_publish_failed",
        lastErrorMessage: "relay rejected",
      },
    });
  });

  it("retries only a recoverable contest whose source note is ready", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(null);
    await expect(
      retryContestLaunchOrchestration("user-1", "missing")
    ).resolves.toEqual({ success: false, error: "Contest not found" });

    vi.mocked(getContestById).mockResolvedValueOnce(buildContest());
    prismaMock.contestLaunchOrchestration.findUnique.mockResolvedValueOnce(
      null
    );
    await expect(
      retryContestLaunchOrchestration("user-1", "contest-1")
    ).resolves.toEqual({
      success: false,
      error: "No launch orchestration for this contest",
    });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "LIVE" })
    );
    prismaMock.contestLaunchOrchestration.findUnique.mockResolvedValueOnce({
      id: "orch-1",
    });
    await expect(
      retryContestLaunchOrchestration("user-1", "contest-1")
    ).resolves.toEqual({
      success: false,
      error: "Contest is not in a recoverable pre-launch state",
    });

    vi.mocked(getContestById).mockResolvedValue(
      buildContest({ status: "DRAFT", sourceNoteId: "   " })
    );
    prismaMock.contestLaunchOrchestration.findUnique.mockResolvedValue({
      id: "orch-1",
      sourcePostId: null,
    });
    await expect(
      retryContestLaunchOrchestration("user-1", "contest-1")
    ).resolves.toEqual({
      success: false,
      error:
        "Source note is not available yet. Publish or fix the source post, then try again.",
    });
    expect(launchContest).not.toHaveBeenCalled();

    vi.mocked(getContestById).mockResolvedValue(
      buildContest({
        status: "SCHEDULED_LAUNCH",
        sourceNoteId: null,
        sourcePostId: "post-from-contest",
      })
    );
    prismaMock.contestLaunchOrchestration.findUnique.mockResolvedValue({
      id: "orch-1",
      sourcePostId: null,
    });
    vi.mocked(getPostById).mockResolvedValueOnce(
      asReturn({ id: "post-from-contest", nostrEventId: "  event-1  " })
    );
    vi.mocked(getContestById)
      .mockResolvedValueOnce(
        buildContest({
          status: "SCHEDULED_LAUNCH",
          sourceNoteId: null,
          sourcePostId: "post-from-contest",
        })
      )
      .mockResolvedValueOnce(
        buildContest({
          status: "SCHEDULED_LAUNCH",
          sourceNoteId: "event-1",
        })
      );
    vi.mocked(launchContest).mockResolvedValueOnce({
      success: false,
      error: "still blocked",
    });
    await expect(
      retryContestLaunchOrchestration("user-1", "contest-1")
    ).resolves.toEqual({ success: false, error: "still blocked" });
    expect(prismaMock.contest.update).toHaveBeenCalledWith({
      where: { id: "contest-1" },
      data: { sourceNoteId: "event-1", sourcePostId: "post-from-contest" },
    });
    expect(appendContestEventLog).not.toHaveBeenCalled();

    vi.mocked(getContestById).mockResolvedValue(
      buildContest({ status: "DRAFT", sourceNoteId: "event-1" })
    );
    prismaMock.contestLaunchOrchestration.findUnique.mockResolvedValue({
      id: "orch-1",
      sourcePostId: "post-1",
    });
    vi.mocked(getPostById).mockResolvedValueOnce(null);
    vi.mocked(launchContest).mockResolvedValueOnce({ success: true });
    await expect(
      retryContestLaunchOrchestration("user-1", "contest-1")
    ).resolves.toEqual({ success: true });
    expect(appendContestEventLog).toHaveBeenCalledWith(
      "user-1",
      "contest-1",
      "contest_launch_retry",
      "Contest launched after retry"
    );
    expect(prismaMock.contestLaunchOrchestration.update).toHaveBeenCalledWith({
      where: { id: "orch-1" },
      data: { contestActivationStatus: "active" },
    });
  });

  it("reschedules a future launch and moves a scheduled source post", async () => {
    await expect(
      rescheduleContestLaunchOrchestration(
        "user-1",
        "contest-1",
        new Date("2020-01-01T00:00:00.000Z")
      )
    ).resolves.toEqual({ success: false, error: "Pick a time in the future." });

    vi.mocked(getContestById).mockResolvedValueOnce(null);
    await expect(
      rescheduleContestLaunchOrchestration("user-1", "missing", future)
    ).resolves.toEqual({ success: false, error: "Contest not found" });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "LIVE" })
    );
    await expect(
      rescheduleContestLaunchOrchestration("user-1", "contest-1", future)
    ).resolves.toEqual({
      success: false,
      error: "Only scheduled-launch contests can be rescheduled here.",
    });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "SCHEDULED_LAUNCH" })
    );
    prismaMock.contestLaunchOrchestration.findUnique.mockResolvedValueOnce(
      null
    );
    await expect(
      rescheduleContestLaunchOrchestration("user-1", "contest-1", future)
    ).resolves.toEqual({ success: false, error: "Not a scheduled launch." });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "SCHEDULED_LAUNCH" })
    );
    prismaMock.contestLaunchOrchestration.findUnique.mockResolvedValueOnce({
      id: "orch-1",
      launchMode: "now",
    });
    await expect(
      rescheduleContestLaunchOrchestration("user-1", "contest-1", future)
    ).resolves.toEqual({ success: false, error: "Not a scheduled launch." });

    vi.mocked(getContestById).mockResolvedValue(
      buildContest({ status: "SCHEDULED_LAUNCH" })
    );
    prismaMock.contestLaunchOrchestration.findUnique.mockResolvedValueOnce({
      id: "orch-1",
      launchMode: "schedule",
      sourceMode: "existing_post",
      sourcePostId: "post-1",
    });
    await expect(
      rescheduleContestLaunchOrchestration("user-1", "contest-1", future)
    ).resolves.toEqual({ success: true });
    expect(getPostById).not.toHaveBeenCalled();

    prismaMock.contestLaunchOrchestration.findUnique.mockResolvedValueOnce({
      id: "orch-1",
      launchMode: "schedule",
      sourceMode: "new_post",
      sourcePostId: null,
    });
    await rescheduleContestLaunchOrchestration("user-1", "contest-1", future);

    prismaMock.contestLaunchOrchestration.findUnique.mockResolvedValueOnce({
      id: "orch-1",
      launchMode: "schedule",
      sourceMode: "new_post",
      sourcePostId: "post-1",
    });
    vi.mocked(getPostById).mockResolvedValueOnce(null);
    await expect(
      rescheduleContestLaunchOrchestration("user-1", "contest-1", future)
    ).resolves.toEqual({ success: false, error: "Source post not found." });

    prismaMock.contestLaunchOrchestration.findUnique.mockResolvedValueOnce({
      id: "orch-1",
      launchMode: "schedule",
      sourceMode: "new_post",
      sourcePostId: "post-1",
    });
    vi.mocked(getPostById).mockResolvedValueOnce(
      asReturn({ id: "post-1", currentState: "PUBLISHED", signedEvent: null })
    );
    await rescheduleContestLaunchOrchestration("user-1", "contest-1", future);
    expect(prismaMock.post.update).not.toHaveBeenCalled();

    prismaMock.contestLaunchOrchestration.findUnique.mockResolvedValueOnce({
      id: "orch-1",
      launchMode: "schedule",
      sourceMode: "new_post",
      sourcePostId: "post-1",
    });
    vi.mocked(getPostById).mockResolvedValueOnce(
      asReturn({
        id: "post-1",
        currentState: "SCHEDULED",
        signedEvent: { nope: true },
      })
    );
    await rescheduleContestLaunchOrchestration("user-1", "contest-1", future);
    expect(prismaMock.post.update).toHaveBeenCalledWith({
      where: { id: "post-1", userId: "user-1" },
      data: { scheduledAtUtc: future, updatedAt: anyDate() },
    });
    expect(enqueuePostJob).not.toHaveBeenCalled();

    prismaMock.contestLaunchOrchestration.findUnique.mockResolvedValueOnce({
      id: "orch-1",
      launchMode: "schedule",
      sourceMode: "new_post",
      sourcePostId: "post-1",
    });
    vi.mocked(getPostById).mockResolvedValueOnce(
      asReturn({
        id: "post-1",
        currentState: "SCHEDULED",
        signedEvent: signedPostEvent,
      })
    );
    await expect(
      rescheduleContestLaunchOrchestration("user-1", "contest-1", future)
    ).resolves.toEqual({ success: true });
    expect(cancelPostJob).toHaveBeenCalledWith("post-1");
    expect(enqueuePostJob).toHaveBeenCalledWith(
      "post-1",
      "user-1",
      signedPostEvent,
      Math.floor(future.getTime() / 1000)
    );
    expect(appendContestEventLog).toHaveBeenCalledWith(
      "user-1",
      "contest-1",
      "contest_launch_rescheduled",
      `Scheduled launch moved to ${future.toISOString()}`
    );
  });

  it("lists scheduled launches for a user, including an empty title", async () => {
    prismaMock.contestLaunchOrchestration.findMany.mockResolvedValueOnce([]);
    await expect(getScheduledContestLaunchesForUser("user-1")).resolves.toEqual(
      []
    );

    const from = new Date("2099-01-01T00:00:00.000Z");
    const to = new Date("2099-12-01T00:00:00.000Z");
    prismaMock.contestLaunchOrchestration.findMany.mockResolvedValueOnce([
      {
        id: "orch-1",
        contestId: "abcdefghijklmn",
        sourceMode: "new_post",
        contestActivationStatus: "scheduled",
        scheduledFor: future,
        contest: { id: "abcdefghijklmn", title: "  Hello  " },
      },
      {
        id: "orch-2",
        contestId: "abcdefghijklmn",
        sourceMode: "existing_post",
        contestActivationStatus: "failed",
        scheduledFor: null,
        contest: { id: "abcdefghijklmn", title: "   " },
      },
      {
        id: "orch-3",
        contestId: "abcdefghijklmn",
        sourceMode: "new_post",
        contestActivationStatus: "activating",
        scheduledFor: future,
        contest: { id: "abcdefghijklmn", title: null },
      },
    ]);
    await expect(
      getScheduledContestLaunchesForUser("user-1", { fromUtc: from, toUtc: to })
    ).resolves.toEqual([
      {
        id: "orch-1",
        contestId: "abcdefghijklmn",
        title: "Hello",
        scheduledFor: future.toISOString(),
        sourceMode: "new_post",
        contestActivationStatus: "scheduled",
      },
      {
        id: "orch-2",
        contestId: "abcdefghijklmn",
        title: "Contest abcdefgh",
        scheduledFor: null,
        sourceMode: "existing_post",
        contestActivationStatus: "failed",
      },
      {
        id: "orch-3",
        contestId: "abcdefghijklmn",
        title: "Contest abcdefgh",
        scheduledFor: future.toISOString(),
        sourceMode: "new_post",
        contestActivationStatus: "activating",
      },
    ]);

    prismaMock.contestLaunchOrchestration.findMany.mockResolvedValue([]);
    await getScheduledContestLaunchesForUser("user-1", { fromUtc: from });
    await getScheduledContestLaunchesForUser("user-1", { toUtc: to });
    expect(prismaMock.contestLaunchOrchestration.findMany).toHaveBeenCalledWith(
      match({
        where: match({
          userId: "user-1",
          launchMode: "schedule",
          contest: { status: "SCHEDULED_LAUNCH" },
          contestActivationStatus: {
            in: [
              "scheduled",
              "activating",
              "failed",
              "blocked_by_source_failure",
            ],
          },
          scheduledFor: { not: null, gte: from, lte: to },
        }),
        orderBy: { scheduledFor: "asc" },
      })
    );
  });
});
