import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const query = () => vi.fn<(...args: unknown[]) => Promise<unknown>>();
  return {
    contest: {
      findFirst: query(),
      findMany: query(),
      create: query(),
      update: query(),
      delete: query(),
    },
  };
});

vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));

import { asReturn, buildContest } from "../contest-test-doubles";

import type { Prisma } from "~/features/contest/data/contest-prisma-types.server";
import {
  createContest,
  deleteContest,
  findContestByIdAndUser,
  findContestByIdPublic,
  listContestsByUser,
  listContestsByUserWithFilters,
  updateContest,
} from "~/features/contest/repositories/contest-actions-data.server";

const row = buildContest();

describe("contest actions data repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("finds a contest by id and user and returns null when it is missing", async () => {
    prismaMock.contest.findFirst.mockResolvedValueOnce(row);
    await expect(findContestByIdAndUser("contest-1", "user-1")).resolves.toBe(
      row
    );
    expect(prismaMock.contest.findFirst).toHaveBeenCalledWith({
      where: { id: "contest-1", userId: "user-1" },
    });

    prismaMock.contest.findFirst.mockResolvedValueOnce(null);
    await expect(
      findContestByIdAndUser("missing", "user-1")
    ).resolves.toBeNull();
  });

  it("finds a public contest by id only", async () => {
    prismaMock.contest.findFirst.mockResolvedValueOnce(null);
    await expect(findContestByIdPublic("contest-1")).resolves.toBeNull();
    expect(prismaMock.contest.findFirst).toHaveBeenCalledWith({
      where: { id: "contest-1" },
    });
  });

  it("lists a user's contests newest first, including an empty list", async () => {
    prismaMock.contest.findMany.mockResolvedValueOnce([]);
    await expect(listContestsByUser("user-1")).resolves.toEqual([]);
    expect(prismaMock.contest.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("ignores all-status and all-metric filters and defaults the sort to newest", async () => {
    prismaMock.contest.findMany.mockResolvedValue([row]);
    await expect(
      listContestsByUserWithFilters("user-1", {
        status: "all",
        metric: "all",
      })
    ).resolves.toEqual([row]);
    expect(prismaMock.contest.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("filters status and metric and sorts by ending or completion", async () => {
    prismaMock.contest.findMany.mockResolvedValue([]);
    await listContestsByUserWithFilters("user-1", {
      status: "LIVE",
      metric: "ZAPS",
      sort: "ending",
    });
    expect(prismaMock.contest.findMany).toHaveBeenLastCalledWith({
      where: { userId: "user-1", status: "LIVE", rankingMetric: "ZAPS" },
      orderBy: { contestEndAt: "asc" },
    });

    await listContestsByUserWithFilters("user-1", { sort: "completed" });
    expect(prismaMock.contest.findMany).toHaveBeenLastCalledWith({
      where: { userId: "user-1" },
      orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
    });

    await listContestsByUserWithFilters("user-1", { sort: "newest" });
    expect(prismaMock.contest.findMany).toHaveBeenLastCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("creates, updates, and deletes by forwarding the prisma payload", async () => {
    const created = asReturn<Prisma.ContestCreateInput>({ title: "Next" });
    const updated = asReturn<Prisma.ContestUpdateInput>({ title: "Next" });
    prismaMock.contest.create.mockResolvedValue(row);
    prismaMock.contest.update.mockResolvedValue(row);
    prismaMock.contest.delete.mockResolvedValue(row);

    await expect(createContest(created)).resolves.toBe(row);
    await expect(updateContest("contest-1", updated)).resolves.toBe(row);
    await expect(deleteContest("contest-1")).resolves.toBe(row);

    expect(prismaMock.contest.create).toHaveBeenCalledWith({ data: created });
    expect(prismaMock.contest.update).toHaveBeenCalledWith({
      where: { id: "contest-1" },
      data: updated,
    });
    expect(prismaMock.contest.delete).toHaveBeenCalledWith({
      where: { id: "contest-1" },
    });
  });
});
