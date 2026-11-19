import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const query = () => vi.fn<(...args: unknown[]) => Promise<unknown>>();
  return {
    contest: { groupBy: query() },
    contestEntry: { groupBy: query() },
    post: { findMany: query() },
  };
});

const dataApi = vi.hoisted(() => ({
  findContestByIdAndUser: vi.fn(),
  findContestByIdPublic: vi.fn(),
  listContestsByUser: vi.fn(),
  listContestsByUserWithFilters: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));
vi.mock(
  "~/features/contest/repositories/contest-actions-data.server",
  () => dataApi
);

import { buildContest } from "./contest-test-doubles";

import {
  getContestById,
  getContestByIdPublic,
  getContestEntryCounts,
  getContestKpiCounts,
  getContestSourcePostThumbnails,
  listContests,
  listContestsFiltered,
} from "~/features/contest/contest-actions-queries.server";

describe("contest action queries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("delegates contest lookups and lists, including a missing contest", async () => {
    const row = buildContest();
    dataApi.findContestByIdAndUser.mockResolvedValueOnce(null);
    dataApi.findContestByIdPublic.mockResolvedValueOnce(row);
    dataApi.listContestsByUser.mockResolvedValueOnce([row]);
    dataApi.listContestsByUserWithFilters.mockResolvedValueOnce([]);

    await expect(getContestById("missing", "user-1")).resolves.toBeNull();
    await expect(getContestByIdPublic("contest-1")).resolves.toBe(row);
    await expect(listContests("user-1")).resolves.toEqual([row]);
    await expect(
      listContestsFiltered("user-1", {
        status: "LIVE",
        metric: "ZAPS",
        sort: "ending",
      })
    ).resolves.toEqual([]);

    expect(dataApi.findContestByIdAndUser).toHaveBeenCalledWith(
      "missing",
      "user-1"
    );
    expect(dataApi.findContestByIdPublic).toHaveBeenCalledWith("contest-1");
    expect(dataApi.listContestsByUser).toHaveBeenCalledWith("user-1");
    expect(dataApi.listContestsByUserWithFilters).toHaveBeenCalledWith(
      "user-1",
      { status: "LIVE", metric: "ZAPS", sort: "ending" }
    );
  });

  it("maps status counts and returns an empty map when the user has none", async () => {
    prismaMock.contest.groupBy.mockResolvedValueOnce([]);
    await expect(getContestKpiCounts("user-1")).resolves.toEqual({});

    prismaMock.contest.groupBy.mockResolvedValueOnce([
      { status: "LIVE", _count: { _all: 2 } },
      { status: "DRAFT", _count: { _all: 1 } },
    ]);
    await expect(getContestKpiCounts("user-1")).resolves.toEqual({
      LIVE: 2,
      DRAFT: 1,
    });
    expect(prismaMock.contest.groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { userId: "user-1" },
      _count: { _all: true },
    });
  });

  it("returns no entry counts without querying when the id list is empty", async () => {
    await expect(getContestEntryCounts("user-1", [])).resolves.toEqual({});
    expect(prismaMock.contestEntry.groupBy).not.toHaveBeenCalled();
  });

  it("maps entry counts for the requested contests", async () => {
    prismaMock.contestEntry.groupBy.mockResolvedValueOnce([
      { contestId: "contest-1", _count: { _all: 4 } },
    ]);
    await expect(
      getContestEntryCounts("user-1", ["contest-1", "contest-2"])
    ).resolves.toEqual({ "contest-1": 4 });
    expect(prismaMock.contestEntry.groupBy).toHaveBeenCalledWith({
      by: ["contestId"],
      where: {
        contestId: { in: ["contest-1", "contest-2"] },
        contest: { userId: "user-1" },
      },
      _count: { _all: true },
    });
  });

  it("returns no thumbnails without querying when there are no posts", async () => {
    await expect(getContestSourcePostThumbnails("user-1", [])).resolves.toEqual(
      {}
    );
    expect(prismaMock.post.findMany).not.toHaveBeenCalled();
  });

  it("keeps the first trimmed image and treats blank urls as missing", async () => {
    prismaMock.post.findMany.mockResolvedValueOnce([
      { id: "p1", fileUrl: [" https://cdn.example/a.png "] },
      { id: "p2", fileUrl: ["   "] },
      { id: "p3", fileUrl: [] },
      { id: "p4", fileUrl: [""] },
    ]);

    await expect(
      getContestSourcePostThumbnails("user-1", ["p1", "p2", "p3", "p4"])
    ).resolves.toEqual({
      p1: "https://cdn.example/a.png",
      p2: null,
      p3: null,
      p4: null,
    });
    expect(prismaMock.post.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", id: { in: ["p1", "p2", "p3", "p4"] } },
      select: { id: true, fileUrl: true },
    });
  });
});
