import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchFromCache = vi.hoisted(() =>
  vi.fn<
    (requestType: string, params: Record<string, unknown>) => Promise<unknown>
  >()
);

vi.mock("~/features/cache", () => ({
  fetchFromCache,
}));

import {
  getFollowedPubkeys,
  getFollowedPubkeysGraph,
  getFollowerPubkeys,
  getFollowerPubkeysGraph,
  getMutualPubkeys,
  getMutualPubkeysGraph,
} from "~/features/nostr/social-graph.server";

const USER = "ab".repeat(32);
const FOLLOWER = "cd".repeat(32);
const OTHER = "ef".repeat(32);

function eventFrame(
  event: Record<string, unknown> | null
): [string, string, Record<string, unknown> | null] {
  return ["EVENT", "sub", event];
}

describe("social graph cache readers", () => {
  beforeEach(() => {
    fetchFromCache.mockReset();
  });

  it("reads kind 3 p tags and reports an empty graph without a failure", async () => {
    fetchFromCache.mockResolvedValueOnce([
      ["EOSE", "sub"],
      eventFrame(null),
      eventFrame({ kind: 1, tags: [["p", FOLLOWER]] }),
      eventFrame({ kind: 3, tags: "nope" }),
      eventFrame({
        kind: 3,
        tags: [
          ["e", FOLLOWER],
          "p",
          ["p", 12],
          ["p", OTHER.toUpperCase()],
          ["p", "not-hex"],
        ],
      }),
      eventFrame({ kind: 3, tags: [["p", FOLLOWER]] }),
    ]);

    await expect(getFollowedPubkeysGraph(USER)).resolves.toEqual({
      pubkeys: [OTHER, "not-hex"],
      fetchFailed: false,
    });
    expect(fetchFromCache).toHaveBeenCalledWith("contact_list", {
      pubkey: USER,
      extended_response: false,
    });

    fetchFromCache.mockResolvedValueOnce([]);
    await expect(getFollowedPubkeys(USER)).resolves.toEqual([]);
    fetchFromCache.mockResolvedValueOnce({ unexpected: true });
    await expect(getFollowedPubkeysGraph(USER)).resolves.toEqual({
      pubkeys: [],
      fetchFailed: false,
    });
  });

  it("returns an empty followed list when the cache throws", async () => {
    fetchFromCache.mockRejectedValueOnce(new Error("upstream 500"));
    await expect(getFollowedPubkeysGraph(USER)).resolves.toEqual({
      pubkeys: [],
      fetchFailed: true,
    });
    fetchFromCache.mockRejectedValueOnce("down");
    await expect(getFollowedPubkeys(USER)).resolves.toEqual([]);
  });

  it("keeps valid follower pubkeys and drops malformed event frames", async () => {
    fetchFromCache.mockResolvedValueOnce([
      "nope",
      ["EVENT", "sub"],
      eventFrame({ pubkey: 1 }),
      eventFrame({ pubkey: "zz" }),
      eventFrame({ pubkey: FOLLOWER.toUpperCase() }),
      eventFrame({ pubkey: FOLLOWER }),
      eventFrame({ pubkey: ` ${OTHER}` }),
    ]);

    await expect(getFollowerPubkeysGraph(USER)).resolves.toEqual({
      pubkeys: [FOLLOWER],
      fetchFailed: false,
    });
    expect(fetchFromCache).toHaveBeenCalledWith("user_followers", {
      pubkey: USER,
      limit: 1000,
    });

    fetchFromCache.mockResolvedValueOnce([]);
    await expect(getFollowerPubkeys(USER)).resolves.toEqual([]);
  });

  it("reports a follower fetch failure separately from an empty graph", async () => {
    fetchFromCache.mockRejectedValueOnce(new Error("followers down"));
    await expect(getFollowerPubkeysGraph(USER)).resolves.toEqual({
      pubkeys: [],
      fetchFailed: true,
    });
    fetchFromCache.mockResolvedValueOnce("not-an-array");
    await expect(getFollowerPubkeys(USER)).resolves.toEqual([]);
  });

  it("reads mutual follows with both pubkey arguments", async () => {
    fetchFromCache.mockResolvedValueOnce([
      eventFrame({ pubkey: OTHER.toUpperCase() }),
      eventFrame({ pubkey: OTHER }),
    ]);

    await expect(getMutualPubkeys(USER)).resolves.toEqual([OTHER]);
    expect(fetchFromCache).toHaveBeenCalledWith("mutual_follows", {
      pubkey: USER,
      user_pubkey: USER,
    });

    fetchFromCache.mockResolvedValueOnce([]);
    await expect(getMutualPubkeysGraph(USER)).resolves.toEqual({
      pubkeys: [],
      fetchFailed: false,
    });
    fetchFromCache.mockRejectedValueOnce(new Error("mutual down"));
    await expect(getMutualPubkeysGraph(USER)).resolves.toEqual({
      pubkeys: [],
      fetchFailed: true,
    });
  });
});
