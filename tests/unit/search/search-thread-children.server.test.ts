import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({
  connectToPrimalCache: vi.fn(),
}));

const authors = vi.hoisted(() => ({
  fetchAuthorsInfoBatch: vi.fn(),
}));

vi.mock("~/features/cache/primalCache.server", () => cache);
vi.mock(
  "~/features/search/services/search-authors-batch.server",
  () => authors
);

import { loadSearchThreadChildReplies } from "~/features/search/services/search-thread-children.server";

const PARENT = "aa".repeat(32);
const FIRST_CHILD = "bb".repeat(32);
const SECOND_CHILD = "cc".repeat(32);
const FIRST_PK = "d1".repeat(32);
const SECOND_PK = "d2".repeat(32);

describe("loadSearchThreadChildReplies", () => {
  beforeEach(() => {
    cache.connectToPrimalCache.mockReset();
    authors.fetchAuthorsInfoBatch.mockReset();
  });

  it("returns direct replies with author names and media", async () => {
    cache.connectToPrimalCache.mockResolvedValue([
      [
        "EVENT",
        "sub",
        {
          id: PARENT,
          kind: 1,
          pubkey: "ee".repeat(32),
          tags: [],
        },
      ],
      [
        "EVENT",
        "sub",
        {
          content: "later",
          created_at: 30,
          id: SECOND_CHILD,
          kind: 1,
          pubkey: FIRST_PK,
          tags: [["e", PARENT.toUpperCase()]],
        },
      ],
      [
        "EVENT",
        "sub",
        {
          content: "nested https://cdn.example.com/c.jpg",
          created_at: 10,
          id: FIRST_CHILD,
          kind: 1,
          pubkey: SECOND_PK,
          tags: [
            ["e", PARENT],
            ["url", "https://cdn.example.com/c.jpg"],
          ],
        },
      ],
      [
        "EVENT",
        "sub",
        {
          content: "not a direct child",
          created_at: 15,
          id: "ff".repeat(32),
          kind: 1,
          pubkey: FIRST_PK,
          tags: [["e", FIRST_CHILD]],
        },
      ],
    ]);
    authors.fetchAuthorsInfoBatch.mockResolvedValue(
      new Map([
        [
          SECOND_PK,
          { image: "https://img.example/second.png", name: "Second" },
        ],
        [FIRST_PK, { image: null, name: "First" }],
      ])
    );

    const result = await loadSearchThreadChildReplies(
      `  ${PARENT.toUpperCase()}  `
    );

    expect(cache.connectToPrimalCache).toHaveBeenCalledTimes(1);
    expect(cache.connectToPrimalCache).toHaveBeenCalledWith("thread_view", {
      event_id: PARENT,
    });
    expect(authors.fetchAuthorsInfoBatch).toHaveBeenCalledWith([
      SECOND_PK,
      FIRST_PK,
    ]);
    expect(result.replies).toEqual([
      {
        authorImage: "https://img.example/second.png",
        authorName: "Second",
        content: "nested https://cdn.example.com/c.jpg",
        created_at: 10,
        id: FIRST_CHILD,
        mediaUrls: ["https://cdn.example.com/c.jpg"],
        pubkey: SECOND_PK,
      },
      {
        authorImage: null,
        authorName: "First",
        content: "later",
        created_at: 30,
        id: SECOND_CHILD,
        pubkey: FIRST_PK,
      },
    ]);
  });

  it("returns no replies when the thread has no direct children", async () => {
    cache.connectToPrimalCache.mockResolvedValue([]);
    authors.fetchAuthorsInfoBatch.mockResolvedValue(new Map());

    await expect(loadSearchThreadChildReplies(PARENT)).resolves.toEqual({
      replies: [],
    });
    expect(authors.fetchAuthorsInfoBatch).toHaveBeenCalledWith([]);
  });

  it("returns an empty list for an invalid parent id", async () => {
    await expect(loadSearchThreadChildReplies("")).resolves.toEqual({
      replies: [],
    });
    await expect(loadSearchThreadChildReplies("   ")).resolves.toEqual({
      replies: [],
    });
    await expect(
      loadSearchThreadChildReplies("zz".repeat(32))
    ).resolves.toEqual({ replies: [] });
    await expect(
      loadSearchThreadChildReplies("ab".repeat(31))
    ).resolves.toEqual({ replies: [] });
    expect(cache.connectToPrimalCache).not.toHaveBeenCalled();
    expect(authors.fetchAuthorsInfoBatch).not.toHaveBeenCalled();
  });

  it("rejects when the thread cache throws", async () => {
    cache.connectToPrimalCache.mockRejectedValue(new Error("cache down"));

    await expect(loadSearchThreadChildReplies(PARENT)).rejects.toThrow(
      "cache down"
    );
    expect(authors.fetchAuthorsInfoBatch).not.toHaveBeenCalled();
  });

  it("rejects when author lookup throws", async () => {
    cache.connectToPrimalCache.mockResolvedValue([
      [
        "EVENT",
        "sub",
        {
          content: "hi",
          created_at: 1,
          id: FIRST_CHILD,
          kind: 1,
          pubkey: FIRST_PK,
          tags: [["e", PARENT]],
        },
      ],
    ]);
    authors.fetchAuthorsInfoBatch.mockRejectedValue(new Error("authors down"));

    await expect(loadSearchThreadChildReplies(PARENT)).rejects.toThrow(
      "authors down"
    );
  });
});
