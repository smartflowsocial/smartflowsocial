import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface ReadWhere {
  userId: string;
  queueTypeName?: string;
}

interface ScheduledFindArgs {
  where: ReadWhere;
  orderBy: { scheduledAtUtc: string };
}

interface PublishedFindArgs {
  where: ReadWhere;
  orderBy: { publishedAt: string };
  skip: number;
  take: number;
}

interface CountArgs {
  where: ReadWhere;
}

interface ScheduledRead {
  id: string;
  userId: string;
  postId: string;
  caption: string | null;
  scheduledAtUtc: Date;
  queueTypeName: string;
  queueTypeColorToken: string | null;
  hashTagPresetId: string | null;
  templateId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PublishedRead {
  id: string;
  userId: string;
  postId: string;
  caption: string | null;
  publishedAt: Date;
  queueTypeName: string;
  queueTypeColorToken: string | null;
  engagementScore: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface QueryArgs {
  userId: string;
  queueType?: string;
  page?: number;
  limit?: number;
}

interface FallbackPost {
  id: string;
  userId: string;
  caption: string | null;
  scheduledAtUtc?: Date | null;
  publishedAt?: Date | null;
  queueType: { name?: string; colorToken?: string | null } | null;
  hashTagPresetId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const queries = vi.hoisted(() => ({
  getScheduledPosts: vi.fn(async (_args: QueryArgs): Promise<unknown> => ({
    posts: [],
  })),
  getPublishedPosts: vi.fn(async (_args: QueryArgs): Promise<unknown> => ({
    posts: [],
    pagination: { total: 0, currentPage: 1, limit: 50 },
  })),
}));

const db = vi.hoisted(() => ({
  scheduledFind: vi.fn(
    async (_args: ScheduledFindArgs): Promise<ScheduledRead[]> => []
  ),
  scheduledCount: vi.fn(async (_args: CountArgs) => 0),
  publishedFind: vi.fn(
    async (_args: PublishedFindArgs): Promise<PublishedRead[]> => []
  ),
  publishedCount: vi.fn(async (_args: CountArgs) => 0),
}));

vi.mock("~/features/posts/data/post.queries.server", () => queries);
vi.mock("~/lib/prisma.server", () => ({
  prisma: {
    scheduledPostRead: {
      findMany: db.scheduledFind,
      count: db.scheduledCount,
    },
    publishedPostRead: {
      findMany: db.publishedFind,
      count: db.publishedCount,
    },
  },
}));

import {
  areReadModelsPopulated,
  getPostStatisticsFromReadModel,
  getPublishedPostsFromReadModel,
  getScheduledPostsFromReadModel,
} from "~/features/posts/data/post.read-queries.server";

const CREATED = new Date("2026-01-01T00:00:00.000Z");
const UPDATED = new Date("2026-01-02T00:00:00.000Z");
const WHEN = new Date("2026-02-02T00:00:00.000Z");

function fallbackPost(overrides: Partial<FallbackPost> = {}): FallbackPost {
  return {
    id: "post-1",
    userId: "user-1",
    caption: "hello",
    scheduledAtUtc: new Date("2026-03-01T00:00:00.000Z"),
    publishedAt: new Date("2026-03-02T00:00:00.000Z"),
    queueType: { name: "Main", colorToken: "blue" },
    hashTagPresetId: "hash-1",
    createdAt: CREATED,
    updatedAt: UPDATED,
    ...overrides,
  };
}

describe("post read model queries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(WHEN);
    queries.getScheduledPosts.mockReset();
    queries.getScheduledPosts.mockResolvedValue({ posts: [] });
    queries.getPublishedPosts.mockReset();
    queries.getPublishedPosts.mockResolvedValue({
      posts: [],
      pagination: { total: 0, currentPage: 1, limit: 50 },
    });
    db.scheduledFind.mockReset();
    db.scheduledFind.mockResolvedValue([]);
    db.scheduledCount.mockReset();
    db.scheduledCount.mockResolvedValue(0);
    db.publishedFind.mockReset();
    db.publishedFind.mockResolvedValue([]);
    db.publishedCount.mockReset();
    db.publishedCount.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns scheduled read rows and filters a named queue", async () => {
    const rows: ScheduledRead[] = [
      {
        id: "row-1",
        userId: "user-1",
        postId: "post-1",
        caption: "ready",
        scheduledAtUtc: new Date("2026-03-01T00:00:00.000Z"),
        queueTypeName: "Main",
        queueTypeColorToken: "blue",
        hashTagPresetId: null,
        templateId: null,
        createdAt: CREATED,
        updatedAt: UPDATED,
      },
    ];
    db.scheduledFind.mockResolvedValueOnce(rows);
    await expect(
      getScheduledPostsFromReadModel({ userId: "user-1", queueType: "Main" })
    ).resolves.toBe(rows);
    expect(db.scheduledFind).toHaveBeenCalledWith({
      where: { userId: "user-1", queueTypeName: "Main" },
      orderBy: { scheduledAtUtc: "asc" },
    });
    expect(queries.getScheduledPosts).not.toHaveBeenCalled();

    db.scheduledFind.mockResolvedValueOnce(rows);
    await getScheduledPostsFromReadModel({
      userId: "user-1",
      queueType: "all",
    });
    expect(db.scheduledFind.mock.calls.at(-1)?.[0].where).toEqual({
      userId: "user-1",
    });
    await getScheduledPostsFromReadModel({ userId: "user-1" });
    await getScheduledPostsFromReadModel({ userId: "user-1", queueType: "" });
    expect(
      db.scheduledFind.mock.calls.at(-1)?.[0].where.queueTypeName
    ).toBeUndefined();
  });

  it("falls back to scheduled posts when the read model is empty", async () => {
    const post = fallbackPost();
    const missingQueue = fallbackPost({
      id: "post-2",
      caption: null,
      scheduledAtUtc: null,
      queueType: null,
      hashTagPresetId: null,
    });
    const nameless = fallbackPost({
      id: "post-3",
      queueType: {},
    });
    queries.getScheduledPosts.mockResolvedValueOnce({
      posts: [post, missingQueue, nameless],
    });
    const rows = await getScheduledPostsFromReadModel({
      userId: "user-1",
      queueType: "Main",
    });
    expect(queries.getScheduledPosts).toHaveBeenCalledWith({
      userId: "user-1",
      queueType: "Main",
    });
    expect(rows).toEqual([
      {
        id: "post-1",
        userId: "user-1",
        postId: "post-1",
        caption: "hello",
        scheduledAtUtc: new Date("2026-03-01T00:00:00.000Z"),
        queueTypeName: "Main",
        queueTypeColorToken: "blue",
        hashTagPresetId: "hash-1",
        templateId: null,
        createdAt: CREATED,
        updatedAt: UPDATED,
      },
      {
        id: "post-2",
        userId: "user-1",
        postId: "post-2",
        caption: null,
        scheduledAtUtc: WHEN,
        queueTypeName: "unassigned",
        queueTypeColorToken: null,
        hashTagPresetId: null,
        templateId: null,
        createdAt: CREATED,
        updatedAt: UPDATED,
      },
      {
        id: "post-3",
        userId: "user-1",
        postId: "post-3",
        caption: "hello",
        scheduledAtUtc: new Date("2026-03-01T00:00:00.000Z"),
        queueTypeName: "unassigned",
        queueTypeColorToken: null,
        hashTagPresetId: "hash-1",
        templateId: null,
        createdAt: CREATED,
        updatedAt: UPDATED,
      },
    ]);

    queries.getScheduledPosts.mockResolvedValueOnce({ total: 0 });
    await expect(
      getScheduledPostsFromReadModel({ userId: "user-1" })
    ).resolves.toEqual([]);
    queries.getScheduledPosts.mockResolvedValueOnce({ posts: "nope" });
    await expect(
      getScheduledPostsFromReadModel({ userId: "user-1" })
    ).resolves.toEqual([]);

    await expect(
      getScheduledPostsFromReadModel({ userId: "user-1", useFallback: false })
    ).resolves.toEqual([]);
    expect(queries.getScheduledPosts).toHaveBeenCalledTimes(3);
  });

  it("returns published read rows with paging", async () => {
    const rows: PublishedRead[] = [
      {
        id: "pub-1",
        userId: "user-1",
        postId: "post-1",
        caption: "live",
        publishedAt: new Date("2026-03-02T00:00:00.000Z"),
        queueTypeName: "Main",
        queueTypeColorToken: null,
        engagementScore: 3,
        createdAt: CREATED,
        updatedAt: UPDATED,
      },
    ];
    db.publishedFind.mockResolvedValueOnce(rows);
    db.publishedCount.mockResolvedValueOnce(8);
    await expect(
      getPublishedPostsFromReadModel({
        userId: "user-1",
        queueType: "Main",
        page: 2,
        limit: 10,
      })
    ).resolves.toEqual({ posts: rows, total: 8, page: 2, limit: 10 });
    expect(db.publishedFind).toHaveBeenCalledWith({
      where: { userId: "user-1", queueTypeName: "Main" },
      orderBy: { publishedAt: "desc" },
      skip: 10,
      take: 10,
    });

    db.publishedFind.mockResolvedValueOnce([]);
    db.publishedCount.mockResolvedValueOnce(4);
    await expect(
      getPublishedPostsFromReadModel({ userId: "user-1", queueType: "all" })
    ).resolves.toEqual({ posts: [], total: 4, page: 1, limit: 50 });
    expect(queries.getPublishedPosts).not.toHaveBeenCalled();
    expect(db.publishedFind.mock.calls.at(-1)?.[0]).toEqual({
      where: { userId: "user-1" },
      orderBy: { publishedAt: "desc" },
      skip: 0,
      take: 50,
    });
  });

  it("falls back to published posts only when both the page and the total are empty", async () => {
    queries.getPublishedPosts.mockResolvedValueOnce({
      posts: [
        fallbackPost(),
        fallbackPost({
          id: "post-2",
          publishedAt: null,
          queueType: null,
          caption: null,
          hashTagPresetId: null,
        }),
      ],
      pagination: { total: 2, currentPage: 3, limit: 5 },
    });
    const page = await getPublishedPostsFromReadModel({
      userId: "user-1",
      queueType: "Main",
      page: 3,
      limit: 5,
    });
    expect(queries.getPublishedPosts).toHaveBeenCalledWith({
      userId: "user-1",
      queueType: "Main",
      page: 3,
      limit: 5,
    });
    expect(page.total).toBe(2);
    expect(page.page).toBe(3);
    expect(page.limit).toBe(5);
    expect(page.posts[0]?.queueTypeName).toBe("Main");
    expect(page.posts[0]?.engagementScore).toBeNull();
    expect(page.posts[1]).toMatchObject({
      id: "post-2",
      publishedAt: WHEN,
      queueTypeName: "unassigned",
      queueTypeColorToken: null,
      caption: null,
    });

    await getPublishedPostsFromReadModel({
      userId: "user-1",
      useFallback: false,
    });
    expect(queries.getPublishedPosts).toHaveBeenCalledTimes(1);
  });

  it("counts scheduled and published rows and treats either side as populated", async () => {
    db.scheduledCount.mockResolvedValueOnce(6);
    db.publishedCount.mockResolvedValueOnce(7);
    await expect(
      getPostStatisticsFromReadModel({ userId: "user-1" })
    ).resolves.toEqual({ scheduledCount: 6, successCount: 7 });
    expect(db.scheduledCount).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(db.publishedCount).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });

    db.scheduledCount.mockResolvedValueOnce(0);
    db.publishedCount.mockResolvedValueOnce(0);
    await expect(areReadModelsPopulated("user-1")).resolves.toBe(false);
    db.scheduledCount.mockResolvedValueOnce(1);
    db.publishedCount.mockResolvedValueOnce(0);
    await expect(areReadModelsPopulated("user-1")).resolves.toBe(true);
    db.scheduledCount.mockResolvedValueOnce(0);
    db.publishedCount.mockResolvedValueOnce(2);
    await expect(areReadModelsPopulated("user-1")).resolves.toBe(true);
  });

  it("propagates read and fallback failures", async () => {
    db.scheduledFind.mockRejectedValueOnce(new Error("scheduled read"));
    await expect(
      getScheduledPostsFromReadModel({ userId: "user-1", useFallback: false })
    ).rejects.toThrow("scheduled read");
    db.scheduledFind.mockRejectedValueOnce("scheduled string");
    await expect(
      getScheduledPostsFromReadModel({ userId: "user-1", useFallback: false })
    ).rejects.toBe("scheduled string");

    queries.getScheduledPosts.mockRejectedValueOnce(new Error("fallback"));
    await expect(
      getScheduledPostsFromReadModel({ userId: "user-1" })
    ).rejects.toThrow("fallback");
    queries.getPublishedPosts.mockRejectedValueOnce("published string");
    await expect(
      getPublishedPostsFromReadModel({ userId: "user-1" })
    ).rejects.toBe("published string");
    db.publishedCount.mockRejectedValueOnce(new Error("count down"));
    await expect(areReadModelsPopulated("user-1")).rejects.toThrow(
      "count down"
    );
  });
});
