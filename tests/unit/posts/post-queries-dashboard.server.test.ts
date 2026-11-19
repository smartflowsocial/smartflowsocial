import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  post: {
    findMany: vi.fn(
      (_args: {
        where: Record<string, unknown>;
        skip?: number;
        take?: number;
        select?: unknown;
        include?: unknown;
        orderBy?: unknown;
      }): Promise<unknown> => Promise.resolve([])
    ),
    count: vi.fn((_args: { where: Record<string, unknown> }): Promise<number> =>
      Promise.resolve(0)
    ),
    findFirst: vi.fn(
      (_args: {
        where: Record<string, unknown>;
        orderBy?: unknown;
        select?: unknown;
      }): Promise<unknown> => Promise.resolve(null)
    ),
  },
  queueType: {
    findFirst: vi.fn(
      (_args: {
        where: Record<string, unknown>;
        select?: unknown;
      }): Promise<unknown> => Promise.resolve(null)
    ),
  },
  $queryRawUnsafe: vi.fn(
    (
      _query: string,
      ..._params: unknown[]
    ): Promise<Array<{ effective_at: Date | null }>> => Promise.resolve([])
  ),
}));

const logger = vi.hoisted(() => ({
  logError: vi.fn(
    (_error: Error, _context: Record<string, unknown>): void => undefined
  ),
}));

vi.mock("~/lib/error-logger.server", () => ({
  logError: logger.logError,
}));
vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));

import {
  getDraftPosts,
  getLastPostTimeForQueue,
  getLatestScheduledAtUtc,
  getPostStatistics,
  getPublishedFollowUpsCount,
  getPublishedNonRepostPostsCount,
  getPublishedPosts,
  getPublishedRepostsCount,
  getRecentPublishedPosts,
  getRecyclablePosts,
  getScheduledFollowUpsCount,
  getScheduledNonRepostPostsCount,
  getScheduledPosts,
  getScheduledPostsCountByQueue,
  getScheduledPostsInDateRange,
  getScheduledRepostsCount,
} from "~/features/posts/data/post.queries.dashboard.server";
import {
  parseDateRangeInTimezone,
  parseDateRangeUtc,
} from "~/lib/date-range.server";

const USER_ID = "user-1";
const PAUSED_EXCLUSION = {
  OR: [{ queueTypeId: null }, { queueType: { status: { not: "PAUSED" } } }],
};

function lastFindMany(): {
  where: Record<string, unknown>;
  skip?: number;
  take?: number;
} {
  const args = prismaMock.post.findMany.mock.calls.at(-1)?.[0];
  if (!args) throw new Error("expected post.findMany");
  return args;
}

function lastCountWhere(): Record<string, unknown> {
  const where = prismaMock.post.count.mock.calls.at(-1)?.[0].where;
  if (!where) throw new Error("expected post.count where");
  return where;
}

function loggedError(index = 0): [Error, Record<string, unknown>] {
  const logged = logger.logError.mock.calls[index];
  if (!logged) throw new Error("expected logError");
  return logged;
}

function dateField(value: unknown, key: string): Date {
  if (typeof value !== "object" || value === null || !(key in value)) {
    throw new Error(`missing ${key}`);
  }
  const record = value as Record<string, unknown>;
  const date = record[key];
  if (!(date instanceof Date)) throw new Error(`${key} is not a Date`);
  return date;
}

describe("post dashboard queries", () => {
  beforeEach(() => {
    prismaMock.post.findMany.mockReset();
    prismaMock.post.findMany.mockResolvedValue([]);
    prismaMock.post.count.mockReset();
    prismaMock.post.count.mockResolvedValue(0);
    prismaMock.post.findFirst.mockReset();
    prismaMock.post.findFirst.mockResolvedValue(null);
    prismaMock.queueType.findFirst.mockReset();
    prismaMock.queueType.findFirst.mockResolvedValue(null);
    prismaMock.$queryRawUnsafe.mockReset();
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);
    logger.logError.mockReset();
  });

  describe("getScheduledPosts", () => {
    it("returns an empty first page with the default scheduled filter", async () => {
      const result = await getScheduledPosts({ userId: USER_ID });

      expect(result).toEqual({
        posts: [],
        pagination: { total: 0, pages: 0, currentPage: 1, limit: 20 },
      });
      const query = lastFindMany();
      expect(query.skip).toBe(0);
      expect(query.take).toBe(20);
      expect(query.where).toEqual({
        currentState: "SCHEDULED",
        userId: USER_ID,
      });
      expect(lastCountWhere()).toEqual(query.where);
    });

    it("returns a populated page and applies skip for later pages", async () => {
      const row = { id: "post-1", content: "hello" };
      prismaMock.post.findMany.mockResolvedValueOnce([row]);
      prismaMock.post.count.mockResolvedValueOnce(5);

      const result = await getScheduledPosts({
        userId: USER_ID,
        page: 2,
        limit: 2,
      });

      expect(result.posts).toEqual([row]);
      expect(result.pagination).toEqual({
        total: 5,
        pages: 3,
        currentPage: 2,
        limit: 2,
      });
      expect(lastFindMany().skip).toBe(2);
      expect(lastFindMany().take).toBe(2);
    });

    it("filters scheduled posts by content tab", async () => {
      const tabs: Array<{
        contentTab: "all" | "posts" | "reposts" | "followups" | "polls";
        extra: Record<string, unknown>;
      }> = [
        { contentTab: "all", extra: {} },
        {
          contentTab: "posts",
          extra: {
            postKind: { not: "REPOST" },
            dependencyMode: { not: "attached" },
          },
        },
        {
          contentTab: "reposts",
          extra: {
            postKind: "REPOST",
            dependencyMode: { not: "attached" },
          },
        },
        {
          contentTab: "followups",
          extra: { dependencyMode: "attached" },
        },
        { contentTab: "polls", extra: { postType: "POLL" } },
      ];

      for (const tab of tabs) {
        await getScheduledPosts({
          userId: USER_ID,
          contentTab: tab.contentTab,
        });
        expect(lastFindMany().where).toEqual({
          currentState: "SCHEDULED",
          userId: USER_ID,
          ...tab.extra,
        });
      }
    });

    it("applies queue, cursor, since, date, and paused-queue filters", async () => {
      const since = Date.parse("2026-04-01T00:00:00.000Z");
      const cursor = new Date("2026-04-05T00:00:00.000Z");
      const from = new Date("2026-04-02T00:00:00.000Z");
      const to = new Date("2026-04-20T00:00:00.000Z");

      await getScheduledPosts({
        userId: USER_ID,
        queueType: "all",
      });
      expect(lastFindMany().where).toEqual({
        currentState: "SCHEDULED",
        userId: USER_ID,
      });

      await getScheduledPosts({
        userId: USER_ID,
        queueType: "",
      });
      expect(lastFindMany().where["queueType"]).toBeUndefined();

      await getScheduledPosts({
        userId: USER_ID,
        queueType: "unassigned",
      });
      expect(lastFindMany().where["queueTypeId"]).toBeNull();

      await getScheduledPosts({
        userId: USER_ID,
        page: 4,
        limit: 5,
        queueType: "News",
        since,
        afterScheduledAtUtc: cursor,
        scheduledToUtc: to,
        contentTab: "polls",
        excludePausedQueueContent: true,
      });
      const exclusive = lastFindMany();
      expect(exclusive.skip).toBe(0);
      expect(exclusive.take).toBe(5);
      expect(exclusive.where).toEqual({
        currentState: "SCHEDULED",
        userId: USER_ID,
        postType: "POLL",
        updatedAt: { gte: new Date(since) },
        scheduledAtUtc: { gt: cursor, lte: to },
        queueType: { name: "News" },
        AND: [PAUSED_EXCLUSION],
      });

      await getScheduledPosts({
        userId: USER_ID,
        afterScheduledAtUtc: cursor,
        afterScheduledAtUtcInclusive: true,
        scheduledFromUtc: from,
      });
      expect(lastFindMany().where["scheduledAtUtc"]).toEqual({ gte: from });

      await getScheduledPosts({
        userId: USER_ID,
        scheduledFromUtc: from,
        scheduledToUtc: to,
      });
      expect(lastFindMany().where["scheduledAtUtc"]).toEqual({
        gte: from,
        lte: to,
      });
    });

    it("logs and rethrows query failures", async () => {
      prismaMock.post.findMany.mockImplementationOnce(() =>
        Promise.reject(new Error("db down"))
      );
      await expect(
        getScheduledPosts({ userId: USER_ID, queueType: "News" })
      ).rejects.toThrow("db down");
      const [error, context] = loggedError();
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("db down");
      expect(context).toEqual({
        message: "Error fetching scheduled posts",
        userId: USER_ID,
        queueType: "News",
      });

      prismaMock.post.findMany.mockImplementationOnce(() =>
        Promise.reject("db down")
      );
      await expect(getScheduledPosts({ userId: USER_ID })).rejects.toThrow(
        "db down"
      );
      const [wrapped] = loggedError(1);
      expect(wrapped.message).toBe("db down");
    });
  });

  describe("scheduled counts", () => {
    const counters: Array<{
      run: (args: {
        userId: string;
        queueType?: string;
        scheduledFromUtc?: Date;
        scheduledToUtc?: Date;
        excludePausedQueueContent?: boolean;
      }) => Promise<number>;
      where: Record<string, unknown>;
    }> = [
      {
        run: getScheduledRepostsCount,
        where: {
          currentState: "SCHEDULED",
          userId: USER_ID,
          postKind: "REPOST",
          dependencyMode: { not: "attached" },
        },
      },
      {
        run: getScheduledFollowUpsCount,
        where: {
          currentState: "SCHEDULED",
          userId: USER_ID,
          dependencyMode: "attached",
        },
      },
      {
        run: getScheduledNonRepostPostsCount,
        where: {
          currentState: "SCHEDULED",
          userId: USER_ID,
          postKind: { not: "REPOST" },
          dependencyMode: { not: "attached" },
        },
      },
    ];

    it("covers empty totals and each queue, date, and paused filter", async () => {
      const from = new Date("2026-05-01T00:00:00.000Z");
      const to = new Date("2026-05-02T00:00:00.000Z");
      const variants: Array<{
        args: {
          queueType?: string;
          scheduledFromUtc?: Date;
          scheduledToUtc?: Date;
          excludePausedQueueContent?: boolean;
        };
        extra: Record<string, unknown>;
      }> = [
        { args: {}, extra: {} },
        {
          args: { scheduledFromUtc: from },
          extra: { scheduledAtUtc: { gte: from } },
        },
        {
          args: { scheduledToUtc: to },
          extra: { scheduledAtUtc: { lte: to } },
        },
        {
          args: { scheduledFromUtc: from, scheduledToUtc: to },
          extra: { scheduledAtUtc: { gte: from, lte: to } },
        },
        { args: { queueType: "all" }, extra: {} },
        { args: { queueType: "" }, extra: {} },
        {
          args: { queueType: "unassigned" },
          extra: { queueTypeId: null },
        },
        {
          args: { queueType: "Main" },
          extra: { queueType: { name: "Main" } },
        },
        {
          args: { excludePausedQueueContent: true },
          extra: { AND: [PAUSED_EXCLUSION] },
        },
      ];

      for (const counter of counters) {
        for (const [index, variant] of variants.entries()) {
          const total = index === variants.length - 1 ? 2 : 0;
          prismaMock.post.count.mockResolvedValueOnce(total);
          await expect(
            counter.run({ userId: USER_ID, ...variant.args })
          ).resolves.toBe(total);
          expect(lastCountWhere()).toEqual({
            ...counter.where,
            ...variant.extra,
          });
        }
      }
    });
  });

  describe("getScheduledPostsInDateRange", () => {
    const from = new Date("2026-02-01T00:00:00.000Z");
    const to = new Date("2026-02-07T00:00:00.000Z");
    const baseWhere = {
      currentState: { in: ["SCHEDULED", "PUBLISHED"] },
      userId: USER_ID,
      repost: false,
      scheduledAtUtc: { gte: from, lte: to },
      AND: [PAUSED_EXCLUSION],
    };

    it("returns an empty range and queue-filter variants", async () => {
      await expect(
        getScheduledPostsInDateRange({
          userId: USER_ID,
          fromUtc: from,
          toUtc: to,
        })
      ).resolves.toEqual([]);
      expect(lastFindMany().where).toEqual(baseWhere);

      await getScheduledPostsInDateRange({
        userId: USER_ID,
        fromUtc: from,
        toUtc: to,
        queueType: "all",
      });
      expect(lastFindMany().where).toEqual(baseWhere);

      await getScheduledPostsInDateRange({
        userId: USER_ID,
        fromUtc: from,
        toUtc: to,
        queueType: "",
      });
      expect(lastFindMany().where).toEqual(baseWhere);

      await getScheduledPostsInDateRange({
        userId: USER_ID,
        fromUtc: from,
        toUtc: to,
        queueType: "unassigned",
      });
      expect(lastFindMany().where).toEqual({
        ...baseWhere,
        queueTypeId: null,
      });

      await getScheduledPostsInDateRange({
        userId: USER_ID,
        fromUtc: from,
        toUtc: to,
        queueType: "Main",
      });
      expect(lastFindMany().where).toEqual({
        ...baseWhere,
        queueType: { name: "Main" },
      });
    });

    it("collapses a thread to the earliest segment and keeps standalone rows", async () => {
      const earlier = new Date("2026-02-02T00:00:00.000Z");
      prismaMock.post.findMany.mockResolvedValueOnce([
        {
          id: "later",
          threadGroupId: "group-1",
          scheduledAtUtc: new Date("2026-02-03T00:00:00.000Z"),
          queueType: { name: "Main" },
        },
        {
          id: "earlier",
          threadGroupId: "group-1",
          scheduledAtUtc: earlier,
          queueType: { name: "Main" },
        },
        {
          id: "solo",
          threadGroupId: null,
          scheduledAtUtc: null,
          queueType: null,
        },
      ]);

      await expect(
        getScheduledPostsInDateRange({
          userId: USER_ID,
          fromUtc: from,
          toUtc: to,
        })
      ).resolves.toEqual([
        { scheduledAtUtc: null, queueType: null },
        { scheduledAtUtc: earlier, queueType: { name: "Main" } },
      ]);
    });

    it("logs and rethrows range failures", async () => {
      prismaMock.post.findMany.mockImplementationOnce(() =>
        Promise.reject(new Error("range down"))
      );
      await expect(
        getScheduledPostsInDateRange({
          userId: USER_ID,
          fromUtc: from,
          toUtc: to,
          queueType: "Main",
        })
      ).rejects.toThrow("range down");
      const [error, context] = loggedError();
      expect(error.message).toBe("range down");
      expect(context).toEqual({
        message: "Error fetching scheduled posts in date range",
        userId: USER_ID,
        queueType: "Main",
      });

      prismaMock.post.findMany.mockImplementationOnce(() =>
        Promise.reject("range down")
      );
      await expect(
        getScheduledPostsInDateRange({
          userId: USER_ID,
          fromUtc: from,
          toUtc: to,
        })
      ).rejects.toThrow("range down");
      expect(loggedError(1)[0].message).toBe("range down");
    });
  });

  describe("getLatestScheduledAtUtc", () => {
    const now = new Date("2026-07-01T00:00:00.000Z");

    it("returns null when no future post exists or the timestamp is null", async () => {
      await expect(
        getLatestScheduledAtUtc({ userId: USER_ID, now })
      ).resolves.toBeNull();
      expect(prismaMock.post.findFirst.mock.calls.at(-1)?.[0].where).toEqual({
        userId: USER_ID,
        currentState: "SCHEDULED",
        scheduledAtUtc: { gt: now },
      });

      prismaMock.post.findFirst.mockResolvedValueOnce({
        scheduledAtUtc: null,
      });
      await expect(
        getLatestScheduledAtUtc({ userId: USER_ID, now, queueType: "all" })
      ).resolves.toBeNull();

      prismaMock.post.findFirst.mockResolvedValueOnce({});
      await expect(
        getLatestScheduledAtUtc({ userId: USER_ID, now, queueType: "" })
      ).resolves.toBeNull();
    });

    it("returns the latest timestamp and applies queue filters", async () => {
      const when = new Date("2026-09-01T00:00:00.000Z");
      prismaMock.post.findFirst.mockResolvedValueOnce({
        scheduledAtUtc: when,
      });
      await expect(
        getLatestScheduledAtUtc({
          userId: USER_ID,
          now,
          queueType: "unassigned",
          excludePausedQueueContent: true,
        })
      ).resolves.toBe(when);
      expect(prismaMock.post.findFirst.mock.calls.at(-1)?.[0].where).toEqual({
        userId: USER_ID,
        currentState: "SCHEDULED",
        scheduledAtUtc: { gt: now },
        queueTypeId: null,
        AND: [PAUSED_EXCLUSION],
      });

      prismaMock.post.findFirst.mockResolvedValueOnce({
        scheduledAtUtc: when,
      });
      await getLatestScheduledAtUtc({
        userId: USER_ID,
        now,
        queueType: "Main",
      });
      expect(
        prismaMock.post.findFirst.mock.calls.at(-1)?.[0].where["queueType"]
      ).toEqual({ name: "Main" });
    });
  });

  describe("getDraftPosts", () => {
    const baseWhere = {
      currentState: "DRAFT",
      userId: USER_ID,
      draftGroupId: null,
    };

    it("returns an empty draft page and a populated later page", async () => {
      const empty = await getDraftPosts({ userId: USER_ID });
      expect(empty).toEqual({
        posts: [],
        pagination: { total: 0, pages: 0, currentPage: 1, limit: 20 },
      });
      expect(lastFindMany().where).toEqual(baseWhere);
      expect(lastFindMany().skip).toBe(0);

      const row = { id: "draft-1", content: "wip" };
      prismaMock.post.findMany.mockResolvedValueOnce([row]);
      prismaMock.post.count.mockResolvedValueOnce(1);
      const populated = await getDraftPosts({
        userId: USER_ID,
        page: 2,
        limit: 10,
      });
      expect(populated.posts).toEqual([row]);
      expect(populated.pagination).toEqual({
        total: 1,
        pages: 1,
        currentPage: 2,
        limit: 10,
      });
      expect(lastFindMany().skip).toBe(10);
    });

    it("filters drafts by queue", async () => {
      await getDraftPosts({ userId: USER_ID, queueType: "all" });
      expect(lastFindMany().where).toEqual(baseWhere);
      await getDraftPosts({ userId: USER_ID, queueType: "" });
      expect(lastFindMany().where).toEqual(baseWhere);
      await getDraftPosts({ userId: USER_ID, queueType: "unassigned" });
      expect(lastFindMany().where).toEqual({
        ...baseWhere,
        queueTypeId: null,
      });
      await getDraftPosts({ userId: USER_ID, queueType: "Main" });
      expect(lastFindMany().where).toEqual({
        ...baseWhere,
        queueType: { name: "Main" },
      });
    });
  });

  describe("getPublishedPosts", () => {
    const from = new Date("2026-03-01T00:00:00.000Z");
    const to = new Date("2026-03-31T00:00:00.000Z");

    it("returns empty and populated published pages", async () => {
      const empty = await getPublishedPosts({ userId: USER_ID });
      expect(empty.posts).toEqual([]);
      expect(empty.pagination).toEqual({
        total: 0,
        pages: 0,
        currentPage: 1,
        limit: 50,
      });
      expect(lastFindMany().where).toEqual({
        currentState: "PUBLISHED",
        userId: USER_ID,
      });

      const row = { id: "pub-1", content: "live" };
      prismaMock.post.findMany.mockResolvedValueOnce([row]);
      prismaMock.post.count.mockResolvedValueOnce(1);
      const populated = await getPublishedPosts({
        userId: USER_ID,
        page: 3,
        limit: 10,
      });
      expect(populated.posts).toEqual([row]);
      expect(populated.pagination.currentPage).toBe(3);
      expect(lastFindMany().skip).toBe(20);
    });

    it("filters published posts by date and queue", async () => {
      await getPublishedPosts({
        userId: USER_ID,
        publishedFromUtc: from,
      });
      expect(lastFindMany().where["publishedAt"]).toEqual({ gte: from });

      await getPublishedPosts({ userId: USER_ID, publishedToUtc: to });
      expect(lastFindMany().where["publishedAt"]).toEqual({ lte: to });

      await getPublishedPosts({
        userId: USER_ID,
        publishedFromUtc: from,
        publishedToUtc: to,
        queueType: "unassigned",
      });
      expect(lastFindMany().where).toEqual({
        currentState: "PUBLISHED",
        userId: USER_ID,
        publishedAt: { gte: from, lte: to },
        queueTypeId: null,
      });

      await getPublishedPosts({ userId: USER_ID, queueType: "Main" });
      expect(lastFindMany().where["queueType"]).toEqual({ name: "Main" });

      await getPublishedPosts({ userId: USER_ID, queueType: "all" });
      expect(lastFindMany().where["queueType"]).toBeUndefined();

      await getPublishedPosts({ userId: USER_ID, queueType: "" });
      expect(lastFindMany().where["queueTypeId"]).toBeUndefined();
    });
  });

  describe("published counts", () => {
    const counters: Array<{
      run: (args: {
        userId: string;
        queueType?: string;
        publishedFromUtc?: Date;
        publishedToUtc?: Date;
      }) => Promise<number>;
      where: Record<string, unknown>;
    }> = [
      {
        run: getPublishedFollowUpsCount,
        where: {
          currentState: "PUBLISHED",
          userId: USER_ID,
          dependencyMode: "attached",
        },
      },
      {
        run: getPublishedRepostsCount,
        where: {
          currentState: "PUBLISHED",
          userId: USER_ID,
          postKind: "REPOST",
          dependencyMode: { not: "attached" },
        },
      },
      {
        run: getPublishedNonRepostPostsCount,
        where: {
          currentState: "PUBLISHED",
          userId: USER_ID,
          postKind: { not: "REPOST" },
          dependencyMode: { not: "attached" },
        },
      },
    ];

    it("covers empty totals and published date and queue filters", async () => {
      const from = new Date("2026-06-01T00:00:00.000Z");
      const to = new Date("2026-06-02T00:00:00.000Z");
      const variants: Array<{
        args: {
          queueType?: string;
          publishedFromUtc?: Date;
          publishedToUtc?: Date;
        };
        extra: Record<string, unknown>;
      }> = [
        { args: {}, extra: {} },
        {
          args: { publishedFromUtc: from },
          extra: { publishedAt: { gte: from } },
        },
        { args: { publishedToUtc: to }, extra: { publishedAt: { lte: to } } },
        {
          args: { publishedFromUtc: from, publishedToUtc: to },
          extra: { publishedAt: { gte: from, lte: to } },
        },
        { args: { queueType: "all" }, extra: {} },
        { args: { queueType: "" }, extra: {} },
        { args: { queueType: "unassigned" }, extra: { queueTypeId: null } },
        { args: { queueType: "Main" }, extra: { queueType: { name: "Main" } } },
      ];

      for (const counter of counters) {
        for (const [index, variant] of variants.entries()) {
          const total = index === 0 ? 0 : 4;
          prismaMock.post.count.mockResolvedValueOnce(total);
          await expect(
            counter.run({ userId: USER_ID, ...variant.args })
          ).resolves.toBe(total);
          expect(lastCountWhere()).toEqual({
            ...counter.where,
            ...variant.extra,
          });
        }
      }
    });
  });

  describe("getRecentPublishedPosts", () => {
    it("returns empty and populated rows and uses the day window", async () => {
      await expect(
        getRecentPublishedPosts({ userId: USER_ID, days: 1 })
      ).resolves.toEqual([]);
      const recent = dateField(lastFindMany().where["publishedAt"], "gte");

      await getRecentPublishedPosts({ userId: USER_ID, days: 11 });
      const older = dateField(lastFindMany().where["publishedAt"], "gte");
      const day = 24 * 60 * 60 * 1000;
      expect(recent.getTime() - older.getTime()).toBeGreaterThan(9 * day);
      expect(recent.getTime() - older.getTime()).toBeLessThan(11 * day);

      const row = { id: "recent-1", content: "fresh" };
      prismaMock.post.findMany.mockResolvedValueOnce([row]);
      await expect(
        getRecentPublishedPosts({ userId: USER_ID, days: 3 })
      ).resolves.toEqual([row]);
    });

    it("prefers absolute dates, since, and queue id over the queue name", async () => {
      const from = new Date("2026-01-01T00:00:00.000Z");
      const to = new Date("2026-01-31T00:00:00.000Z");
      const since = Date.parse("2026-01-15T00:00:00.000Z");

      await getRecentPublishedPosts({
        userId: USER_ID,
        days: 7,
        publishedFrom: from,
        since,
      });
      expect(lastFindMany().where["publishedAt"]).toEqual({ gte: from });
      expect(lastFindMany().where["updatedAt"]).toEqual({
        gte: new Date(since),
      });

      await getRecentPublishedPosts({
        userId: USER_ID,
        days: 7,
        publishedTo: to,
      });
      expect(lastFindMany().where["publishedAt"]).toEqual({ lte: to });

      await getRecentPublishedPosts({
        userId: USER_ID,
        days: 7,
        publishedFrom: from,
        publishedTo: to,
        queueTypeId: "queue-9",
        queueType: "unassigned",
      });
      expect(lastFindMany().where["queueTypeId"]).toBe("queue-9");
      expect(lastFindMany().where["queueType"]).toBeUndefined();
      expect(lastFindMany().where["publishedAt"]).toEqual({
        gte: from,
        lte: to,
      });

      await getRecentPublishedPosts({
        userId: USER_ID,
        days: 7,
        queueTypeId: "",
        queueType: "unassigned",
      });
      expect(lastFindMany().where["queueTypeId"]).toBeNull();

      await getRecentPublishedPosts({
        userId: USER_ID,
        days: 7,
        queueType: "Main",
      });
      expect(lastFindMany().where["queueType"]).toEqual({ name: "Main" });

      await getRecentPublishedPosts({
        userId: USER_ID,
        days: 7,
        queueType: "all",
      });
      expect(lastFindMany().where["queueType"]).toBeUndefined();
      expect(lastFindMany().where["queueTypeId"]).toBeUndefined();
    });
  });

  describe("getScheduledPostsCountByQueue", () => {
    it("returns an empty list and groups collapsed rows by queue", async () => {
      await expect(
        getScheduledPostsCountByQueue({ userId: USER_ID })
      ).resolves.toEqual([]);
      const gt = dateField(lastFindMany().where["scheduledAtUtc"], "gt");
      expect(gt).toBeInstanceOf(Date);
      expect(lastFindMany().where["dependencyMode"]).toEqual({
        not: "attached",
      });

      const asOf = new Date("2026-08-01T00:00:00.000Z");
      prismaMock.post.findMany.mockResolvedValueOnce([
        {
          id: "a",
          threadGroupId: null,
          scheduledAtUtc: new Date("2026-08-02T00:00:00.000Z"),
          queueTypeId: "q1",
        },
        {
          id: "b",
          threadGroupId: null,
          scheduledAtUtc: new Date("2026-08-03T00:00:00.000Z"),
          queueTypeId: "q1",
        },
        {
          id: "c",
          threadGroupId: "thread-1",
          scheduledAtUtc: new Date("2026-08-04T00:00:00.000Z"),
          queueTypeId: "q1",
        },
        {
          id: "d",
          threadGroupId: "thread-1",
          scheduledAtUtc: new Date("2026-08-05T00:00:00.000Z"),
          queueTypeId: null,
        },
        {
          id: "e",
          threadGroupId: null,
          scheduledAtUtc: new Date("2026-08-06T00:00:00.000Z"),
          queueTypeId: null,
        },
      ]);
      await expect(
        getScheduledPostsCountByQueue({ userId: USER_ID, asOf })
      ).resolves.toEqual([
        { queueTypeId: "q1", count: 3 },
        { queueTypeId: null, count: 1 },
      ]);
      expect(lastFindMany().where["scheduledAtUtc"]).toEqual({ gt: asOf });
    });

    it("returns an empty list when the count query fails", async () => {
      prismaMock.post.findMany.mockImplementationOnce(() =>
        Promise.reject(new Error("count down"))
      );
      await expect(
        getScheduledPostsCountByQueue({ userId: USER_ID })
      ).resolves.toEqual([]);
      expect(loggedError()[0].message).toBe("count down");
      expect(loggedError()[1]).toEqual({
        message: "Error fetching scheduled posts count by queue",
        userId: USER_ID,
      });

      prismaMock.post.findMany.mockImplementationOnce(() =>
        Promise.reject("count down")
      );
      await expect(
        getScheduledPostsCountByQueue({ userId: USER_ID })
      ).resolves.toEqual([]);
      expect(loggedError(1)[0].message).toBe("count down");
    });
  });

  describe("getPostStatistics", () => {
    it("returns scheduled and published counts", async () => {
      prismaMock.post.count.mockResolvedValueOnce(3).mockResolvedValueOnce(8);
      await expect(getPostStatistics({ userId: USER_ID })).resolves.toEqual({
        scheduledCount: 3,
        successCount: 8,
      });
      expect(prismaMock.post.count.mock.calls[0]?.[0].where).toEqual({
        userId: USER_ID,
        currentState: "SCHEDULED",
        repost: false,
        queueHoldStatus: { not: "HELD_BY_QUEUE" },
      });
      expect(prismaMock.post.count.mock.calls[1]?.[0].where).toEqual({
        userId: USER_ID,
        currentState: "PUBLISHED",
        repost: false,
      });
    });

    it("returns zeros when statistics cannot be loaded", async () => {
      prismaMock.post.count.mockImplementationOnce(() =>
        Promise.reject(new Error("stats down"))
      );
      await expect(getPostStatistics({ userId: USER_ID })).resolves.toEqual({
        scheduledCount: 0,
        successCount: 0,
      });
      expect(loggedError()[1]).toEqual({
        message: "Error fetching post statistics",
        userId: USER_ID,
      });

      prismaMock.post.count.mockImplementationOnce(() =>
        Promise.reject("stats down")
      );
      await expect(getPostStatistics({ userId: USER_ID })).resolves.toEqual({
        scheduledCount: 0,
        successCount: 0,
      });
      expect(loggedError(1)[0].message).toBe("stats down");
    });
  });

  describe("getRecyclablePosts", () => {
    const baseWhere = {
      isRecyclable: true,
      currentState: "PUBLISHED",
      userId: USER_ID,
    };

    it("returns empty and populated recyclable pages", async () => {
      const empty = await getRecyclablePosts({ userId: USER_ID });
      expect(empty.posts).toEqual([]);
      expect(empty.pagination).toEqual({
        total: 0,
        pages: 0,
        currentPage: 1,
        limit: 50,
      });
      expect(lastFindMany().where).toEqual(baseWhere);

      const row = { id: "recycle-1", content: "again" };
      prismaMock.post.findMany.mockResolvedValueOnce([row]);
      prismaMock.post.count.mockResolvedValueOnce(1);
      const populated = await getRecyclablePosts({
        userId: USER_ID,
        page: 2,
        limit: 10,
      });
      expect(populated.posts).toEqual([row]);
      expect(populated.pagination).toEqual({
        total: 1,
        pages: 1,
        currentPage: 2,
        limit: 10,
      });
      expect(lastFindMany().skip).toBe(10);
    });

    it("filters recyclable posts by queue", async () => {
      await getRecyclablePosts({ userId: USER_ID, queueType: "all" });
      expect(lastFindMany().where).toEqual(baseWhere);
      await getRecyclablePosts({ userId: USER_ID, queueType: "" });
      expect(lastFindMany().where).toEqual(baseWhere);
      await getRecyclablePosts({ userId: USER_ID, queueType: "unassigned" });
      expect(lastFindMany().where["queueTypeId"]).toBeNull();
      await getRecyclablePosts({ userId: USER_ID, queueType: "Main" });
      expect(lastFindMany().where["queueType"]).toEqual({ name: "Main" });
    });

    it("accepts only in-range month and year olderThan values", async () => {
      const cases: Array<{
        olderThan: string | null | undefined;
        months?: number;
        years?: number;
      }> = [
        { olderThan: undefined },
        { olderThan: null },
        { olderThan: "" },
        { olderThan: "nope" },
        { olderThan: "1d" },
        { olderThan: "0m" },
        { olderThan: "13m" },
        { olderThan: "0y" },
        { olderThan: "4y" },
        { olderThan: 6 as unknown as string },
        { olderThan: "1m", months: 1 },
        { olderThan: "6m", months: 6 },
        { olderThan: "12m", months: 12 },
        { olderThan: "6M", months: 6 },
        { olderThan: "1y", years: 1 },
        { olderThan: "3y", years: 3 },
      ];

      for (const entry of cases) {
        await getRecyclablePosts({
          userId: USER_ID,
          olderThan: entry.olderThan,
        });
        const publishedAt = lastFindMany().where["publishedAt"];
        if (entry.months === undefined && entry.years === undefined) {
          expect(publishedAt).toBeUndefined();
          continue;
        }
        const expected = new Date();
        if (entry.months !== undefined) {
          expected.setMonth(expected.getMonth() - entry.months);
        }
        if (entry.years !== undefined) {
          expected.setFullYear(expected.getFullYear() - entry.years);
        }
        const lt = dateField(publishedAt, "lt");
        expect(Math.abs(lt.getTime() - expected.getTime())).toBeLessThan(2_000);
      }
    });

    it("applies timezone and UTC published ranges, including invalid input", async () => {
      const zoned = parseDateRangeInTimezone(
        "2024-01-15",
        "2024-01-16",
        "America/New_York"
      );
      const utcSameDays = parseDateRangeUtc("2024-01-15", "2024-01-16");
      if (!zoned?.fromUtc || !zoned.toUtc || !utcSameDays?.fromUtc) {
        throw new Error("expected parsed ranges");
      }
      expect(zoned.fromUtc.toISOString()).not.toBe(
        utcSameDays.fromUtc.toISOString()
      );

      await getRecyclablePosts({
        userId: USER_ID,
        timezone: " America/New_York ",
        dateFrom: "2024-01-15",
        dateTo: "2024-01-16",
        olderThan: "6m",
        queueType: "Main",
      });
      const combined = lastFindMany().where["publishedAt"];
      const lt = dateField(combined, "lt");
      expect(lt).toBeInstanceOf(Date);
      expect(combined).toEqual({
        lt,
        gte: zoned.fromUtc,
        lte: zoned.toUtc,
      });
      expect(lastFindMany().where["queueType"]).toEqual({ name: "Main" });

      await getRecyclablePosts({
        userId: USER_ID,
        timezone: "   ",
        dateFrom: " 2024-03-01 ",
        dateTo: "2024-03-02",
      });
      const utc = parseDateRangeUtc(" 2024-03-01 ", "2024-03-02");
      if (!utc?.fromUtc || !utc.toUtc) throw new Error("expected utc range");
      expect(lastFindMany().where["publishedAt"]).toEqual({
        gte: utc.fromUtc,
        lte: utc.toUtc,
      });

      await getRecyclablePosts({
        userId: USER_ID,
        dateFrom: "2024-06-01",
      });
      const fromOnly = parseDateRangeUtc("2024-06-01", null);
      if (!fromOnly?.fromUtc) throw new Error("expected from range");
      expect(lastFindMany().where["publishedAt"]).toEqual({
        gte: fromOnly.fromUtc,
      });

      await getRecyclablePosts({
        userId: USER_ID,
        dateTo: "2024-06-02",
      });
      const toOnly = parseDateRangeUtc(null, "2024-06-02");
      if (!toOnly?.toUtc) throw new Error("expected to range");
      expect(lastFindMany().where["publishedAt"]).toEqual({
        lte: toOnly.toUtc,
      });

      await getRecyclablePosts({
        userId: USER_ID,
        timezone: "Not/AZone",
        dateFrom: "2024-01-15",
        dateTo: "2024-01-16",
      });
      expect(lastFindMany().where["publishedAt"]).toBeUndefined();

      await getRecyclablePosts({
        userId: USER_ID,
        timezone: "UTC",
        dateFrom: "not-a-date",
        dateTo: null,
      });
      expect(lastFindMany().where["publishedAt"]).toBeUndefined();

      await getRecyclablePosts({
        userId: USER_ID,
        timezone: null,
        dateFrom: null,
        dateTo: null,
      });
      expect(lastFindMany().where).toEqual(baseWhere);
    });
  });

  describe("getLastPostTimeForQueue", () => {
    it("returns null when the queue cannot be resolved", async () => {
      await expect(
        getLastPostTimeForQueue({ userId: USER_ID })
      ).resolves.toBeNull();
      expect(prismaMock.queueType.findFirst).not.toHaveBeenCalled();

      await expect(
        getLastPostTimeForQueue({
          userId: USER_ID,
          queueTypeId: "queue-1",
          queueTypeName: "Main",
        })
      ).resolves.toBeNull();
      expect(prismaMock.queueType.findFirst).toHaveBeenCalledTimes(1);
      expect(prismaMock.queueType.findFirst.mock.calls[0]?.[0].where).toEqual({
        id: "queue-1",
        userId: USER_ID,
      });
      expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled();

      await expect(
        getLastPostTimeForQueue({ userId: USER_ID, queueTypeName: "Missing" })
      ).resolves.toBeNull();
      expect(
        prismaMock.queueType.findFirst.mock.calls.at(-1)?.[0].where
      ).toEqual({ userId: USER_ID, name: "Missing" });
    });

    it("uses the interval query and the slot query", async () => {
      const when = new Date("2026-10-01T00:00:00.000Z");
      prismaMock.queueType.findFirst.mockResolvedValueOnce({
        id: "queue-1",
        scheduleType: "INTERVAL",
        name: "Main",
      });
      prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
        { effective_at: when },
      ]);
      await expect(
        getLastPostTimeForQueue({
          userId: USER_ID,
          queueTypeId: "queue-1",
          queueTypeName: "Ignored",
        })
      ).resolves.toBe(when);
      const intervalSql = prismaMock.$queryRawUnsafe.mock.calls.at(-1)?.[0];
      expect(intervalSql).toContain(`"currentState" = 'SCHEDULED'`);
      expect(prismaMock.$queryRawUnsafe.mock.calls.at(-1)?.[1]).toBe(USER_ID);
      expect(prismaMock.$queryRawUnsafe.mock.calls.at(-1)?.[2]).toBe("queue-1");

      prismaMock.queueType.findFirst.mockResolvedValueOnce({
        id: "queue-1",
        scheduleType: "INTERVAL",
        name: "Main",
      });
      prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
        { effective_at: null },
      ]);
      await expect(
        getLastPostTimeForQueue({ userId: USER_ID, queueTypeId: "queue-1" })
      ).resolves.toBeNull();

      prismaMock.queueType.findFirst.mockResolvedValueOnce({
        id: "queue-1",
        scheduleType: "INTERVAL",
        name: "Main",
      });
      await expect(
        getLastPostTimeForQueue({ userId: USER_ID, queueTypeId: "queue-1" })
      ).resolves.toBeNull();

      prismaMock.queueType.findFirst.mockResolvedValueOnce({
        id: "queue-2",
        scheduleType: "FIXED_SLOTS",
        name: "Slots",
      });
      prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
        { effective_at: when },
      ]);
      await expect(
        getLastPostTimeForQueue({ userId: USER_ID, queueTypeName: "Slots" })
      ).resolves.toBe(when);
      const slotSql = prismaMock.$queryRawUnsafe.mock.calls.at(-1)?.[0];
      expect(slotSql).toContain(`IN ('SCHEDULED', 'PUBLISHED')`);
      expect(prismaMock.$queryRawUnsafe.mock.calls.at(-1)?.[2]).toBe("queue-2");
    });
  });
});
