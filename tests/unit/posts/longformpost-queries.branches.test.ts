import { beforeEach, describe, expect, it, vi } from "vitest";

interface CountArgs {
  where: Record<string, unknown>;
}

interface FindFirstArgs {
  orderBy?: unknown;
  select?: unknown;
  where: Record<string, unknown>;
}

interface FindManyArgs {
  include?: unknown;
  orderBy?: unknown;
  select?: unknown;
  skip?: number;
  take?: number;
  where: Record<string, unknown>;
}

interface GroupArgs {
  by: string[];
  where: Record<string, unknown>;
}

interface GroupRow {
  _count: { id: number };
  queueTypeId: string | null;
}

const logger = vi.hoisted(() => ({
  logError: vi.fn(),
}));

const db = vi.hoisted(() => ({
  count: vi.fn<(args: CountArgs) => Promise<number>>(async () => 0),
  findFirst: vi.fn<(args: FindFirstArgs) => Promise<unknown>>(async () => null),
  findMany: vi.fn<(args: FindManyArgs) => Promise<unknown[]>>(async () => []),
  groupBy: vi.fn<(args: GroupArgs) => Promise<GroupRow[]>>(async () => []),
}));

vi.mock("~/lib/error-logger.server", () => logger);
vi.mock("~/lib/prisma.server", () => ({
  prisma: {
    longFormPost: {
      count: db.count,
      findFirst: db.findFirst,
      findMany: db.findMany,
      groupBy: db.groupBy,
    },
  },
}));

import {
  getCronDueScheduledLongFormPosts,
  getDraftLongFormPosts,
  getLatestScheduledLongFormAtUtc,
  getLongFormPost,
  getLongFormPostByEventId,
  getLongFormPostsByIds,
  getLongFormStatistics,
  getPastLongFormPosts,
  getPublishedLongFormPosts,
  getScheduledLongFormCountByQueue,
  getScheduledLongFormPosts,
  getScheduledLongFormPostsInDateRange,
  getUserLongFormPosts,
} from "~/features/posts/data/longformpost.queries.server";

const USER = "user-1";
const START = new Date("2026-01-01T00:00:00.000Z");
const END = new Date("2026-01-31T00:00:00.000Z");
const CURSOR = new Date("2026-01-10T00:00:00.000Z");

function manyArgs(): FindManyArgs {
  const args = db.findMany.mock.calls.at(-1)?.[0];
  if (!args) throw new Error("expected findMany");
  return args;
}

function countWhere(index = 0): Record<string, unknown> {
  const args = db.count.mock.calls[index]?.[0];
  if (!args) throw new Error("expected count");
  return args.where;
}

function dateMillis(value: unknown): number {
  if (!(value instanceof Date)) throw new Error("expected date");
  return value.getTime();
}

describe("longform post query branches", () => {
  beforeEach(() => {
    db.count.mockReset();
    db.findFirst.mockReset();
    db.findMany.mockReset();
    db.groupBy.mockReset();
    db.count.mockResolvedValue(0);
    db.findFirst.mockResolvedValue(null);
    db.findMany.mockResolvedValue([]);
    db.groupBy.mockResolvedValue([]);
    logger.logError.mockReset();
  });

  it("reads one post and looks up an event id only when it is present", async () => {
    db.findFirst.mockResolvedValue({ id: "lf-1" });
    await expect(
      getLongFormPost({ id: "lf-1", userId: USER })
    ).resolves.toEqual({
      id: "lf-1",
    });
    expect(db.findFirst.mock.calls[0]?.[0]).toEqual({
      where: { id: "lf-1", userId: USER },
      include: { queueType: true },
    });

    db.findFirst.mockClear();
    await expect(
      getLongFormPostByEventId({ nostrEventId: "", userId: USER })
    ).resolves.toBeNull();
    await expect(
      getLongFormPostByEventId({ nostrEventId: null, userId: USER })
    ).resolves.toBeNull();
    expect(db.findFirst).not.toHaveBeenCalled();

    db.findFirst.mockResolvedValue({ id: "lf-2" });
    await expect(
      getLongFormPostByEventId({ nostrEventId: "evt-1", userId: USER })
    ).resolves.toEqual({ id: "lf-2" });
    expect(db.findFirst.mock.calls.at(-1)?.[0]?.where).toEqual({
      nostrEventId: "evt-1",
      userId: USER,
    });
  });

  it("pages user, draft, and published articles", async () => {
    db.findMany.mockResolvedValue([{ id: "a" }]);
    db.count.mockResolvedValue(5);

    await expect(
      getUserLongFormPosts({ userId: USER, page: 2, limit: 2 })
    ).resolves.toEqual({
      posts: [{ id: "a" }],
      total: 5,
      pages: 3,
      currentPage: 2,
    });
    expect(manyArgs()).toMatchObject({
      where: { userId: USER },
      orderBy: { updatedAt: "desc" },
      skip: 2,
      take: 2,
    });

    await getUserLongFormPosts({ userId: USER, isPublished: true });
    expect(manyArgs().where).toEqual({
      userId: USER,
      currentState: "PUBLISHED",
    });
    await getUserLongFormPosts({ userId: USER, isPublished: false });
    expect(manyArgs().where).toEqual({
      userId: USER,
      currentState: { not: "PUBLISHED" },
    });

    await expect(getDraftLongFormPosts({ userId: USER })).resolves.toEqual({
      posts: [{ id: "a" }],
      pagination: { currentPage: 1, limit: 20, total: 5, pages: 1 },
    });
    expect(manyArgs().where).toEqual({ userId: USER, currentState: "DRAFT" });
    expect(manyArgs().include).toEqual({ queueType: true });

    await getPublishedLongFormPosts({
      userId: USER,
      page: 3,
      limit: 4,
      publishedFromUtc: START,
      publishedToUtc: END,
    });
    expect(manyArgs()).toMatchObject({
      where: {
        userId: USER,
        currentState: "PUBLISHED",
        publishedAt: { gte: START, lte: END },
      },
      include: { queueType: true },
      orderBy: { publishedAt: "desc" },
      skip: 8,
      take: 4,
    });
    await getPublishedLongFormPosts({ userId: USER, publishedFromUtc: START });
    expect(manyArgs().where["publishedAt"]).toEqual({ gte: START });
    await getPublishedLongFormPosts({ userId: USER, publishedToUtc: END });
    expect(manyArgs().where["publishedAt"]).toEqual({ lte: END });
    await getPublishedLongFormPosts({ userId: USER });
    expect("publishedAt" in manyArgs().where).toBe(false);
  });

  it("filters scheduled articles by cursor, range, queue, and pause", async () => {
    db.findMany.mockResolvedValue([{ id: "s" }]);
    db.count.mockResolvedValue(4);
    const since = START.getTime();
    await expect(
      getScheduledLongFormPosts({
        userId: USER,
        page: 4,
        limit: 2,
        since,
        afterScheduledAtUtc: CURSOR,
        afterScheduledAtUtcInclusive: false,
        scheduledFromUtc: START,
        scheduledToUtc: END,
        queueType: "Morning",
        excludePausedQueueContent: true,
      })
    ).resolves.toEqual({
      posts: [{ id: "s" }],
      pagination: { currentPage: 4, limit: 2, total: 4, pages: 2 },
    });
    expect(manyArgs().skip).toBe(0);
    expect(manyArgs().take).toBe(2);
    expect(manyArgs().orderBy).toEqual([
      { scheduledAtUtc: "asc" },
      { id: "asc" },
    ]);
    expect(manyArgs().where).toEqual({
      userId: USER,
      currentState: "SCHEDULED",
      updatedAt: { gte: new Date(since) },
      scheduledAtUtc: { gt: CURSOR, gte: START, lte: END },
      queueType: { name: "Morning" },
      AND: [
        {
          OR: [
            { queueTypeId: null },
            { queueType: { status: { not: "PAUSED" } } },
          ],
        },
      ],
    });

    await getScheduledLongFormPosts({
      userId: USER,
      page: 2,
      afterScheduledAtUtc: CURSOR,
      afterScheduledAtUtcInclusive: true,
      scheduledFromUtc: START,
      queueType: "unassigned",
    });
    expect(manyArgs().skip).toBe(0);
    expect(manyArgs().where["scheduledAtUtc"]).toEqual({
      gte: START,
    });
    expect(manyArgs().where["queueTypeId"]).toBeNull();

    await getScheduledLongFormPosts({
      userId: USER,
      queueType: "all",
      excludePausedQueueContent: false,
    });
    expect(manyArgs().where).toEqual({
      userId: USER,
      currentState: "SCHEDULED",
    });
    expect(manyArgs().skip).toBe(0);

    await getScheduledLongFormPosts({ userId: USER, queueType: "" });
    expect("queueType" in manyArgs().where).toBe(false);
  });

  it("returns an empty scheduled page when the query throws", async () => {
    const failure = new Error("db down");
    db.findMany.mockRejectedValueOnce(failure);
    await expect(
      getScheduledLongFormPosts({ userId: USER, page: 3, limit: 7 })
    ).resolves.toEqual({
      posts: [],
      pagination: { currentPage: 1, limit: 7, total: 0, pages: 0 },
    });
    expect(logger.logError.mock.calls[0]?.[0]).toBe(failure);

    db.findMany.mockRejectedValueOnce("db string");
    await getScheduledLongFormPosts({ userId: USER, limit: 3 });
    const logged: unknown = logger.logError.mock.calls.at(-1)?.[0];
    expect(logged).toBeInstanceOf(Error);
    if (logged instanceof Error) expect(logged.message).toBe("db string");
    expect(logger.logError.mock.calls.at(-1)?.[1]).toEqual({
      message: "Error fetching scheduled longform posts",
      userId: USER,
    });
  });

  it("lists a date range and the latest scheduled article", async () => {
    db.findMany.mockResolvedValue([{ scheduledAtUtc: START, queueType: null }]);
    await expect(
      getScheduledLongFormPostsInDateRange({
        userId: USER,
        fromUtc: START,
        toUtc: END,
        queueType: "unassigned",
      })
    ).resolves.toEqual([{ scheduledAtUtc: START, queueType: null }]);
    expect(manyArgs().where).toEqual({
      userId: USER,
      currentState: { in: ["SCHEDULED", "PUBLISHED"] },
      scheduledAtUtc: { gte: START, lte: END },
      queueTypeId: null,
      AND: [
        {
          OR: [
            { queueTypeId: null },
            { queueType: { status: { not: "PAUSED" } } },
          ],
        },
      ],
    });
    expect(manyArgs().select).toEqual({
      scheduledAtUtc: true,
      queueType: { select: { name: true } },
    });

    await getScheduledLongFormPostsInDateRange({
      userId: USER,
      fromUtc: START,
      toUtc: END,
      queueType: "Morning",
    });
    expect(manyArgs().where["queueType"]).toEqual({ name: "Morning" });
    await getScheduledLongFormPostsInDateRange({
      userId: USER,
      fromUtc: START,
      toUtc: END,
      queueType: "all",
    });
    expect("queueType" in manyArgs().where).toBe(false);

    db.findMany.mockRejectedValueOnce(new Error("range"));
    await expect(
      getScheduledLongFormPostsInDateRange({
        userId: USER,
        fromUtc: START,
        toUtc: END,
      })
    ).resolves.toEqual([]);
    db.findMany.mockRejectedValueOnce("range-string");
    await getScheduledLongFormPostsInDateRange({
      userId: USER,
      fromUtc: START,
      toUtc: END,
    });
    const logged: unknown = logger.logError.mock.calls.at(-1)?.[0];
    expect(logged).toBeInstanceOf(Error);
    if (logged instanceof Error) expect(logged.message).toBe("range-string");

    const when = new Date("2026-02-01T00:00:00.000Z");
    db.findFirst.mockResolvedValue({ scheduledAtUtc: when });
    await expect(
      getLatestScheduledLongFormAtUtc({
        userId: USER,
        now: START,
        queueType: "Morning",
        excludePausedQueueContent: true,
      })
    ).resolves.toBe(when);
    expect(db.findFirst.mock.calls.at(-1)?.[0]).toEqual({
      where: {
        userId: USER,
        currentState: "SCHEDULED",
        scheduledAtUtc: { gt: START },
        queueType: { name: "Morning" },
        AND: [
          {
            OR: [
              { queueTypeId: null },
              { queueType: { status: { not: "PAUSED" } } },
            ],
          },
        ],
      },
      orderBy: { scheduledAtUtc: "desc" },
      select: { scheduledAtUtc: true },
    });

    db.findFirst.mockResolvedValueOnce({ scheduledAtUtc: null });
    await expect(
      getLatestScheduledLongFormAtUtc({
        userId: USER,
        now: START,
        queueType: "unassigned",
      })
    ).resolves.toBeNull();
    expect(db.findFirst.mock.calls.at(-1)?.[0]?.where).toMatchObject({
      queueTypeId: null,
    });
    db.findFirst.mockResolvedValueOnce(null);
    await expect(
      getLatestScheduledLongFormAtUtc({
        userId: USER,
        now: START,
        queueType: "",
      })
    ).resolves.toBeNull();
  });

  it("selects past, due, and id-list articles", async () => {
    db.findMany.mockResolvedValue([{ id: "past" }]);
    await expect(
      getPastLongFormPosts({
        userId: USER,
        startDate: START,
        endDate: END,
        beforeDate: CURSOR,
        limit: 5,
        queueType: "unassigned",
        excludePausedQueueContent: true,
      })
    ).resolves.toEqual([{ id: "past" }]);
    expect(manyArgs()).toEqual({
      where: {
        userId: USER,
        currentState: "PUBLISHED",
        queueTypeId: null,
        OR: [
          { postedAt: { gte: START, lt: CURSOR, not: null } },
          { publishedAt: { gte: START, lt: CURSOR, not: null } },
        ],
        AND: [
          {
            OR: [
              { queueTypeId: null },
              { queueType: { status: { not: "PAUSED" } } },
            ],
          },
        ],
      },
      include: { queueType: true },
      orderBy: { postedAt: "desc" },
      take: 5,
    });

    await getPastLongFormPosts({
      userId: USER,
      startDate: START,
      endDate: END,
      queueType: "Morning",
    });
    expect(manyArgs().where["OR"]).toEqual([
      { postedAt: { gte: START, lte: END, not: null } },
      { publishedAt: { gte: START, lte: END, not: null } },
    ]);
    expect(manyArgs().where["queueType"]).toEqual({ name: "Morning" });
    expect("take" in manyArgs()).toBe(false);

    await getPastLongFormPosts({
      userId: USER,
      startDate: START,
      endDate: END,
      queueType: "all",
    });
    expect("queueType" in manyArgs().where).toBe(false);
    expect("AND" in manyArgs().where).toBe(false);

    const before = Date.now();
    await getCronDueScheduledLongFormPosts();
    const after = Date.now();
    const due = manyArgs().where["scheduledAtUtc"];
    if (!isRecord(due)) throw new Error("expected scheduled filter");
    expect(dateMillis(due["lte"])).toBeGreaterThanOrEqual(before);
    expect(dateMillis(due["lte"])).toBeLessThanOrEqual(after);
    expect(manyArgs().where["currentState"]).toBe("SCHEDULED");
    expect(manyArgs().where["queueHoldStatus"]).toBe("NONE");

    await getLongFormPostsByIds({ ids: ["a", "b"], userId: USER });
    expect(manyArgs().where).toEqual({ id: { in: ["a", "b"] }, userId: USER });
  });

  it("groups scheduled counts and statistics, including thrown failures", async () => {
    const asOf = new Date("2026-04-01T00:00:00.000Z");
    db.groupBy.mockResolvedValue([
      { queueTypeId: "q1", _count: { id: 2 } },
      { queueTypeId: null, _count: { id: 1 } },
    ]);
    await expect(
      getScheduledLongFormCountByQueue({ userId: USER, asOf })
    ).resolves.toEqual([
      { queueTypeId: "q1", count: 2 },
      { queueTypeId: null, count: 1 },
    ]);
    expect(db.groupBy.mock.calls[0]?.[0]?.where).toEqual({
      userId: USER,
      currentState: "SCHEDULED",
      scheduledAtUtc: { gt: asOf },
    });

    db.groupBy.mockRejectedValueOnce(new Error("group"));
    await expect(
      getScheduledLongFormCountByQueue({ userId: USER })
    ).resolves.toEqual([]);

    db.count.mockResolvedValueOnce(4).mockResolvedValueOnce(9);
    await expect(getLongFormStatistics({ userId: USER })).resolves.toEqual({
      scheduledCount: 4,
      successCount: 9,
    });
    expect(countWhere(0)).toEqual({
      userId: USER,
      currentState: "SCHEDULED",
      queueHoldStatus: { not: "HELD_BY_QUEUE" },
    });
    expect(countWhere(1)).toEqual({
      userId: USER,
      currentState: "PUBLISHED",
    });

    db.count.mockRejectedValueOnce("stats");
    await expect(getLongFormStatistics({ userId: USER })).resolves.toEqual({
      scheduledCount: 0,
      successCount: 0,
    });
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
