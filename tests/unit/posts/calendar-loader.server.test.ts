import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  getScheduledPosts:
    vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
  getScheduledLongFormPosts:
    vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
  getPastPosts: vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
  getPastLongFormPosts:
    vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
  pickRescheduleSourceSignedEvents:
    vi.fn<(input: unknown) => Record<string, unknown>>(),
}));

const userApi = vi.hoisted(() => ({
  getUserById: vi.fn<(userId: string) => Promise<unknown>>(),
  getQueueTypes: vi.fn<(userId: string) => Promise<unknown[]>>(),
}));

const dtos = vi.hoisted(() => ({
  toPostDTOArray: vi.fn<(posts: unknown[]) => unknown[]>((posts) => posts),
  toLongFormPostDTOArray: vi.fn<(posts: unknown[]) => unknown[]>(
    (posts) => posts
  ),
}));

const queueColors = vi.hoisted(() => ({
  getQueueAccentHex: vi.fn<(token: string | null) => string>(),
}));

const queueStatus = vi.hoisted(() => ({
  shouldShowQueueInUi: vi.fn<(queue: unknown) => boolean>(),
}));

const filtering = vi.hoisted(() => ({
  filterPostsByQueueType:
    vi.fn<(posts: unknown[], queueType: string) => unknown[]>(),
}));

const postTypes = vi.hoisted(() => ({
  convertJsonValueToScheduleConfig: vi.fn<(config: unknown) => unknown>(),
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: {},
}));
vi.mock("~/features/posts/combined.server", () => ({
  combineContent: vi.fn(),
}));
vi.mock("~/features/posts/dtos", () => dtos);
vi.mock("~/features/posts/queue-colors", () => queueColors);
vi.mock("~/features/posts/queue-status", () => queueStatus);
vi.mock("~/features/posts/server", () => server);
vi.mock("~/features/posts/services/post-filtering.server", () => filtering);
vi.mock("~/features/posts/types", () => postTypes);
vi.mock("~/features/user", () => userApi);

import {
  loadCalendarData,
  loadCalendarPublishedRange,
  loadCalendarQueueData,
} from "~/features/posts/calendar/services/calendar-loader.server";

const USER_ID = "user-1";
const SIGNED = {
  id: "a".repeat(64),
  pubkey: "b".repeat(64),
  created_at: 1_700_000_000,
  kind: 1,
  tags: [["t", "tag"]],
  content: "hello",
  sig: "c".repeat(64),
};
const NOSTR = {
  content: "hello",
  created_at: 1_700_000_000,
  kind: 1,
  tags: [["t", "tag"]],
};

const fullQueue = {
  id: "queue-1",
  name: "posts",
  colorToken: "teal",
  description: "Primary",
  scheduleType: "INTERVAL",
  scheduleConfig: { intervalHours: 3 },
  isEnabled: true,
  userId: USER_ID,
};

const sparseQueue = {
  id: "queue-2",
  name: "sparse",
  colorToken: null,
  description: null,
  scheduleConfig: null,
  isEnabled: false,
  userId: "user-2",
};

const emptyPagination = {
  total: 0,
  pages: 1,
  currentPage: 1,
  limit: 20,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new Error("expected array");
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error("expected record");
    }
    return item;
  });
}

function byId(
  records: Array<Record<string, unknown>>,
  id: string
): Record<string, unknown> {
  const found = records.find((record) => record["id"] === id);
  if (!found) {
    throw new Error(`missing post ${id}`);
  }
  return found;
}

function expectQueue(
  post: Record<string, unknown>,
  expected: Record<string, unknown>
): void {
  const queue = post["queueType"];
  if (!isRecord(queue)) {
    throw new Error(`expected queue on ${String(post["id"])}`);
  }
  expect(queue).toEqual(expected);
}

describe("calendar loaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filtering.filterPostsByQueueType.mockImplementation((posts) => posts);
    queueColors.getQueueAccentHex.mockImplementation((token) =>
      typeof token === "string" && token.length > 0 ? token : "none"
    );
    queueStatus.shouldShowQueueInUi.mockImplementation((queue) => {
      if (!isRecord(queue)) return true;
      return queue["status"] !== "archived";
    });
    postTypes.convertJsonValueToScheduleConfig.mockImplementation((config) => {
      if (config === null || config === undefined) return undefined;
      if (typeof config !== "object") return undefined;
      return { from: "converted" };
    });
    server.pickRescheduleSourceSignedEvents.mockReturnValue({
      repostSourceSignedEvent: "repost-source",
      quoteSourceSignedEvent: null,
      quoteLongFormSourceSignedEvent: "longform-source",
    });
    server.getScheduledPosts.mockResolvedValue({
      posts: [],
      pagination: emptyPagination,
    });
    server.getScheduledLongFormPosts.mockResolvedValue({
      posts: [],
      pagination: emptyPagination,
    });
    server.getPastPosts.mockResolvedValue([]);
    server.getPastLongFormPosts.mockResolvedValue([]);
    userApi.getUserById.mockResolvedValue(null);
    userApi.getQueueTypes.mockResolvedValue([]);
  });

  it("maps posts, articles, queues, and pagination", async () => {
    const shortPosts = [
      {
        id: "plain",
        fileUrl: ["https://plain"],
        postType: "IMAGE",
        repost: false,
        postKind: "NOTE",
        queueType: fullQueue,
        signedEvent: SIGNED,
        nostrEvent: NOSTR,
        repostOf: {
          fileUrl: ["https://unused"],
          postType: "VIDEO",
          signedEvent: { id: "repost-src" },
        },
        quoteOf: { signedEvent: { id: "quote-src" } },
        quoteOfLongForm: { signedEvent: { id: "long-src" } },
      },
      {
        id: "repost-empty",
        repost: true,
        postKind: "NOTE",
        fileUrl: [],
        postType: "TEXT",
        repostOf: {
          fileUrl: ["https://orig"],
          postType: "VIDEO",
          signedEvent: { id: "re" },
        },
      },
      {
        id: "repost-kind",
        repost: false,
        postKind: "REPOST",
        postType: "ORIGINAL",
        repostOf: { fileUrl: ["https://kind"], postType: null },
      },
      {
        id: "repost-own-media",
        repost: true,
        postKind: "REPOST",
        fileUrl: ["https://own"],
        postType: "IMAGE",
        repostOf: { fileUrl: ["https://ignored"], postType: "VIDEO" },
        queueType: sparseQueue,
      },
      {
        id: "repost-no-source",
        repost: true,
        fileUrl: [],
        postType: null,
        repostOf: null,
      },
      {
        id: "no-queue",
        fileUrl: ["https://nq"],
        postType: null,
        signedEvent: null,
        nostrEvent: null,
      },
    ];
    const scheduledLongform = [
      {
        id: "lf-none",
        title: "None",
        queueType: null,
        signedEvent: null,
        nostrEvent: null,
      },
      {
        id: "lf-nullish",
        title: "Nullish",
        signedEvent: SIGNED,
        nostrEvent: NOSTR,
        queueType: {
          id: "q-null",
          name: "Nullish",
          colorToken: null,
          description: null,
          scheduleType: null,
          scheduleConfig: null,
          isEnabled: null,
          userId: null,
        },
      },
      {
        id: "lf-full",
        title: "Full",
        queueType: fullQueue,
        signedEvent: null,
        nostrEvent: null,
      },
    ];
    const pastLongform = [
      { id: "pl-null", title: "Null", queueType: null },
      { id: "pl-num", title: "Num", queueType: 5 },
      { id: "pl-noid", title: "NoId", queueType: { name: "only-name" } },
      { id: "pl-noname", title: "NoName", queueType: { id: "only-id" } },
      { id: "pl-min", title: "Min", queueType: { id: "min", name: "Min" } },
      {
        id: "pl-nullish",
        title: "Nullish",
        queueType: {
          id: "n",
          name: "N",
          colorToken: null,
          description: null,
          scheduleType: null,
          isEnabled: null,
          userId: null,
          scheduleConfig: null,
        },
      },
      {
        id: "pl-full",
        title: "Full",
        signedEvent: SIGNED,
        nostrEvent: NOSTR,
        queueType: {
          ...fullQueue,
          id: "full",
          name: "Full",
          scheduleType: "FIXED_SLOTS",
        },
      },
    ];
    const user = { id: USER_ID, scheduleInterval: [6, 12] };
    const queues = [
      { id: "shown", name: "Shown", status: "active" },
      { id: "hidden", name: "Hidden", status: "archived" },
    ];

    server.getScheduledPosts.mockResolvedValue({
      posts: shortPosts,
      pagination: { total: 40, pages: 4, currentPage: 2, limit: 25 },
    });
    server.getScheduledLongFormPosts.mockResolvedValue({
      posts: scheduledLongform,
      pagination: { total: 9, pages: 3, currentPage: 2, limit: 15 },
    });
    server.getPastPosts.mockResolvedValue(shortPosts);
    server.getPastLongFormPosts.mockResolvedValue(pastLongform);
    userApi.getUserById.mockResolvedValue(user);
    userApi.getQueueTypes.mockResolvedValue(queues);

    const result = await loadCalendarData(USER_ID, "posts");
    const scheduled = asRecords(dtos.toPostDTOArray.mock.calls[0]?.[0]);
    const past = asRecords(dtos.toPostDTOArray.mock.calls[1]?.[0]);
    const scheduledArticles = asRecords(
      dtos.toLongFormPostDTOArray.mock.calls[0]?.[0]
    );
    const pastArticles = asRecords(
      dtos.toLongFormPostDTOArray.mock.calls[1]?.[0]
    );

    expect(scheduled).toHaveLength(shortPosts.length);
    expect(past).toEqual(scheduled);

    const plain = byId(scheduled, "plain");
    expect(plain["fileUrl"]).toEqual(["https://plain"]);
    expect(plain["postType"]).toBe("IMAGE");
    expect(plain["signedEvent"]).toEqual(SIGNED);
    expect(plain["nostrEvent"]).toEqual(NOSTR);
    expect(plain["repostSourceSignedEvent"]).toBe("repost-source");
    expect(plain["quoteSourceSignedEvent"]).toBeNull();
    expect(plain["quoteLongFormSourceSignedEvent"]).toBe("longform-source");
    expect(plain).not.toHaveProperty("repostOf");
    expect(plain).not.toHaveProperty("quoteOf");
    expect(plain).not.toHaveProperty("quoteOfLongForm");
    expectQueue(plain, {
      id: "queue-1",
      name: "posts",
      color: "teal",
      colorToken: "teal",
      description: "Primary",
      scheduleType: "INTERVAL",
      scheduleConfig: { from: "converted" },
      isEnabled: true,
      userId: USER_ID,
    });

    const repostEmpty = byId(scheduled, "repost-empty");
    expect(repostEmpty["fileUrl"]).toEqual(["https://orig"]);
    expect(repostEmpty["postType"]).toBe("VIDEO");
    expect(repostEmpty["queueType"]).toBeUndefined();

    const repostKind = byId(scheduled, "repost-kind");
    expect(repostKind["fileUrl"]).toEqual(["https://kind"]);
    expect(repostKind["postType"]).toBe("ORIGINAL");

    const repostOwn = byId(scheduled, "repost-own-media");
    expect(repostOwn["fileUrl"]).toEqual(["https://own"]);
    expect(repostOwn["postType"]).toBe("IMAGE");
    expectQueue(repostOwn, {
      id: "queue-2",
      name: "sparse",
      color: "none",
      colorToken: undefined,
      description: null,
      scheduleType: undefined,
      scheduleConfig: undefined,
      isEnabled: false,
      userId: "user-2",
    });

    const repostNoSource = byId(scheduled, "repost-no-source");
    expect(repostNoSource["fileUrl"]).toEqual([]);
    expect(repostNoSource["postType"]).toBeNull();

    const noQueue = byId(scheduled, "no-queue");
    expect(noQueue["fileUrl"]).toEqual(["https://nq"]);
    expect(noQueue["postType"]).toBeNull();
    expect(noQueue["signedEvent"]).toBeNull();
    expect(noQueue["nostrEvent"]).toBeNull();
    expect(noQueue["queueType"]).toBeUndefined();

    const none = byId(scheduledArticles, "lf-none");
    expect(none["queueType"]).toBeUndefined();
    expect(none["signedEvent"]).toBeNull();

    expectQueue(byId(scheduledArticles, "lf-nullish"), {
      id: "q-null",
      name: "Nullish",
      color: "none",
      colorToken: undefined,
      description: null,
      scheduleType: null,
      scheduleConfig: undefined,
      isEnabled: false,
      userId: "",
    });
    expect(byId(scheduledArticles, "lf-nullish")["signedEvent"]).toEqual(
      SIGNED
    );
    expect(byId(scheduledArticles, "lf-nullish")["nostrEvent"]).toEqual(NOSTR);

    expectQueue(byId(scheduledArticles, "lf-full"), {
      id: "queue-1",
      name: "posts",
      color: "teal",
      colorToken: "teal",
      description: "Primary",
      scheduleType: "INTERVAL",
      scheduleConfig: { from: "converted" },
      isEnabled: true,
      userId: USER_ID,
    });

    for (const id of ["pl-null", "pl-num", "pl-noid", "pl-noname"]) {
      expect(byId(pastArticles, id)["queueType"]).toBeUndefined();
    }
    expectQueue(byId(pastArticles, "pl-min"), {
      id: "min",
      name: "Min",
      color: "none",
      colorToken: undefined,
      description: null,
      scheduleType: undefined,
      scheduleConfig: undefined,
      isEnabled: false,
      userId: "",
    });
    expectQueue(byId(pastArticles, "pl-nullish"), {
      id: "n",
      name: "N",
      color: "none",
      colorToken: undefined,
      description: null,
      scheduleType: null,
      scheduleConfig: undefined,
      isEnabled: false,
      userId: "",
    });
    expectQueue(byId(pastArticles, "pl-full"), {
      id: "full",
      name: "Full",
      color: "teal",
      colorToken: "teal",
      description: "Primary",
      scheduleType: "FIXED_SLOTS",
      scheduleConfig: { from: "converted" },
      isEnabled: true,
      userId: USER_ID,
    });
    expect(byId(pastArticles, "pl-full")["signedEvent"]).toEqual(SIGNED);
    expect(byId(pastArticles, "pl-full")["nostrEvent"]).toEqual(NOSTR);

    expect(result.scheduledPostsPagination).toEqual({
      total: 40,
      pages: 4,
      currentPage: 2,
      limit: 25,
    });
    expect(result.scheduledLongFormPostsPagination).toEqual({
      total: 9,
      pages: 3,
      currentPage: 2,
      limit: 15,
    });
    expect(result.scheduleIntervals).toEqual([6, 12]);
    expect(result.selectedQueueType).toBe("posts");
    const loadedUser: unknown = result.user;
    expect(loadedUser).toBe(user);
    const loadedQueues: unknown = result.queueTypes;
    expect(loadedQueues).toEqual([queues[0]]);

    expect(server.getScheduledPosts).toHaveBeenCalledWith({
      userId: USER_ID,
      limit: 5000,
      queueType: "posts",
      excludePausedQueueContent: true,
    });
    expect(server.getScheduledLongFormPosts).toHaveBeenCalledWith({
      userId: USER_ID,
      limit: 5000,
      queueType: "posts",
      excludePausedQueueContent: true,
    });
    const pastCall = server.getPastPosts.mock.calls[0]?.[0];
    const startDate = pastCall?.["startDate"];
    const endDate = pastCall?.["endDate"];
    if (!(startDate instanceof Date) || !(endDate instanceof Date)) {
      throw new Error("expected past dates");
    }
    expect(result.pastWindow).toEqual({
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    });
    expect(server.getPastLongFormPosts).toHaveBeenCalledWith(pastCall);
    expect(
      filtering.filterPostsByQueueType.mock.calls.map((call) => call[1])
    ).toEqual(["posts", "posts", "posts", "posts"]);
  });

  it("falls back when calendar payloads are partial", async () => {
    server.getScheduledPosts.mockResolvedValue({
      posts: [{ id: "only", fileUrl: ["https://only"], postType: "IMAGE" }],
      pagination: { total: "x", pages: false, currentPage: "1", limit: null },
    });
    server.getScheduledLongFormPosts.mockResolvedValue({
      posts: "nope",
      pagination: { pages: 2 },
    });
    server.getPastPosts.mockResolvedValue({ posts: [] });
    server.getPastLongFormPosts.mockResolvedValue(null);
    userApi.getUserById.mockResolvedValue({});

    const partial = await loadCalendarData(USER_ID, "all");

    expect(partial.scheduledPostsPagination).toEqual({
      total: 1,
      pages: 1,
      currentPage: 1,
      limit: 20,
    });
    expect(partial.scheduledLongFormPostsPagination).toEqual(emptyPagination);
    expect(partial.pastPosts).toEqual([]);
    expect(partial.pastLongFormPosts).toEqual([]);
    expect(partial.scheduleIntervals).toEqual([]);

    server.getScheduledPosts.mockResolvedValue({
      posts: [],
      pagination: 4,
    });
    server.getScheduledLongFormPosts.mockResolvedValue({
      posts: [],
      pagination: "bad",
    });
    server.getPastPosts.mockResolvedValue([]);
    server.getPastLongFormPosts.mockResolvedValue([]);
    userApi.getUserById.mockResolvedValue(null);

    const bare = await loadCalendarData(USER_ID, "all");

    expect(bare.scheduledPostsPagination).toEqual(emptyPagination);
    expect(bare.scheduledLongFormPostsPagination).toEqual(emptyPagination);
    expect(bare.user).toBeNull();
    expect(bare.scheduleIntervals).toEqual([]);
  });

  it("loads a published range without scheduled data", async () => {
    const start = new Date("2024-01-01T00:00:00.000Z");
    const end = new Date("2024-01-02T00:00:00.000Z");
    server.getPastPosts.mockResolvedValue([
      { id: "past-1", fileUrl: ["https://past"], postType: "IMAGE" },
    ]);
    server.getPastLongFormPosts.mockResolvedValue([
      { id: "past-lf", title: "Past", queueType: null },
    ]);

    const loaded = await loadCalendarData(USER_ID, "news", {
      pastStart: start,
      pastEnd: end,
      publishedOnly: true,
    });

    expect(loaded.user).toBeNull();
    expect(loaded.queueTypes).toEqual([]);
    expect(loaded.scheduledPosts).toEqual([]);
    expect(loaded.scheduledLongFormPosts).toEqual([]);
    expect(loaded.scheduleIntervals).toEqual([]);
    expect(loaded.scheduledPostsPagination).toEqual(emptyPagination);
    expect(loaded.scheduledLongFormPostsPagination).toEqual(emptyPagination);
    expect(loaded.pastWindow).toEqual({
      start: start.toISOString(),
      end: end.toISOString(),
    });
    expect(loaded.selectedQueueType).toBe("news");
    expect(loaded.pastPosts).toHaveLength(1);
    expect(loaded.pastLongFormPosts).toHaveLength(1);
    expect(server.getScheduledPosts).not.toHaveBeenCalled();
    expect(server.getScheduledLongFormPosts).not.toHaveBeenCalled();
    expect(userApi.getUserById).not.toHaveBeenCalled();
    expect(userApi.getQueueTypes).not.toHaveBeenCalled();
    expect(server.getPastPosts).toHaveBeenCalledWith({
      userId: USER_ID,
      startDate: start,
      endDate: end,
      queueType: "news",
      excludePausedQueueContent: true,
    });

    const ranged = await loadCalendarPublishedRange(
      USER_ID,
      "news",
      start,
      end
    );
    expect(ranged.pastPosts).toEqual(loaded.pastPosts);
    expect(ranged.pastLongFormPosts).toEqual(loaded.pastLongFormPosts);
  });

  it("maps a queue calendar and coerces schedule intervals", async () => {
    const queued = {
      id: "queued",
      fileUrl: ["https://q"],
      postType: "IMAGE",
      queueType: fullQueue,
      signedEvent: SIGNED,
      nostrEvent: NOSTR,
    };
    const unqueued = {
      id: "unqueued",
      fileUrl: [],
      postType: "TEXT",
      signedEvent: null,
      nostrEvent: null,
    };
    server.getScheduledPosts.mockResolvedValue({
      posts: [queued, unqueued],
      pagination: { total: 2, pages: 1, currentPage: 1, limit: 20 },
    });
    userApi.getUserById.mockResolvedValue({
      scheduleInterval: ["12", "nope", 4, Number.NaN],
    });
    userApi.getQueueTypes.mockResolvedValue([
      { id: "shown", name: "Shown", status: "active" },
      { id: "hidden", name: "Hidden", status: "archived" },
    ]);

    const result = await loadCalendarQueueData(USER_ID, "posts");
    const mapped = asRecords(dtos.toPostDTOArray.mock.calls[0]?.[0]);

    expect(server.getScheduledPosts).toHaveBeenCalledWith({
      userId: USER_ID,
      limit: 5000,
    });
    expect(filtering.filterPostsByQueueType).toHaveBeenCalledWith(
      [queued, unqueued],
      "posts"
    );
    expect(result.scheduleIntervals).toEqual([12, 0, 4, 0]);
    expect(result.selectedQueueType).toBe("posts");
    const loadedQueues: unknown = result.queueTypes;
    expect(loadedQueues).toEqual([
      { id: "shown", name: "Shown", status: "active" },
    ]);
    expect(mapped).toHaveLength(2);
    expect(byId(mapped, "queued")["signedEvent"]).toEqual(SIGNED);
    expect(byId(mapped, "queued")["nostrEvent"]).toEqual(NOSTR);
    expectQueue(byId(mapped, "queued"), {
      id: "queue-1",
      name: "posts",
      color: "teal",
      colorToken: "teal",
      description: "Primary",
      scheduleType: "INTERVAL",
      scheduleConfig: { from: "converted" },
      isEnabled: true,
      userId: USER_ID,
    });
    expect(byId(mapped, "unqueued")["queueType"]).toBeUndefined();
    expect(byId(mapped, "unqueued")["signedEvent"]).toBeNull();
    expect(byId(mapped, "unqueued")["fileUrl"]).toEqual([]);
  });

  it("falls back when queue calendar data is missing", async () => {
    server.getScheduledPosts.mockResolvedValue({ pagination: { total: 3 } });
    userApi.getUserById.mockResolvedValue(null);

    const missingPosts = await loadCalendarQueueData(USER_ID, "posts");
    expect(missingPosts.scheduledPosts).toEqual([]);
    expect(missingPosts.scheduleIntervals).toEqual([]);
    expect(missingPosts.user).toBeNull();

    server.getScheduledPosts.mockResolvedValue({ posts: "nope" });
    userApi.getUserById.mockResolvedValue({});
    const badPosts = await loadCalendarQueueData(USER_ID, "posts");
    expect(badPosts.scheduledPosts).toEqual([]);
    expect(badPosts.scheduleIntervals).toEqual([]);

    server.getScheduledPosts.mockResolvedValue({ posts: [] });
    userApi.getUserById.mockResolvedValue({ scheduleInterval: [] });
    const emptyIntervals = await loadCalendarQueueData(USER_ID, "news");
    expect(emptyIntervals.scheduleIntervals).toEqual([]);
    expect(emptyIntervals.selectedQueueType).toBe("news");
  });
});
