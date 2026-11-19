import zlib from "node:zlib";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface ShortSnapshot {
  schemaVersion: number;
  content: string | null;
  caption: string | null;
  fileUrl: string[];
  queueTypeId: string | null;
  draftMeta: unknown;
}

interface LongformSnapshot {
  schemaVersion: number;
  title: string | null;
  summary: string | null;
  content: string | null;
  image: string | null;
  tags: string[];
  queueTypeId: string | null;
}

interface VersionListItem {
  id: string;
  version: number;
  createdAt: Date;
  createdBy: string | null;
}

interface SnapshotRow {
  snapshot: unknown;
  snapshotCompressed: Buffer | null;
}

interface RestoreRow {
  postId: string | null;
  longFormPostId: string | null;
  snapshot: unknown;
  snapshotCompressed: Buffer | null;
}

interface ShortCreate {
  postId: string;
  version: number;
  snapshot: ShortSnapshot;
  createdBy: string;
}

interface LongformCreate {
  longFormPostId: string;
  version: number;
  snapshotCompressed: Buffer;
  createdBy: string;
}

interface ShortUpdate {
  content: string | undefined;
  caption: string | undefined;
  fileUrl: string[];
  queueTypeId: string | undefined;
  draftMeta: unknown;
  updatedAt: Date;
}

interface LongformUpdate {
  title: string | undefined;
  summary: string | undefined;
  content: string | undefined;
  image: string | undefined;
  tags: string[];
  queueTypeId: string | undefined;
  updatedAt: Date;
}

const repo = vi.hoisted(() => ({
  createDraftVersionLongform: vi.fn(async (_data: LongformCreate) => ({
    id: "lv",
  })),
  createDraftVersionShort: vi.fn(async (_data: ShortCreate) => ({ id: "sv" })),
  deleteDraftVersionsByIds: vi.fn(async (_ids: string[]) => ({ count: 0 })),
  findDraftVersionByIdForRestore: vi.fn(
    async (_id: string): Promise<RestoreRow | null> => null
  ),
  findDraftVersionByIdForSnapshot: vi.fn(
    async (_id: string): Promise<SnapshotRow | null> => null
  ),
  findDraftVersionsByLongFormPostId: vi.fn(
    async (_id: string): Promise<VersionListItem[]> => []
  ),
  findDraftVersionsByPostId: vi.fn(
    async (_id: string): Promise<VersionListItem[]> => []
  ),
  findDraftVersionIdsByLongFormPostId: vi.fn(
    async (_id: string): Promise<Array<{ id: string }>> => []
  ),
  findDraftVersionIdsByPostId: vi.fn(
    async (_id: string): Promise<Array<{ id: string }>> => []
  ),
  findLongFormDraftByIdAndUser: vi.fn(
    async (_id: string, _userId: string): Promise<{ id: string } | null> => null
  ),
  findPostDraftByIdAndUser: vi.fn(
    async (_id: string, _userId: string): Promise<{ id: string } | null> => null
  ),
  getNextDraftVersionForLongForm: vi.fn(async (_id: string) => 1),
  getNextDraftVersionForPost: vi.fn(async (_id: string) => 1),
  updateLongFormPostDraftContent: vi.fn(
    async (_id: string, _userId: string, _data: LongformUpdate) => ({ id: _id })
  ),
  updatePostDraftContent: vi.fn(
    async (_id: string, _userId: string, _data: ShortUpdate) => ({ id: _id })
  ),
}));

vi.mock("~/features/posts/repositories/draft-version-data.server", () => repo);

import {
  createLongformDraftVersion,
  createShortDraftVersion,
  getDraftVersionById,
  getDraftVersions,
  getVersionSnapshot,
  restoreLongformDraftVersion,
  restoreShortDraftVersion,
} from "~/features/posts/drafts/services/draft-version.server";

const NOW = new Date("2026-04-01T00:00:00.000Z");

function shortSnapshot(overrides: Partial<ShortSnapshot> = {}): ShortSnapshot {
  return {
    schemaVersion: 1,
    content: "body",
    caption: "cap",
    fileUrl: ["https://cdn.example/a"],
    queueTypeId: "queue-1",
    draftMeta: { note: true },
    ...overrides,
  };
}

function longformSnapshot(
  overrides: Partial<LongformSnapshot> = {}
): LongformSnapshot {
  return {
    schemaVersion: 1,
    title: "Title",
    summary: "Summary",
    content: "Body",
    image: "https://cdn.example/cover",
    tags: ["nostr"],
    queueTypeId: "queue-1",
    ...overrides,
  };
}

function gzip(value: unknown): Buffer {
  return zlib.gzipSync(Buffer.from(JSON.stringify(value), "utf-8"));
}

function ids(count: number): Array<{ id: string }> {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `v-${String(index)}`,
  }));
}

describe("draft versions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const mock of Object.values(repo)) {
      mock.mockReset();
    }
    repo.createDraftVersionLongform.mockResolvedValue({ id: "lv" });
    repo.createDraftVersionShort.mockResolvedValue({ id: "sv" });
    repo.deleteDraftVersionsByIds.mockResolvedValue({ count: 0 });
    repo.findDraftVersionByIdForRestore.mockResolvedValue(null);
    repo.findDraftVersionByIdForSnapshot.mockResolvedValue(null);
    repo.findDraftVersionsByLongFormPostId.mockResolvedValue([]);
    repo.findDraftVersionsByPostId.mockResolvedValue([]);
    repo.findDraftVersionIdsByLongFormPostId.mockResolvedValue([]);
    repo.findDraftVersionIdsByPostId.mockResolvedValue([]);
    repo.findLongFormDraftByIdAndUser.mockResolvedValue(null);
    repo.findPostDraftByIdAndUser.mockResolvedValue(null);
    repo.getNextDraftVersionForLongForm.mockResolvedValue(2);
    repo.getNextDraftVersionForPost.mockResolvedValue(4);
    repo.updateLongFormPostDraftContent.mockResolvedValue({ id: "lf" });
    repo.updatePostDraftContent.mockResolvedValue({ id: "post" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores a short snapshot and deletes versions past the limit", async () => {
    repo.findDraftVersionIdsByPostId.mockResolvedValue(ids(21));
    const snapshot = shortSnapshot();
    await createShortDraftVersion("post-1", snapshot, "user-1");
    expect(repo.getNextDraftVersionForPost).toHaveBeenCalledWith("post-1");
    expect(repo.getNextDraftVersionForLongForm).not.toHaveBeenCalled();
    expect(repo.createDraftVersionShort).toHaveBeenCalledWith({
      postId: "post-1",
      version: 4,
      snapshot,
      createdBy: "user-1",
    });
    expect(repo.deleteDraftVersionsByIds).toHaveBeenCalledWith(["v-0"]);

    repo.findDraftVersionIdsByPostId.mockResolvedValue(ids(20));
    repo.deleteDraftVersionsByIds.mockClear();
    await createShortDraftVersion("post-1", snapshot, "user-1");
    expect(repo.deleteDraftVersionsByIds).not.toHaveBeenCalled();
  });

  it("stores a gzipped longform snapshot and trims old rows", async () => {
    repo.findDraftVersionIdsByLongFormPostId.mockResolvedValue(ids(22));
    const snapshot = longformSnapshot();
    await createLongformDraftVersion("long-1", snapshot, "user-1");
    expect(repo.getNextDraftVersionForLongForm).toHaveBeenCalledWith("long-1");
    expect(repo.getNextDraftVersionForPost).not.toHaveBeenCalled();
    const created = repo.createDraftVersionLongform.mock.calls[0]?.[0];
    expect(created?.longFormPostId).toBe("long-1");
    expect(created?.version).toBe(2);
    expect(created?.createdBy).toBe("user-1");
    expect(
      zlib
        .gunzipSync(created?.snapshotCompressed ?? Buffer.alloc(0))
        .toString("utf-8")
    ).toBe(JSON.stringify(snapshot));
    expect(repo.deleteDraftVersionsByIds).toHaveBeenCalledWith(["v-0", "v-1"]);

    repo.findDraftVersionIdsByLongFormPostId.mockResolvedValue(ids(1));
    repo.deleteDraftVersionsByIds.mockClear();
    await createLongformDraftVersion("long-1", snapshot, "user-1");
    expect(repo.deleteDraftVersionsByIds).not.toHaveBeenCalled();
  });

  it("propagates version bookkeeping failures", async () => {
    repo.getNextDraftVersionForPost.mockRejectedValueOnce(
      new Error("next down")
    );
    await expect(
      createShortDraftVersion("post-1", shortSnapshot(), "user-1")
    ).rejects.toThrow("next down");
    expect(repo.createDraftVersionShort).not.toHaveBeenCalled();

    repo.getNextDraftVersionForLongForm.mockRejectedValueOnce("next string");
    await expect(
      createLongformDraftVersion("long-1", longformSnapshot(), "user-1")
    ).rejects.toBe("next string");
    expect(repo.createDraftVersionLongform).not.toHaveBeenCalled();
  });

  it("lists versions for a post, a longform post, or neither", async () => {
    const postRows: VersionListItem[] = [
      { id: "v1", version: 1, createdAt: NOW, createdBy: "user-1" },
    ];
    const longRows: VersionListItem[] = [
      { id: "v2", version: 2, createdAt: NOW, createdBy: null },
    ];
    repo.findDraftVersionsByPostId.mockResolvedValue(postRows);
    repo.findDraftVersionsByLongFormPostId.mockResolvedValue(longRows);
    await expect(getDraftVersions("post-1", "long-1")).resolves.toBe(postRows);
    await expect(getDraftVersions("post-1", null)).resolves.toBe(postRows);
    expect(repo.findDraftVersionsByLongFormPostId).not.toHaveBeenCalled();
    await expect(getDraftVersions(null, "long-1")).resolves.toBe(longRows);
    await expect(getDraftVersions(null, null)).resolves.toEqual([]);
    await expect(getDraftVersions("", null)).resolves.toBe(postRows);
    expect(repo.findDraftVersionsByPostId).toHaveBeenCalledWith("");
  });

  it("reads a short snapshot, a gzipped longform snapshot, or nothing", async () => {
    await expect(getVersionSnapshot("missing")).resolves.toBeNull();

    const snapshot = shortSnapshot();
    repo.findDraftVersionByIdForSnapshot.mockResolvedValueOnce({
      snapshot,
      snapshotCompressed: null,
    });
    await expect(getVersionSnapshot("short")).resolves.toEqual(snapshot);

    repo.findDraftVersionByIdForSnapshot.mockResolvedValueOnce({
      snapshot,
      snapshotCompressed: Buffer.alloc(0),
    });
    await expect(getVersionSnapshot("empty-gzip")).resolves.toEqual(snapshot);

    const article = longformSnapshot();
    repo.findDraftVersionByIdForSnapshot.mockResolvedValueOnce({
      snapshot: null,
      snapshotCompressed: gzip(article),
    });
    await expect(getVersionSnapshot("long")).resolves.toEqual(article);

    repo.findDraftVersionByIdForSnapshot.mockResolvedValueOnce({
      snapshot: null,
      snapshotCompressed: null,
    });
    await expect(getVersionSnapshot("blank")).resolves.toBeNull();

    repo.findDraftVersionByIdForSnapshot.mockResolvedValueOnce({
      snapshot: { schemaVersion: "bad" },
      snapshotCompressed: null,
    });
    await expect(getVersionSnapshot("bad-short")).rejects.toThrow();
    repo.findDraftVersionByIdForSnapshot.mockResolvedValueOnce({
      snapshot: null,
      snapshotCompressed: gzip({ schemaVersion: 1 }),
    });
    await expect(getVersionSnapshot("bad-long")).rejects.toThrow();
    repo.findDraftVersionByIdForSnapshot.mockResolvedValueOnce({
      snapshot: null,
      snapshotCompressed: Buffer.from("not-gzip"),
    });
    await expect(getVersionSnapshot("corrupt")).rejects.toThrow();
  });

  it("returns the restore row unchanged", async () => {
    const row: RestoreRow = {
      postId: "post-1",
      longFormPostId: null,
      snapshot: shortSnapshot(),
      snapshotCompressed: null,
    };
    repo.findDraftVersionByIdForRestore.mockResolvedValueOnce(row);
    await expect(getDraftVersionById("v1")).resolves.toBe(row);
    expect(repo.findDraftVersionByIdForRestore).toHaveBeenCalledWith("v1");
  });

  it("restores a short draft or returns null when the row cannot be applied", async () => {
    await expect(
      restoreShortDraftVersion("missing", "user-1")
    ).resolves.toBeNull();

    repo.findDraftVersionByIdForRestore.mockResolvedValueOnce({
      postId: null,
      longFormPostId: null,
      snapshot: shortSnapshot(),
      snapshotCompressed: null,
    });
    await expect(restoreShortDraftVersion("v", "user-1")).resolves.toBeNull();

    repo.findDraftVersionByIdForRestore.mockResolvedValueOnce({
      postId: "post-1",
      longFormPostId: null,
      snapshot: null,
      snapshotCompressed: null,
    });
    await expect(restoreShortDraftVersion("v", "user-1")).resolves.toBeNull();

    repo.findDraftVersionByIdForRestore.mockResolvedValueOnce({
      postId: "post-1",
      longFormPostId: null,
      snapshot: { schemaVersion: 1 },
      snapshotCompressed: null,
    });
    await expect(restoreShortDraftVersion("v", "user-1")).resolves.toBeNull();
    expect(repo.findPostDraftByIdAndUser).not.toHaveBeenCalled();

    repo.findDraftVersionByIdForRestore.mockResolvedValueOnce({
      postId: "post-1",
      longFormPostId: null,
      snapshot: shortSnapshot(),
      snapshotCompressed: null,
    });
    repo.findPostDraftByIdAndUser.mockResolvedValueOnce(null);
    await expect(restoreShortDraftVersion("v", "user-1")).resolves.toBeNull();
    expect(repo.updatePostDraftContent).not.toHaveBeenCalled();

    repo.findDraftVersionByIdForRestore.mockResolvedValueOnce({
      postId: "post-1",
      longFormPostId: null,
      snapshot: shortSnapshot({
        content: null,
        caption: null,
        queueTypeId: null,
        draftMeta: null,
      }),
      snapshotCompressed: null,
    });
    repo.findPostDraftByIdAndUser.mockResolvedValueOnce({ id: "post-1" });
    await expect(restoreShortDraftVersion("v", "user-1")).resolves.toBe(
      "post-1"
    );
    expect(repo.updatePostDraftContent).toHaveBeenCalledWith(
      "post-1",
      "user-1",
      {
        content: undefined,
        caption: undefined,
        fileUrl: ["https://cdn.example/a"],
        queueTypeId: undefined,
        draftMeta: null,
        updatedAt: NOW,
      }
    );

    repo.findDraftVersionByIdForRestore.mockResolvedValueOnce({
      postId: "post-1",
      longFormPostId: null,
      snapshot: shortSnapshot(),
      snapshotCompressed: null,
    });
    repo.findPostDraftByIdAndUser.mockResolvedValueOnce({ id: "post-1" });
    await restoreShortDraftVersion("v", "user-1");
    expect(repo.updatePostDraftContent.mock.calls.at(-1)?.[2].content).toBe(
      "body"
    );
    expect(
      repo.updatePostDraftContent.mock.calls.at(-1)?.[2].draftMeta
    ).toEqual({
      note: true,
    });
  });

  it("restores a longform draft or returns null for a bad snapshot", async () => {
    await expect(
      restoreLongformDraftVersion("missing", "user-1")
    ).resolves.toBeNull();

    repo.findDraftVersionByIdForRestore.mockResolvedValueOnce({
      postId: null,
      longFormPostId: null,
      snapshot: null,
      snapshotCompressed: gzip(longformSnapshot()),
    });
    await expect(
      restoreLongformDraftVersion("v", "user-1")
    ).resolves.toBeNull();

    repo.findDraftVersionByIdForRestore.mockResolvedValueOnce({
      postId: null,
      longFormPostId: "long-1",
      snapshot: null,
      snapshotCompressed: Buffer.alloc(0),
    });
    await expect(
      restoreLongformDraftVersion("v", "user-1")
    ).resolves.toBeNull();

    repo.findDraftVersionByIdForRestore.mockResolvedValueOnce({
      postId: null,
      longFormPostId: "long-1",
      snapshot: null,
      snapshotCompressed: gzip({ schemaVersion: 1 }),
    });
    await expect(
      restoreLongformDraftVersion("v", "user-1")
    ).resolves.toBeNull();

    repo.findDraftVersionByIdForRestore.mockResolvedValueOnce({
      postId: null,
      longFormPostId: "long-1",
      snapshot: null,
      snapshotCompressed: gzip(longformSnapshot()),
    });
    repo.findLongFormDraftByIdAndUser.mockResolvedValueOnce(null);
    await expect(
      restoreLongformDraftVersion("v", "user-1")
    ).resolves.toBeNull();
    expect(repo.updateLongFormPostDraftContent).not.toHaveBeenCalled();

    repo.findDraftVersionByIdForRestore.mockResolvedValueOnce({
      postId: null,
      longFormPostId: "long-1",
      snapshot: null,
      snapshotCompressed: gzip(
        longformSnapshot({
          title: null,
          summary: null,
          content: null,
          image: null,
          queueTypeId: null,
        })
      ),
    });
    repo.findLongFormDraftByIdAndUser.mockResolvedValueOnce({ id: "long-1" });
    await expect(restoreLongformDraftVersion("v", "user-1")).resolves.toBe(
      "long-1"
    );
    expect(repo.updateLongFormPostDraftContent).toHaveBeenCalledWith(
      "long-1",
      "user-1",
      {
        title: undefined,
        summary: undefined,
        content: undefined,
        image: undefined,
        tags: ["nostr"],
        queueTypeId: undefined,
        updatedAt: NOW,
      }
    );

    repo.findDraftVersionByIdForRestore.mockResolvedValueOnce({
      postId: null,
      longFormPostId: "long-1",
      snapshot: null,
      snapshotCompressed: Buffer.from("not-gzip"),
    });
    await expect(restoreLongformDraftVersion("v", "user-1")).rejects.toThrow();
    repo.findDraftVersionByIdForRestore.mockResolvedValueOnce({
      postId: null,
      longFormPostId: "long-1",
      snapshot: null,
      snapshotCompressed: zlib.gzipSync(Buffer.from("{", "utf-8")),
    });
    await expect(restoreLongformDraftVersion("v", "user-1")).rejects.toThrow();
  });
});
