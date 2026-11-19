import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({
  connectToPrimalCache: vi.fn(),
}));

const logger = vi.hoisted(() => ({
  logError: vi.fn(),
}));

vi.mock("~/features/cache/primalCache.server", () => cache);
vi.mock("~/lib/error-logger.server", () => logger);

import { fetchAuthorsInfoBatch } from "~/features/search/services/search-authors-batch.server";

const ALICE = "alicepubkey";
const BOB = "bobpubkeyvalue";
const CARA = "carapubkeyvalue";
const DANA = "danapubkeyvalue";
const EVE = "evepubkeyvalue";
const FAY = "faypubkeyvalue";
const GUS = "guspubkeyvalue";

function kind0(pubkey: string, content?: unknown) {
  return [
    "EVENT",
    "profiles",
    {
      content,
      kind: 0,
      pubkey,
    },
  ];
}

describe("fetchAuthorsInfoBatch", () => {
  beforeEach(() => {
    cache.connectToPrimalCache.mockReset();
    logger.logError.mockReset();
  });

  it("returns an empty map and skips the cache when no pubkeys remain", async () => {
    const map = await fetchAuthorsInfoBatch(["", ""]);

    expect(map.size).toBe(0);
    expect(cache.connectToPrimalCache).not.toHaveBeenCalled();
  });

  it("dedupes pubkeys and applies profile metadata", async () => {
    cache.connectToPrimalCache.mockResolvedValue([
      "EOSE",
      ["EVENT", "profiles", null],
      ["NOTICE", "profiles", { content: "{}", kind: 0, pubkey: ALICE }],
      ["EVENT", "profiles", { content: "{}", kind: 1, pubkey: ALICE }],
      ["EVENT", "profiles", { content: '{"name":"nope"}', kind: 0 }],
      kind0("stranger", JSON.stringify({ name: "Zed" })),
      kind0(ALICE, "{bad"),
      kind0(
        BOB,
        JSON.stringify({
          display_name: "Bea",
          picture: "https://img.example/b.png",
        })
      ),
      kind0(CARA, JSON.stringify({ display_name: "Cee", name: "" })),
      kind0(DANA, JSON.stringify({ name: "   " })),
      kind0(EVE, JSON.stringify({ name: "..." })),
      kind0(FAY),
      kind0(GUS, 5),
    ]);

    const map = await fetchAuthorsInfoBatch([
      BOB,
      ALICE,
      BOB,
      CARA,
      DANA,
      EVE,
      FAY,
      GUS,
    ]);

    expect(cache.connectToPrimalCache).toHaveBeenCalledTimes(1);
    expect(cache.connectToPrimalCache).toHaveBeenCalledWith("user_infos", {
      pubkeys: [BOB, ALICE, CARA, DANA, EVE, FAY, GUS],
    });
    expect(map.get(ALICE)).toEqual({
      image: null,
      name: `${ALICE.slice(0, 8)}...`,
    });
    expect(map.get(BOB)).toEqual({
      image: "https://img.example/b.png",
      name: "Bea",
    });
    expect(map.get(CARA)).toEqual({
      image: null,
      name: `${CARA.slice(0, 8)}...`,
    });
    expect(map.get(DANA)?.name).toBe(`${DANA.slice(0, 8)}...`);
    expect(map.get(EVE)?.name).toBe(`${EVE.slice(0, 8)}...`);
    expect(map.get(FAY)).toEqual({
      image: null,
      name: `${FAY.slice(0, 8)}...`,
    });
    expect(map.get(GUS)?.name).toBe(`${GUS.slice(0, 8)}...`);
    expect(map.has("stranger")).toBe(false);
    expect(logger.logError).not.toHaveBeenCalled();
  });

  it("keeps fallback names when the cache throws an Error", async () => {
    const failure = new Error("cache down");
    cache.connectToPrimalCache.mockRejectedValue(failure);

    const map = await fetchAuthorsInfoBatch([ALICE, BOB]);

    expect(map.get(ALICE)?.name).toBe(`${ALICE.slice(0, 8)}...`);
    expect(map.get(BOB)?.image).toBeNull();
    expect(logger.logError).toHaveBeenCalledWith(failure, {
      count: 2,
      message: "[Search] Error batch-fetching author info",
    });
  });

  it("wraps a non-Error cache failure before logging", async () => {
    cache.connectToPrimalCache.mockRejectedValue("boom");

    const map = await fetchAuthorsInfoBatch([ALICE]);

    expect(map.get(ALICE)?.name).toBe(`${ALICE.slice(0, 8)}...`);
    expect(logger.logError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "boom" }),
      {
        count: 1,
        message: "[Search] Error batch-fetching author info",
      }
    );
  });
});
