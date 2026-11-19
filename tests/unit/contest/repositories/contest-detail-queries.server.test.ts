import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const query = () => vi.fn<(...args: unknown[]) => Promise<unknown>>();
  return {
    contestWinner: { findMany: query() },
    contestEntry: { findMany: query() },
    contestSnapshot: { findFirst: query() },
    contestEventLog: { findMany: query() },
    contest: { count: query() },
    contestLaunchOrchestration: { findUnique: query() },
  };
});

vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));

import {
  countContestsByUserAndStatus,
  findContestEntriesForDetail,
  findContestEventLogs,
  findContestLaunchOrchestrationForDetail,
  findContestWinnersWithEntries,
  findLatestContestSnapshot,
} from "~/features/contest/repositories/contest-detail-queries.server";

describe("contest detail queries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("loads winners with entries, including an empty result", async () => {
    prismaMock.contestWinner.findMany.mockResolvedValueOnce([]);
    await expect(findContestWinnersWithEntries("contest-1")).resolves.toEqual(
      []
    );
    expect(prismaMock.contestWinner.findMany).toHaveBeenCalledWith({
      where: { contestId: "contest-1" },
      include: { entry: true },
      orderBy: [{ isAlternate: "asc" }, { rank: "asc" }],
    });
  });

  it("optionally hides excluded entries and caps the leaderboard", async () => {
    prismaMock.contestEntry.findMany.mockResolvedValue([]);
    await findContestEntriesForDetail("contest-1", { includeExcluded: false });
    expect(prismaMock.contestEntry.findMany).toHaveBeenLastCalledWith({
      where: { contestId: "contest-1", isExcluded: false },
      orderBy: [{ rank: "asc" }, { score: "desc" }],
      take: 200,
    });

    await findContestEntriesForDetail("contest-1", { includeExcluded: true });
    expect(prismaMock.contestEntry.findMany).toHaveBeenLastCalledWith({
      where: { contestId: "contest-1" },
      orderBy: [{ rank: "asc" }, { score: "desc" }],
      take: 200,
    });
  });

  it("returns null when the contest has no snapshot", async () => {
    prismaMock.contestSnapshot.findFirst.mockResolvedValueOnce(null);
    await expect(findLatestContestSnapshot("contest-1")).resolves.toBeNull();
    expect(prismaMock.contestSnapshot.findFirst).toHaveBeenCalledWith({
      where: { contestId: "contest-1" },
      orderBy: { snapshotAt: "desc" },
    });
  });

  it("loads event logs with the default take and a caller-supplied take", async () => {
    prismaMock.contestEventLog.findMany.mockResolvedValue([]);
    await findContestEventLogs("contest-1");
    expect(prismaMock.contestEventLog.findMany).toHaveBeenLastCalledWith({
      where: { contestId: "contest-1" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    await findContestEventLogs("contest-1", 5);
    expect(prismaMock.contestEventLog.findMany).toHaveBeenLastCalledWith({
      where: { contestId: "contest-1" },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
  });

  it("counts contests for a user and status", async () => {
    prismaMock.contest.count.mockResolvedValueOnce(0);
    await expect(countContestsByUserAndStatus("user-1", "LIVE")).resolves.toBe(
      0
    );
    expect(prismaMock.contest.count).toHaveBeenCalledWith({
      where: { userId: "user-1", status: "LIVE" },
    });
  });

  it("loads launch orchestration by contest id", async () => {
    prismaMock.contestLaunchOrchestration.findUnique.mockResolvedValueOnce(
      null
    );
    await expect(
      findContestLaunchOrchestrationForDetail("contest-1")
    ).resolves.toBeNull();
    expect(
      prismaMock.contestLaunchOrchestration.findUnique
    ).toHaveBeenCalledWith({
      where: { contestId: "contest-1" },
    });
  });
});
