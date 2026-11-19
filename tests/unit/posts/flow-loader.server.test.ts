import { beforeEach, describe, expect, it, vi } from "vitest";

interface RawPost {
  id: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  status: string;
  currentState: string;
  signedEvent: null;
  nostrEvent: null;
  fileUrl?: string[];
  tags: string[];
  manual_override: boolean;
  repost?: boolean;
  isQuotedPost: boolean;
  isRecyclable: boolean;
  postType?: string | null;
  postKind?: string;
  publishedAt: Date | null;
  scheduledAtUtc: Date | null;
  threadGroupId?: string | null;
  dependencyMode?: string;
  parentScheduledActionId?: string | null;
  repostOf?: { fileUrl: string[]; postType: string | null } | null;
  queueType?: { name: string } | null;
}

interface RawLongform {
  id: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  status: string;
  currentState: string;
  title: string;
  content: string;
  tags: string[];
  signedEvent: null;
  nostrEvent: null;
  queueType: { name: string } | null;
  scheduledAtUtc: Date | null;
  publishedAt: Date | null;
}

interface Page<T> {
  posts: T[];
  pagination: {
    total: number;
    pages: number;
    currentPage: number;
    limit: number;
  };
}

interface PastQuery {
  userId: string;
  startDate: Date;
  endDate: Date;
  queueType: string;
  beforeDate?: Date;
  limit: number;
  contentTab?: string;
}

interface ScheduledQuery {
  userId: string;
  queueType: string;
  page: number;
  limit: number;
  afterScheduledAtUtc: Date;
  afterScheduledAtUtcInclusive: boolean;
  contentTab?: string;
  excludePausedQueueContent: boolean;
}

interface LatestQuery {
  userId: string;
  queueType: string;
  now: Date;
  excludePausedQueueContent: boolean;
}

interface QueueRow {
  id: string;
  name: string;
  userId: string;
  scheduleConfig: null;
  status: string;
  isEnabled?: boolean;
}

interface FlowRow {
  type: string;
  data: {
    id: string;
    fileUrl?: string[];
    postType?: string | null;
    postKind?: string | null;
  };
}

interface TemporalModule {
  fromDate: (date: Date, timezone?: string) => unknown;
  toPrismaDate: (value: unknown) => Date | null;
}

const postsApi = vi.hoisted(() => ({
  getPastPosts: vi.fn(async (_query: PastQuery): Promise<RawPost[]> => []),
  getPastLongFormPosts: vi.fn(
    async (_query: PastQuery): Promise<RawLongform[]> => []
  ),
  getScheduledPosts: vi.fn(
    async (_query: ScheduledQuery): Promise<Page<RawPost>> => ({
      posts: [],
      pagination: { total: 0, pages: 0, currentPage: 1, limit: 0 },
    })
  ),
  getScheduledLongFormPosts: vi.fn(
    async (_query: ScheduledQuery): Promise<Page<RawLongform>> => ({
      posts: [],
      pagination: { total: 0, pages: 0, currentPage: 1, limit: 0 },
    })
  ),
  getLatestScheduledAtUtc: vi.fn(
    async (_query: LatestQuery): Promise<Date | null> => null
  ),
  getLatestScheduledLongFormAtUtc: vi.fn(
    async (_query: LatestQuery): Promise<Date | null> => null
  ),
}));

const users = vi.hoisted(() => ({
  getUserById: vi.fn(async (_userId: string) => ({
    id: "user-1",
    name: "Ada",
  })),
  getQueueTypesCached: vi.fn(
    async (_userId: string): Promise<Array<QueueRow | null>> => []
  ),
  getHashTagPresetsCached: vi.fn(async (_userId: string) => []),
}));

const clock = vi.hoisted(() => ({ fail: false }));

vi.mock("~/lib/temporal", async () => {
  const actual = await vi.importActual<TemporalModule>("~/lib/temporal");
  return {
    ...actual,
    nowUTC: () => actual.fromDate(new Date("2026-06-15T12:00:00.000Z"), "UTC"),
    toPrismaDate: (value: unknown) =>
      clock.fail ? null : actual.toPrismaDate(value),
  };
});
vi.mock("~/features/posts/server", () => postsApi);
vi.mock("~/features/user", () => ({ getUserById: users.getUserById }));
vi.mock("~/features/user/services/user-cache.server", () => ({
  getQueueTypesCached: users.getQueueTypesCached,
  getHashTagPresetsCached: users.getHashTagPresetsCached,
}));

import { loadFlowData } from "~/features/posts/services/flow-loader.server";
import { addDays, nowUTC, toPrismaDate } from "~/lib/temporal";

const USER = { id: "user-1", name: "Ada" };
const PRESETS = [{ id: "hash-1", name: "Tags", tags: "#nostr" }];
const QUEUES: Array<QueueRow | null> = [
  {
    id: "q-main",
    name: "Main",
    userId: "user-1",
    scheduleConfig: null,
    status: "active",
  },
  {
    id: "q-old",
    name: "Old",
    userId: "user-1",
    scheduleConfig: null,
    status: "archived",
  },
  null,
  {
    id: "q-paused",
    name: "Paused",
    userId: "user-1",
    scheduleConfig: null,
    status: "paused",
    isEnabled: false,
  },
];

function rawPost(
  overrides: Partial<RawPost> & Pick<RawPost, "id" | "currentState">
): RawPost {
  return {
    userId: "user-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    status: "ACTIVE",
    signedEvent: null,
    nostrEvent: null,
    fileUrl: [],
    tags: [],
    manual_override: false,
    isQuotedPost: false,
    isRecyclable: false,
    postType: "TEXT",
    publishedAt: null,
    scheduledAtUtc: null,
    ...overrides,
  };
}

function rawLongform(
  overrides: Partial<RawLongform> & Pick<RawLongform, "id" | "currentState">
): RawLongform {
  return {
    userId: "user-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    status: "ACTIVE",
    title: overrides.id,
    content: "article",
    tags: [],
    signedEvent: null,
    nostrEvent: null,
    queueType: { name: "Main" },
    scheduledAtUtc: null,
    publishedAt: null,
    ...overrides,
  };
}

function page<T>(posts: T[]): Page<T> {
  return {
    posts,
    pagination: {
      total: posts.length,
      pages: 1,
      currentPage: 1,
      limit: posts.length,
    },
  };
}

function idsOf(items: FlowRow[]): string[] {
  return items.map((item) => item.data.id);
}

function windowDates(): { now: Date; start: Date } {
  const zoned = nowUTC();
  const now = toPrismaDate(zoned);
  const start = toPrismaDate(addDays(zoned, -30));
  if (!now || !start) throw new Error("expected window dates");
  return { now, start };
}

describe("loadFlowData", () => {
  beforeEach(() => {
    clock.fail = false;
    postsApi.getPastPosts.mockReset();
    postsApi.getPastPosts.mockResolvedValue([]);
    postsApi.getPastLongFormPosts.mockReset();
    postsApi.getPastLongFormPosts.mockResolvedValue([]);
    postsApi.getScheduledPosts.mockReset();
    postsApi.getScheduledPosts.mockResolvedValue(page([]));
    postsApi.getScheduledLongFormPosts.mockReset();
    postsApi.getScheduledLongFormPosts.mockResolvedValue(page([]));
    postsApi.getLatestScheduledAtUtc.mockReset();
    postsApi.getLatestScheduledAtUtc.mockResolvedValue(null);
    postsApi.getLatestScheduledLongFormAtUtc.mockReset();
    postsApi.getLatestScheduledLongFormAtUtc.mockResolvedValue(null);
    users.getUserById.mockReset();
    users.getUserById.mockResolvedValue(USER);
    users.getQueueTypesCached.mockReset();
    users.getQueueTypesCached.mockResolvedValue(QUEUES);
    users.getHashTagPresetsCached.mockReset();
    users.getHashTagPresetsCached.mockResolvedValue(PRESETS);
  });

  it("throws before loading when a temporal date cannot be converted", async () => {
    clock.fail = true;
    await expect(loadFlowData({ userId: "user-1" })).rejects.toThrow(
      "Failed to convert Temporal dates to Date"
    );
    expect(users.getUserById).not.toHaveBeenCalled();
  });

  it("orders the initial window, counts kinds, and hides archived queues", async () => {
    postsApi.getPastPosts.mockResolvedValue([
      rawPost({
        id: "past-old",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-05-01T00:00:00.000Z"),
        postKind: "POST",
      }),
      rawPost({
        id: "past-poll",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-06-01T00:00:00.000Z"),
        postType: "POLL",
        postKind: "POST",
      }),
      rawPost({
        id: "past-repost",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-06-10T00:00:00.000Z"),
        postKind: "REPOST",
      }),
      rawPost({
        id: "past-attached",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-06-11T00:00:00.000Z"),
        postKind: "REPOST",
        dependencyMode: "attached",
        parentScheduledActionId: "parent",
      }),
      rawPost({
        id: "thread-a",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-06-12T00:00:00.000Z"),
        threadGroupId: "group-1",
      }),
      rawPost({
        id: "thread-b",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-06-13T00:00:00.000Z"),
        threadGroupId: "group-1",
      }),
    ]);
    postsApi.getScheduledPosts.mockResolvedValue(
      page([
        rawPost({
          id: "future-b",
          currentState: "SCHEDULED",
          scheduledAtUtc: new Date("2026-06-20T00:00:00.000Z"),
        }),
        rawPost({
          id: "future-a",
          currentState: "SCHEDULED",
          scheduledAtUtc: new Date("2026-06-20T00:00:00.000Z"),
        }),
      ])
    );
    postsApi.getScheduledLongFormPosts.mockResolvedValue(
      page([
        rawLongform({
          id: "future-article",
          currentState: "SCHEDULED",
          scheduledAtUtc: new Date("2026-06-20T00:00:00.000Z"),
        }),
      ])
    );
    postsApi.getLatestScheduledAtUtc.mockResolvedValue(
      new Date("2026-07-02T00:00:00.000Z")
    );
    postsApi.getLatestScheduledLongFormAtUtc.mockResolvedValue(
      new Date("2026-07-01T00:00:00.000Z")
    );

    const result = await loadFlowData({ userId: "user-1", queueType: "Main" });
    expect(idsOf(result.flowItems)).toEqual([
      "past-old",
      "past-poll",
      "past-repost",
      "past-attached",
      "thread-a",
      "future-article",
      "future-a",
      "future-b",
    ]);
    expect(result.flowItems[5]?.type).toBe("longform");
    expect(result.hasMorePast).toBe(false);
    expect(result.hasMoreFuture).toBe(false);
    expect(result.pastCursor).toBe(
      String(Date.parse("2026-05-01T00:00:00.000Z"))
    );
    expect(result.futureCursor).toBe(
      `${String(Date.parse("2026-06-20T00:00:00.000Z"))}|post|future-b`
    );
    expect(result.lastScheduledAtUtc).toBe(
      Date.parse("2026-07-02T00:00:00.000Z")
    );
    expect(result.user).toBe(USER);
    expect(result.hashTagPresets).toBe(PRESETS);
    expect(result.queueTypes.map((queue) => queue.name)).toEqual([
      "Main",
      "Paused",
    ]);
    expect(result.flowTotalCount).toBe(8);
    expect(result.flowPostsCount).toBe(5);
    expect(result.flowRepostsCount).toBe(1);
    expect(result.flowLongformCount).toBe(1);
    expect(result.flowPollsCount).toBe(1);

    const dates = windowDates();
    expect(postsApi.getPastPosts).toHaveBeenCalledWith({
      userId: "user-1",
      startDate: dates.start,
      endDate: dates.now,
      queueType: "Main",
      limit: 21,
      contentTab: undefined,
    });
    expect(postsApi.getScheduledPosts).toHaveBeenCalledWith({
      userId: "user-1",
      queueType: "Main",
      page: 1,
      limit: 31,
      afterScheduledAtUtc: dates.now,
      afterScheduledAtUtcInclusive: true,
      contentTab: undefined,
      excludePausedQueueContent: true,
    });
    expect(postsApi.getLatestScheduledAtUtc).toHaveBeenCalledWith({
      userId: "user-1",
      queueType: "Main",
      now: dates.now,
      excludePausedQueueContent: true,
    });
  });

  it("keeps the newest past rows and the earliest future rows when limited", async () => {
    postsApi.getPastPosts.mockResolvedValue([
      rawPost({
        id: "p1",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-05-01T00:00:00.000Z"),
      }),
      rawPost({
        id: "p2",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-05-02T00:00:00.000Z"),
      }),
      rawPost({
        id: "p3",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-05-03T00:00:00.000Z"),
      }),
    ]);
    postsApi.getScheduledPosts.mockResolvedValue(
      page([
        rawPost({
          id: "f1",
          currentState: "SCHEDULED",
          scheduledAtUtc: new Date("2026-07-01T00:00:00.000Z"),
        }),
        rawPost({
          id: "f2",
          currentState: "SCHEDULED",
          scheduledAtUtc: new Date("2026-07-02T00:00:00.000Z"),
        }),
      ])
    );
    const result = await loadFlowData({
      userId: "user-1",
      pastLimit: 2,
      futureLimit: 1,
    });
    expect(idsOf(result.flowItems)).toEqual(["p2", "p3", "f1"]);
    expect(result.hasMorePast).toBe(true);
    expect(result.hasMoreFuture).toBe(true);
    expect(result.pastCursor).toBe(
      String(Date.parse("2026-05-02T00:00:00.000Z"))
    );
    expect(result.futureCursor).toBe(
      `${String(Date.parse("2026-07-01T00:00:00.000Z"))}|post|f1`
    );
    expect(result.flowTotalCount).toBe(5);
  });

  it("inherits repost media only when the repost has no files of its own", async () => {
    postsApi.getPastPosts.mockResolvedValue([
      rawPost({
        id: "inherit-missing",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-06-01T00:00:00.000Z"),
        repost: true,
        fileUrl: undefined,
        postType: "TEXT",
        repostOf: { fileUrl: ["https://cdn/source"], postType: "IMAGE" },
      }),
      rawPost({
        id: "inherit-empty",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-06-02T00:00:00.000Z"),
        postKind: "REPOST",
        fileUrl: [],
        repostOf: { fileUrl: ["https://cdn/kind"], postType: "VIDEO" },
      }),
      rawPost({
        id: "keep-own",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-06-03T00:00:00.000Z"),
        repost: true,
        fileUrl: ["https://cdn/own"],
        repostOf: { fileUrl: ["https://cdn/source"], postType: "IMAGE" },
      }),
      rawPost({
        id: "repost-flag-off",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-06-04T00:00:00.000Z"),
        repost: false,
        postKind: "REPOST",
        fileUrl: [],
        repostOf: { fileUrl: ["https://cdn/ignored"], postType: "IMAGE" },
      }),
      rawPost({
        id: "plain",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-06-05T00:00:00.000Z"),
        fileUrl: undefined,
        postType: null,
      }),
    ]);
    const result = await loadFlowData({
      userId: "user-1",
      before: "",
      after: "",
    });
    const rows = result.flowItems;
    expect(rows[0]?.data.fileUrl).toEqual(["https://cdn/source"]);
    expect(rows[0]?.data.postType).toBe("IMAGE");
    expect(rows[1]?.data.fileUrl).toEqual(["https://cdn/kind"]);
    expect(rows[1]?.data.postType).toBe("VIDEO");
    expect(rows[2]?.data.fileUrl).toEqual(["https://cdn/own"]);
    expect(rows[2]?.data.postType).toBe("TEXT");
    expect(rows[3]?.data.fileUrl).toEqual([]);
    expect(rows[4]?.data.fileUrl).toEqual([]);
    expect(rows[4]?.data.postType).toBeUndefined();
    expect(postsApi.getPastPosts.mock.calls[0]?.[0].beforeDate).toBeUndefined();
  });

  it("pages older rows from a before cursor and omits the window totals", async () => {
    postsApi.getPastPosts.mockResolvedValue([
      rawPost({
        id: "third",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-06-03T00:00:00.000Z"),
      }),
      rawPost({
        id: "first",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ]);
    postsApi.getPastLongFormPosts.mockResolvedValue([
      rawLongform({
        id: "article",
        currentState: "PUBLISHED",
        publishedAt: new Date("2026-06-02T00:00:00.000Z"),
        queueType: null,
      }),
    ]);
    postsApi.getLatestScheduledAtUtc.mockResolvedValue(new Date(0));
    const result = await loadFlowData({
      userId: "user-1",
      before: "1717200000000",
      pastLimit: 2,
    });
    expect(idsOf(result.flowItems)).toEqual(["first", "article"]);
    expect(result.flowItems[1]?.type).toBe("longform");
    expect(result.hasMorePast).toBe(true);
    expect(result.hasMoreFuture).toBe(false);
    expect(result.pastCursor).toBe(
      String(Date.parse("2026-06-01T00:00:00.000Z"))
    );
    expect(result.futureCursor).toBeNull();
    expect(result.lastScheduledAtUtc).toBeNull();
    expect(result.flowTotalCount).toBeUndefined();
    expect(postsApi.getScheduledPosts).not.toHaveBeenCalled();
    const query = postsApi.getPastPosts.mock.calls[0]?.[0];
    expect(query?.beforeDate).toEqual(new Date(1_717_200_000_000));
    expect(query?.endDate).toEqual(new Date(1_717_200_000_000));
    expect(query?.limit).toBe(3);

    postsApi.getPastPosts.mockResolvedValue([]);
    postsApi.getPastLongFormPosts.mockResolvedValue([]);
    const empty = await loadFlowData({ userId: "user-1", before: "1" });
    expect(empty.flowItems).toEqual([]);
    expect(empty.pastCursor).toBeNull();
    expect(empty.hasMorePast).toBe(false);
  });

  it("filters a future cursor by time, type, and id", async () => {
    const at = Date.parse("2026-06-20T00:00:00.000Z");
    postsApi.getScheduledPosts.mockResolvedValue(
      page([
        rawPost({
          id: "a",
          currentState: "SCHEDULED",
          scheduledAtUtc: new Date(at),
        }),
        rawPost({
          id: "b",
          currentState: "SCHEDULED",
          scheduledAtUtc: new Date(at),
        }),
        rawPost({
          id: "early",
          currentState: "SCHEDULED",
          scheduledAtUtc: new Date(at - 1000),
        }),
        rawPost({
          id: "hello world",
          currentState: "SCHEDULED",
          scheduledAtUtc: new Date(at + 2000),
        }),
        rawPost({
          id: "zero",
          currentState: "PUBLISHED",
        }),
      ])
    );
    postsApi.getScheduledLongFormPosts.mockResolvedValue(
      page([
        rawLongform({
          id: "z",
          currentState: "SCHEDULED",
          scheduledAtUtc: new Date(at),
        }),
        rawLongform({
          id: "later",
          currentState: "SCHEDULED",
          scheduledAtUtc: new Date(at + 1000),
          queueType: { name: "Other" },
        }),
      ])
    );

    const tied = await loadFlowData({
      userId: "user-1",
      after: `${String(at)}|post|a`,
      futureLimit: 10,
      queueType: "all",
    });
    expect(idsOf(tied.flowItems)).toEqual(["b", "later", "hello world"]);
    expect(tied.hasMorePast).toBe(false);
    expect(tied.hasMoreFuture).toBe(false);
    expect(tied.pastCursor).toBeNull();
    expect(tied.futureCursor).toBe(`${String(at + 2000)}|post|hello%20world`);
    expect(tied.flowTotalCount).toBeUndefined();
    expect(postsApi.getScheduledPosts.mock.calls[0]?.[0].limit).toBe(131);
    expect(postsApi.getPastPosts).not.toHaveBeenCalled();

    const pageOne = await loadFlowData({
      userId: "user-1",
      after: `${String(at)}|post|a`,
      futureLimit: 1,
    });
    expect(idsOf(pageOne.flowItems)).toEqual(["b"]);
    expect(pageOne.hasMoreFuture).toBe(true);
    expect(pageOne.futureCursor).toBe(`${String(at)}|post|b`);

    const timeOnly = await loadFlowData({
      userId: "user-1",
      after: String(at),
      futureLimit: 10,
    });
    expect(idsOf(timeOnly.flowItems)).toEqual(["later", "hello world"]);

    const invalid = await loadFlowData({
      userId: "user-1",
      after: "nope|post|a",
      futureLimit: 10,
    });
    expect(idsOf(invalid.flowItems)).not.toContain("zero");
    expect(idsOf(invalid.flowItems)).toContain("early");
  });

  it("filters future articles by queue name or the unassigned bucket", async () => {
    const at = Date.parse("2026-08-01T00:00:00.000Z");
    postsApi.getScheduledLongFormPosts.mockResolvedValue(
      page([
        rawLongform({
          id: "main",
          currentState: "SCHEDULED",
          scheduledAtUtc: new Date(at),
          queueType: { name: "Main" },
        }),
        rawLongform({
          id: "other",
          currentState: "SCHEDULED",
          scheduledAtUtc: new Date(at + 1000),
          queueType: { name: "Other" },
        }),
        rawLongform({
          id: "none",
          currentState: "SCHEDULED",
          scheduledAtUtc: new Date(at + 2000),
          queueType: null,
        }),
      ])
    );
    const named = await loadFlowData({
      userId: "user-1",
      queueType: "Main",
      after: "1",
    });
    expect(idsOf(named.flowItems)).toEqual(["main"]);

    const unassigned = await loadFlowData({
      userId: "user-1",
      queueType: "unassigned",
      after: "1",
    });
    expect(idsOf(unassigned.flowItems)).toEqual(["none"]);
  });

  it("fetches only the content tab that was requested", async () => {
    await loadFlowData({ userId: "user-1", contentTab: "posts" });
    expect(postsApi.getPastPosts.mock.calls.at(-1)?.[0].contentTab).toBe(
      "posts"
    );
    expect(postsApi.getPastLongFormPosts).not.toHaveBeenCalled();

    postsApi.getPastPosts.mockClear();
    await loadFlowData({ userId: "user-1", contentTab: "reposts" });
    expect(postsApi.getPastPosts.mock.calls.at(-1)?.[0].contentTab).toBe(
      "reposts"
    );
    await loadFlowData({ userId: "user-1", contentTab: "polls" });
    expect(postsApi.getPastPosts.mock.calls.at(-1)?.[0].contentTab).toBe(
      "polls"
    );
    await loadFlowData({ userId: "user-1", contentTab: "followups" });
    expect(postsApi.getPastPosts.mock.calls.at(-1)?.[0].contentTab).toBe(
      "followups"
    );

    postsApi.getPastPosts.mockClear();
    postsApi.getScheduledPosts.mockClear();
    await loadFlowData({ userId: "user-1", contentTab: "longform" });
    expect(postsApi.getPastPosts).not.toHaveBeenCalled();
    expect(postsApi.getScheduledPosts).not.toHaveBeenCalled();
    expect(postsApi.getPastLongFormPosts).toHaveBeenCalled();
    expect(postsApi.getScheduledLongFormPosts).toHaveBeenCalled();

    postsApi.getPastLongFormPosts.mockClear();
    await loadFlowData({ userId: "user-1" });
    expect(postsApi.getPastPosts.mock.calls.at(-1)?.[0].queueType).toBe("all");
    expect(
      postsApi.getPastPosts.mock.calls.at(-1)?.[0].contentTab
    ).toBeUndefined();
    expect(postsApi.getPastLongFormPosts).toHaveBeenCalled();
  });

  it("picks the later scheduled instant and treats epoch as empty", async () => {
    postsApi.getLatestScheduledAtUtc.mockResolvedValue(null);
    postsApi.getLatestScheduledLongFormAtUtc.mockResolvedValue(
      new Date("2026-08-01T00:00:00.000Z")
    );
    const longform = await loadFlowData({ userId: "user-1" });
    expect(longform.lastScheduledAtUtc).toBe(
      Date.parse("2026-08-01T00:00:00.000Z")
    );

    postsApi.getLatestScheduledAtUtc.mockResolvedValue(new Date(0));
    postsApi.getLatestScheduledLongFormAtUtc.mockResolvedValue(null);
    const epoch = await loadFlowData({ userId: "user-1" });
    expect(epoch.lastScheduledAtUtc).toBeNull();

    postsApi.getLatestScheduledAtUtc.mockResolvedValue(null);
    postsApi.getLatestScheduledLongFormAtUtc.mockResolvedValue(null);
    const empty = await loadFlowData({ userId: "user-1", before: "5" });
    expect(empty.lastScheduledAtUtc).toBeNull();
    expect(
      postsApi.getLatestScheduledAtUtc.mock.calls.at(-1)?.[0].now
    ).toBeInstanceOf(Date);
  });

  it("propagates loader dependency failures", async () => {
    users.getUserById.mockRejectedValueOnce(new Error("user down"));
    await expect(loadFlowData({ userId: "user-1" })).rejects.toThrow(
      "user down"
    );
    users.getUserById.mockRejectedValueOnce("user string");
    await expect(loadFlowData({ userId: "user-1" })).rejects.toBe(
      "user string"
    );
    postsApi.getLatestScheduledAtUtc.mockRejectedValueOnce("latest string");
    await expect(loadFlowData({ userId: "user-1" })).rejects.toBe(
      "latest string"
    );
  });
});
