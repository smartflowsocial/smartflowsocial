import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  contestEventLog: {
    create: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  },
}));

const queries = vi.hoisted(() => ({
  getContestById: vi.fn(),
}));

const dataApi = vi.hoisted(() => ({
  createContest: vi.fn(),
  deleteContest: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));
vi.mock("~/features/contest/contest-actions-queries.server", () => queries);
vi.mock(
  "~/features/contest/repositories/contest-actions-data.server",
  () => dataApi
);

import { buildContest } from "./contest-test-doubles";

import { DEFAULT_TIE_BREAK_RULE } from "~/features/contest/contest-actions-constants.server";
import {
  appendContestEventLog,
  createContest,
  deleteContest,
  duplicateContest,
} from "~/features/contest/contest-actions-crud.server";
import { getContestById } from "~/features/contest/contest-actions-queries.server";
import {
  createContest as createContestRow,
  deleteContest as deleteContestRow,
} from "~/features/contest/repositories/contest-actions-data.server";

describe("createContest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createContestRow).mockResolvedValue(buildContest({ id: "new" }));
  });

  it("stores an equal draft and clamps the winner count and rewards", async () => {
    await createContest("user-1", {
      title: "  ",
      sourceNoteId: "  ",
      rankingMetric: "ZAPS",
      contestEndAt: new Date("2026-07-01T00:00:00.000Z"),
      prizeMode: "EQUAL",
      winnerCount: 0,
      equalRewardSats: null,
      fairnessConfig: null,
    });

    const created = vi.mocked(createContestRow).mock.calls[0]?.[0];
    expect(created?.title).toBeNull();
    expect(created?.sourceNoteId).toBeNull();
    expect(created?.sourcePostId).toBeNull();
    expect(created?.contestStartAt).toBeNull();
    expect(created?.winnerCount).toBe(1);
    expect(created?.equalRewardSats).toBe(0);
    expect(created?.rankRewards).toBe(Prisma.JsonNull);
    expect(created?.fairnessConfig).toBeUndefined();
    expect(created?.status).toBe("DRAFT");
    expect(created?.tieBreakRule).toBe(DEFAULT_TIE_BREAK_RULE);
    expect(created?.entryType).toBe("REPLY_DIRECT");
    expect(created?.eventLogs).toEqual({
      create: {
        eventType: "contest_created",
        message: "Contest created as draft",
      },
    });
  });

  it("stores ranked rewards, a trimmed note, and a scheduled launch", async () => {
    const end = new Date("2026-07-01T00:00:00.000Z");
    const start = new Date("2026-06-01T00:00:00.000Z");
    const rewards = [{ rank: 1, sats: 500 }];
    await createContest("user-1", {
      title: "  Ranked  ",
      sourceNoteId: "  note-1  ",
      sourcePostId: "post-1",
      rankingMetric: "REACTIONS",
      contestStartAt: start,
      contestEndAt: end,
      prizeMode: "RANKED",
      winnerCount: 80,
      equalRewardSats: 999,
      rankRewards: rewards,
      fairnessConfig: { excludeMuted: true },
      status: "SCHEDULED_LAUNCH",
    });

    const created = vi.mocked(createContestRow).mock.calls[0]?.[0];
    expect(created).toMatchObject({
      title: "Ranked",
      sourceNoteId: "note-1",
      sourcePostId: "post-1",
      contestStartAt: start,
      contestEndAt: end,
      winnerCount: 50,
      equalRewardSats: null,
      rankRewards: rewards,
      fairnessConfig: { excludeMuted: true },
      status: "SCHEDULED_LAUNCH",
    });
  });

  it("propagates a repository failure", async () => {
    vi.mocked(createContestRow).mockRejectedValueOnce(new Error("db down"));
    await expect(
      createContest("user-1", {
        sourceNoteId: "note-1",
        rankingMetric: "ZAPS",
        contestEndAt: new Date("2026-07-01T00:00:00.000Z"),
        prizeMode: "EQUAL",
        winnerCount: 1,
      })
    ).rejects.toThrow("db down");
  });
});

describe("duplicateContest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createContestRow).mockResolvedValue(buildContest({ id: "copy" }));
  });

  it("returns not found when the source contest is missing", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(null);
    await expect(duplicateContest("user-1", "missing")).resolves.toEqual({
      success: false,
      error: "Contest not found",
    });
    expect(createContestRow).not.toHaveBeenCalled();
  });

  it("copies an equal contest with a blank title and a missing tie-break", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({
        title: null,
        prizeMode: "EQUAL",
        winnerCount: 0,
        equalRewardSats: null,
        tieBreakRule: null,
        fairnessConfig: null,
        sourceNoteId: "note-1",
        sourcePostId: "post-1",
      })
    );

    await expect(duplicateContest("user-1", "contest-1")).resolves.toEqual({
      success: true,
      newId: "copy",
    });
    const created = vi.mocked(createContestRow).mock.calls[0]?.[0];
    expect(created?.title).toBeNull();
    expect(created?.contestStartAt).toBeNull();
    expect(created?.winnerCount).toBe(1);
    expect(created?.equalRewardSats).toBe(0);
    expect(created?.rankRewards).toBe(Prisma.JsonNull);
    expect(created?.tieBreakRule).toBe(DEFAULT_TIE_BREAK_RULE);
    expect(created?.status).toBe("DRAFT");
    expect(created?.fairnessConfig).toBeUndefined();
  });

  it("copies ranked rewards and appends (copy) to the title", async () => {
    const rewards = [{ rank: 1, sats: 40 }];
    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({
        title: "Original",
        prizeMode: "RANKED",
        winnerCount: 90,
        rankRewards: rewards,
        tieBreakRule: "custom",
        fairnessConfig: { excludeBlocked: true },
      })
    );

    await duplicateContest("user-1", "contest-1");
    const created = vi.mocked(createContestRow).mock.calls[0]?.[0];
    expect(created).toMatchObject({
      title: "Original (copy)",
      winnerCount: 50,
      equalRewardSats: null,
      rankRewards: rewards,
      tieBreakRule: "custom",
      fairnessConfig: { excludeBlocked: true },
    });
    expect(created?.eventLogs).toMatchObject({
      create: {
        eventType: "contest_duplicated",
        message: "Duplicated from contest contest-",
      },
    });
  });
});

describe("deleteContest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns not found and refuses locked, paying, and completed contests", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(null);
    await expect(deleteContest("user-1", "missing")).resolves.toEqual({
      success: false,
      error: "Contest not found",
    });

    for (const status of [
      "LOCKED",
      "PAYOUT_IN_PROGRESS",
      "COMPLETED",
    ] as const) {
      vi.mocked(getContestById).mockResolvedValueOnce(buildContest({ status }));
      await expect(deleteContest("user-1", "contest-1")).resolves.toEqual({
        success: false,
        error: "Cannot delete locked/completed contest",
      });
    }
    expect(deleteContestRow).not.toHaveBeenCalled();
  });

  it("deletes a draft contest", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "DRAFT" })
    );
    await expect(deleteContest("user-1", "contest-1")).resolves.toEqual({
      success: true,
    });
    expect(deleteContestRow).toHaveBeenCalledWith("contest-1");
  });
});

describe("appendContestEventLog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("does nothing when the contest is missing", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(null);
    await appendContestEventLog("user-1", "missing", "x", "message");
    expect(prismaMock.contestEventLog.create).not.toHaveBeenCalled();
  });

  it("writes the log with and without metadata", async () => {
    vi.mocked(getContestById).mockResolvedValue(buildContest());
    await appendContestEventLog("user-1", "contest-1", "launched", "Live");
    await appendContestEventLog("user-1", "contest-1", "note", "Saved", {
      ok: true,
    });

    expect(prismaMock.contestEventLog.create).toHaveBeenNthCalledWith(1, {
      data: {
        contestId: "contest-1",
        eventType: "launched",
        message: "Live",
        metadata: undefined,
      },
    });
    expect(prismaMock.contestEventLog.create).toHaveBeenNthCalledWith(2, {
      data: {
        contestId: "contest-1",
        eventType: "note",
        message: "Saved",
        metadata: { ok: true },
      },
    });
  });
});
