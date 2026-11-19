import { beforeEach, describe, expect, it, vi } from "vitest";

interface PublishedPostRow {
  id: string;
  nostrEventId: string | null;
  nostrEvent: unknown;
  content: string | null;
  caption: string | null;
  fileUrl: string[];
  publishedAt: Date | null;
}

interface PublishedArticleRow {
  id: string;
  nostrEventId: string | null;
  nostrEvent: unknown;
  title: string | null;
  summary: string | null;
  content: string | null;
  publishedAt: Date | null;
}

interface SyncRow {
  nextCursor: string | null;
  backfillComplete: boolean;
  updatedAt: Date;
}

interface SnapshotQuery {
  strings: readonly string[];
  values: readonly unknown[];
}

interface SnapshotRow {
  userId: string;
  nostrEventId: string;
  postId: string | null;
}

interface ObservationRow {
  userId: string;
  nostrEventId: string;
  postId: string | null;
  reactionCount: number | null;
  replyCount: number | null;
  repostCount: number | null;
  zapCount: number | null;
  zapMsats: bigint | null;
  missingFromIndex: boolean;
  checkedAt: Date;
}

interface LatestUpdate {
  postId: string | null;
  reactionCount: number | null;
  replyCount: number | null;
  repostCount: number | null;
  zapCount: number | null;
  zapMsats: bigint | null;
  missingFromIndex: boolean;
  checkedAt: Date;
}

interface TxClient {
  postPerformanceObservation: {
    create: (args: { data: ObservationRow }) => Promise<unknown>;
  };
  postPerformanceLatest: {
    upsert: (args: {
      where: {
        userId_nostrEventId: { userId: string; nostrEventId: string };
      };
      create: ObservationRow;
      update: LatestUpdate;
    }) => Promise<unknown>;
  };
}

const db = vi.hoisted(() => {
  const tx = {
    postPerformanceObservation: {
      create: vi.fn(
        async (_args: { data: ObservationRow }): Promise<unknown> => ({})
      ),
    },
    postPerformanceLatest: {
      upsert: vi.fn(
        async (_args: {
          where: {
            userId_nostrEventId: { userId: string; nostrEventId: string };
          };
          create: ObservationRow;
          update: LatestUpdate;
        }): Promise<unknown> => ({})
      ),
    },
  };
  return {
    tx,
    prisma: {
      $queryRaw: vi.fn(
        async (_query: SnapshotQuery): Promise<SnapshotRow[]> => []
      ),
      $transaction: vi.fn(
        async (run: (client: TxClient) => Promise<void>): Promise<void> => {
          await run(tx);
        }
      ),
      subscription: {
        findMany: vi.fn(
          async (_args: {
            where: { status: string };
            select: { userId: true };
          }): Promise<Array<{ userId: string }>> => []
        ),
      },
      user: {
        findUnique: vi.fn(
          async (_args: {
            where: { id: string };
            select: { npub: true };
          }): Promise<{ npub: string | null } | null> => null
        ),
      },
      post: {
        findFirst: vi.fn(
          async (_args: {
            where: { userId: string; nostrEventId: string };
            select: { id: true };
          }): Promise<{ id: string } | null> => null
        ),
        findMany: vi.fn(
          async (
            _args: Record<string, unknown>
          ): Promise<PublishedPostRow[]> => []
        ),
      },
      longFormPost: {
        findMany: vi.fn(
          async (
            _args: Record<string, unknown>
          ): Promise<PublishedArticleRow[]> => []
        ),
      },
      authorEventSync: {
        findUnique: vi.fn(
          async (_args: Record<string, unknown>): Promise<SyncRow | null> =>
            null
        ),
        upsert: vi.fn(
          async (_args: Record<string, unknown>): Promise<unknown> => ({})
        ),
      },
      trackedAuthorEvent: {
        upsert: vi.fn(
          async (_args: {
            where: {
              userId_nostrEventId: { userId: string; nostrEventId: string };
            };
            create: Record<string, unknown>;
            update: Record<string, unknown>;
          }): Promise<unknown> => ({})
        ),
        findMany: vi.fn(
          async (_args: Record<string, unknown>): Promise<unknown[]> => []
        ),
        createMany: vi.fn(
          async (_args: {
            data: unknown[];
            skipDuplicates: boolean;
          }): Promise<unknown> => ({})
        ),
      },
      postPerformanceLatest: {
        findMany: vi.fn(
          async (_args: Record<string, unknown>): Promise<unknown[]> => []
        ),
        findFirst: vi.fn(
          async (
            _args: Record<string, unknown>
          ): Promise<{ nostrEventId: string } | null> => null
        ),
      },
      postPerformanceObservation: {
        findMany: vi.fn(
          async (_args: Record<string, unknown>): Promise<unknown[]> => []
        ),
      },
    },
  };
});

vi.mock("~/lib/prisma.server", () => ({ prisma: db.prisma }));

import {
  createAnalyticsDirectory,
  hasPerformanceLatest,
  indexPublishedAuthorEvents,
  listPerformanceLatest,
  listPerformanceObservations,
  listTrackedAuthorEvents,
  notesBackfillComplete,
} from "~/features/analytics/data/post-analytics-store.server";
import type { AuthorStream, DiscoveredEvent } from "~/features/nostrmash/parse";

const EVENT_A = "a".repeat(64);
const EVENT_B = "b".repeat(64);
const PUBKEY = "c".repeat(64);

function event(overrides: Partial<DiscoveredEvent> = {}): DiscoveredEvent {
  return {
    nostrEventId: EVENT_A,
    kind: 1,
    eventCreatedAt: new Date("2099-01-02T00:00:00.000Z"),
    contentExcerpt: "hello",
    ...overrides,
  };
}

function observation(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    userId: "user-1",
    nostrEventId: EVENT_A,
    postId: "post-1",
    reactionCount: 2,
    replyCount: 1,
    repostCount: 0,
    zapCount: 3,
    zapMsats: 4n,
    missingFromIndex: false,
    checkedAt: new Date("2099-01-03T00:00:00.000Z"),
    ...overrides,
  };
}

describe("analytics directory", () => {
  const active = vi.fn(async (userId: string): Promise<boolean> => {
    return userId === "paid";
  });
  const directory = createAnalyticsDirectory(active);

  beforeEach(() => {
    vi.clearAllMocks();
    active.mockResolvedValue(false);
  });

  it("lists unique active subscription users and delegates collection checks", async () => {
    db.prisma.subscription.findMany.mockResolvedValueOnce([
      { userId: "user-1" },
      { userId: "user-1" },
      { userId: "user-2" },
    ]);
    await expect(directory.listCandidateUserIds()).resolves.toEqual([
      "user-1",
      "user-2",
    ]);
    expect(db.prisma.subscription.findMany).toHaveBeenCalledWith({
      where: { status: "ACTIVE" },
      select: { userId: true },
    });

    db.prisma.subscription.findMany.mockResolvedValueOnce([]);
    await expect(directory.listCandidateUserIds()).resolves.toEqual([]);

    active.mockResolvedValueOnce(true);
    await expect(directory.isCollectionActive("paid")).resolves.toBe(true);
    expect(active).toHaveBeenCalledWith("paid");
    db.prisma.subscription.findMany.mockRejectedValueOnce(new Error("db down"));
    await expect(directory.listCandidateUserIds()).rejects.toThrow("db down");
    db.prisma.subscription.findMany.mockRejectedValueOnce("db string");
    await expect(directory.listCandidateUserIds()).rejects.toBe("db string");
  });

  it("converts a stored pubkey and returns null when the user or key is missing", async () => {
    db.prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(directory.pubkeyHex("missing")).resolves.toBeNull();
    db.prisma.user.findUnique.mockResolvedValueOnce({ npub: null });
    await expect(directory.pubkeyHex("user-1")).resolves.toBeNull();
    db.prisma.user.findUnique.mockResolvedValueOnce({ npub: "  " });
    await expect(directory.pubkeyHex("user-1")).resolves.toBeNull();
    db.prisma.user.findUnique.mockResolvedValueOnce({ npub: "not-a-key" });
    await expect(directory.pubkeyHex("user-1")).resolves.toBeNull();
    db.prisma.user.findUnique.mockResolvedValueOnce({
      npub: PUBKEY.toUpperCase(),
    });
    await expect(directory.pubkeyHex("user-1")).resolves.toBe(PUBKEY);
    expect(db.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { npub: true },
    });
  });

  it("returns the linked post id or null", async () => {
    db.prisma.post.findFirst.mockResolvedValueOnce(null);
    await expect(
      directory.postIdForEvent("user-1", EVENT_A)
    ).resolves.toBeNull();
    db.prisma.post.findFirst.mockResolvedValueOnce({ id: "post-1" });
    await expect(directory.postIdForEvent("user-1", EVENT_A)).resolves.toBe(
      "post-1"
    );
    expect(db.prisma.post.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", nostrEventId: EVENT_A },
      select: { id: true },
    });
  });

  it("reads and writes author sync state", async () => {
    const stream: AuthorStream = "notes";
    db.prisma.authorEventSync.findUnique.mockResolvedValueOnce(null);
    await expect(directory.getSync("user-1", stream)).resolves.toBeNull();
    const updatedAt = new Date("2099-04-01T00:00:00.000Z");
    db.prisma.authorEventSync.findUnique.mockResolvedValueOnce({
      nextCursor: "cursor-1",
      backfillComplete: true,
      updatedAt,
    });
    await expect(directory.getSync("user-1", stream)).resolves.toEqual({
      nextCursor: "cursor-1",
      backfillComplete: true,
      updatedAt: updatedAt.getTime(),
    });

    await directory.saveSync("user-1", stream, {
      nextCursor: null,
      backfillComplete: false,
    });
    expect(db.prisma.authorEventSync.upsert).toHaveBeenCalledWith({
      where: { userId_stream: { userId: "user-1", stream: "notes" } },
      create: {
        userId: "user-1",
        stream: "notes",
        nextCursor: null,
        backfillComplete: false,
      },
      update: { nextCursor: null, backfillComplete: false },
    });
  });

  it("upserts tracked events and omits blank excerpt or date updates", async () => {
    const createdAt = new Date("2099-05-01T00:00:00.000Z");
    await directory.upsertTracked({
      userId: "user-1",
      event: event({ contentExcerpt: "note", eventCreatedAt: createdAt }),
      postId: "post-1",
    });
    expect(db.prisma.trackedAuthorEvent.upsert).toHaveBeenCalledWith({
      where: {
        userId_nostrEventId: { userId: "user-1", nostrEventId: EVENT_A },
      },
      create: {
        userId: "user-1",
        nostrEventId: EVENT_A,
        kind: 1,
        eventCreatedAt: createdAt,
        contentExcerpt: "note",
        postId: "post-1",
      },
      update: {
        postId: "post-1",
        contentExcerpt: "note",
        eventCreatedAt: createdAt,
      },
    });

    await directory.upsertTracked({
      userId: "user-1",
      event: event({ contentExcerpt: "", eventCreatedAt: null }),
      postId: null,
    });
    const blank = db.prisma.trackedAuthorEvent.upsert.mock.calls[1]?.[0];
    expect(blank?.update).toEqual({ postId: null });

    await directory.upsertTracked({
      userId: "user-1",
      event: event({ contentExcerpt: "only text", eventCreatedAt: null }),
      postId: null,
    });
    expect(
      db.prisma.trackedAuthorEvent.upsert.mock.calls[2]?.[0].update
    ).toEqual({
      postId: null,
      contentExcerpt: "only text",
    });
  });

  it("skips the snapshot query for an empty audience or a non-positive limit", async () => {
    await expect(directory.oldestForSnapshot([], 5)).resolves.toEqual([]);
    await expect(directory.oldestForSnapshot(["user-1"], 0)).resolves.toEqual(
      []
    );
    await expect(directory.oldestForSnapshot(["user-1"], -1)).resolves.toEqual(
      []
    );
    expect(db.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("returns the oldest snapshot rows from the raw query", async () => {
    const rows: SnapshotRow[] = [
      { userId: "user-1", nostrEventId: EVENT_A, postId: "post-1" },
      { userId: "user-2", nostrEventId: EVENT_B, postId: null },
    ];
    db.prisma.$queryRaw.mockResolvedValueOnce(rows);
    await expect(
      directory.oldestForSnapshot(["user-1", "user-2"], 4)
    ).resolves.toBe(rows);
    const query = db.prisma.$queryRaw.mock.calls[0]?.[0];
    if (!query) throw new Error("missing snapshot query");
    expect(query.values).toEqual(["user-1", "user-2", 4]);
    expect(query.strings.join("")).toContain('"TrackedAuthorEvent"');
    expect(query.strings.join("")).toContain("LIMIT ");
  });

  it("writes an observation and the latest row in one transaction", async () => {
    const row = observation();
    await directory.appendObservation(row);
    expect(db.tx.postPerformanceObservation.create).toHaveBeenCalledWith({
      data: row,
    });
    expect(db.tx.postPerformanceLatest.upsert).toHaveBeenCalledWith({
      where: {
        userId_nostrEventId: { userId: "user-1", nostrEventId: EVENT_A },
      },
      create: row,
      update: {
        postId: "post-1",
        reactionCount: 2,
        replyCount: 1,
        repostCount: 0,
        zapCount: 3,
        zapMsats: 4n,
        missingFromIndex: false,
        checkedAt: row.checkedAt,
      },
    });

    db.tx.postPerformanceObservation.create.mockRejectedValueOnce(
      new Error("write failed")
    );
    await expect(directory.appendObservation(observation())).rejects.toThrow(
      "write failed"
    );
    db.tx.postPerformanceObservation.create.mockRejectedValueOnce(
      "write string"
    );
    await expect(directory.appendObservation(observation())).rejects.toBe(
      "write string"
    );
  });
});

describe("published and stored analytics rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports whether the notes backfill and any latest row exist", async () => {
    db.prisma.authorEventSync.findUnique.mockResolvedValueOnce(null);
    await expect(notesBackfillComplete("user-1")).resolves.toBe(false);
    db.prisma.authorEventSync.findUnique.mockResolvedValueOnce({
      nextCursor: null,
      backfillComplete: false,
      updatedAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    await expect(notesBackfillComplete("user-1")).resolves.toBe(false);
    db.prisma.authorEventSync.findUnique.mockResolvedValueOnce({
      nextCursor: "c",
      backfillComplete: true,
      updatedAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    await expect(notesBackfillComplete("user-1")).resolves.toBe(true);
    expect(db.prisma.authorEventSync.findUnique).toHaveBeenCalledWith({
      where: { userId_stream: { userId: "user-1", stream: "notes" } },
      select: { backfillComplete: true },
    });

    db.prisma.postPerformanceLatest.findFirst.mockResolvedValueOnce(null);
    await expect(hasPerformanceLatest("user-1")).resolves.toBe(false);
    db.prisma.postPerformanceLatest.findFirst.mockResolvedValueOnce({
      nostrEventId: EVENT_A,
    });
    await expect(hasPerformanceLatest("user-1")).resolves.toBe(true);
  });

  it("lists tracked events, latest rows, and observations with their query limits", async () => {
    const tracked = [{ nostrEventId: EVENT_A }];
    db.prisma.trackedAuthorEvent.findMany.mockResolvedValueOnce(tracked);
    await expect(listTrackedAuthorEvents("user-1")).resolves.toBe(tracked);
    expect(db.prisma.trackedAuthorEvent.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: [
        { eventCreatedAt: { sort: "desc", nulls: "last" } },
        { discoveredAt: "desc" },
      ],
      take: 100,
    });

    await expect(listPerformanceLatest("user-1", [])).resolves.toEqual([]);
    expect(db.prisma.postPerformanceLatest.findMany).not.toHaveBeenCalled();
    const latest = [{ nostrEventId: EVENT_A }];
    db.prisma.postPerformanceLatest.findMany.mockResolvedValueOnce(latest);
    await expect(
      listPerformanceLatest("user-1", [EVENT_A, EVENT_B])
    ).resolves.toBe(latest);
    expect(db.prisma.postPerformanceLatest.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", nostrEventId: { in: [EVENT_A, EVENT_B] } },
    });

    const observations = [{ id: "obs-1" }];
    db.prisma.postPerformanceObservation.findMany.mockResolvedValueOnce(
      observations
    );
    await expect(listPerformanceObservations("user-1", EVENT_A)).resolves.toBe(
      observations
    );
    expect(db.prisma.postPerformanceObservation.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", nostrEventId: EVENT_A },
      orderBy: { checkedAt: "asc" },
      take: 500,
    });
  });

  it("indexes published notes and articles, skipping blanks and duplicate ids", async () => {
    const publishedAt = new Date("2099-03-01T00:00:00.000Z");
    db.prisma.post.findMany.mockResolvedValueOnce([
      {
        id: "post-1",
        nostrEventId: EVENT_A.toUpperCase(),
        nostrEvent: { id: EVENT_B },
        content: "  hello   world ",
        caption: "caption",
        fileUrl: ["https://cdn.example/ignored.png"],
        publishedAt,
      },
      {
        id: "post-dup",
        nostrEventId: EVENT_A,
        nostrEvent: null,
        content: "duplicate",
        caption: null,
        fileUrl: [],
        publishedAt,
      },
      {
        id: "post-2",
        nostrEventId: "not-hex",
        nostrEvent: { id: EVENT_B },
        content: "   ",
        caption: null,
        fileUrl: ["https://cdn.example/pic.png"],
        publishedAt: null,
      },
      {
        id: "post-blank",
        nostrEventId: null,
        nostrEvent: { id: "short" },
        content: "missing",
        caption: null,
        fileUrl: [],
        publishedAt,
      },
    ]);
    db.prisma.longFormPost.findMany.mockResolvedValueOnce([
      {
        id: "article-dup",
        nostrEventId: EVENT_A,
        nostrEvent: null,
        title: "Duplicate",
        summary: null,
        content: "body",
        publishedAt,
      },
      {
        id: "article-1",
        nostrEventId: null,
        nostrEvent: { id: "d".repeat(64) },
        title: "  ",
        summary: "Hello",
        content: "ignored because summary is first",
        publishedAt,
      },
    ]);

    await expect(indexPublishedAuthorEvents("user-1")).resolves.toBe(3);
    expect(db.prisma.post.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", currentState: "PUBLISHED", repost: false },
      orderBy: { publishedAt: "desc" },
      take: 100,
      select: {
        id: true,
        nostrEventId: true,
        nostrEvent: true,
        content: true,
        caption: true,
        fileUrl: true,
        publishedAt: true,
      },
    });
    expect(db.prisma.longFormPost.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", currentState: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: 100,
      select: {
        id: true,
        nostrEventId: true,
        nostrEvent: true,
        title: true,
        summary: true,
        content: true,
        publishedAt: true,
      },
    });
    expect(db.prisma.trackedAuthorEvent.createMany).toHaveBeenCalledWith({
      skipDuplicates: true,
      data: [
        {
          userId: "user-1",
          nostrEventId: EVENT_A,
          kind: 1,
          eventCreatedAt: publishedAt,
          contentExcerpt: "hello world",
          postId: "post-1",
        },
        {
          userId: "user-1",
          nostrEventId: EVENT_B,
          kind: 1,
          eventCreatedAt: null,
          contentExcerpt: "https://cdn.example/pic.png",
          postId: "post-2",
        },
        {
          userId: "user-1",
          nostrEventId: "d".repeat(64),
          kind: 30023,
          eventCreatedAt: publishedAt,
          contentExcerpt: "Hello",
          postId: null,
        },
      ],
    });
  });

  it("returns zero and skips the insert when nothing has a 64-character id", async () => {
    db.prisma.post.findMany.mockResolvedValueOnce([]);
    db.prisma.longFormPost.findMany.mockResolvedValueOnce([]);
    await expect(indexPublishedAuthorEvents("user-1")).resolves.toBe(0);

    db.prisma.post.findMany.mockResolvedValueOnce([
      {
        id: "post-1",
        nostrEventId: null,
        nostrEvent: null,
        content: null,
        caption: null,
        fileUrl: [],
        publishedAt: null,
      },
    ]);
    db.prisma.longFormPost.findMany.mockResolvedValueOnce([]);
    await expect(indexPublishedAuthorEvents("user-2")).resolves.toBe(0);
    expect(db.prisma.trackedAuthorEvent.createMany).not.toHaveBeenCalled();
  });

  it("propagates query and insert failures", async () => {
    db.prisma.post.findMany.mockRejectedValueOnce(new Error("posts down"));
    db.prisma.longFormPost.findMany.mockResolvedValueOnce([]);
    await expect(indexPublishedAuthorEvents("user-1")).rejects.toThrow(
      "posts down"
    );

    db.prisma.post.findMany.mockResolvedValueOnce([]);
    db.prisma.longFormPost.findMany.mockRejectedValueOnce("articles down");
    await expect(indexPublishedAuthorEvents("user-1")).rejects.toBe(
      "articles down"
    );

    db.prisma.post.findMany.mockResolvedValueOnce([
      {
        id: "post-1",
        nostrEventId: EVENT_A,
        nostrEvent: null,
        content: "note",
        caption: null,
        fileUrl: [],
        publishedAt: null,
      },
    ]);
    db.prisma.longFormPost.findMany.mockResolvedValueOnce([]);
    db.prisma.trackedAuthorEvent.createMany.mockRejectedValueOnce(
      new Error("insert down")
    );
    await expect(indexPublishedAuthorEvents("user-1")).rejects.toThrow(
      "insert down"
    );
  });
});
