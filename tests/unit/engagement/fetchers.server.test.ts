import { beforeEach, describe, expect, it, vi } from "vitest";

const primal = vi.hoisted(() => ({
  connectToPrimalCache: vi.fn(),
}));
const engagement = vi.hoisted(() => ({
  processQuoteReposts: vi.fn(),
  parseThreadViewNotifications: vi.fn(),
}));
const logger = vi.hoisted(() => ({
  logError: vi.fn(),
}));

vi.mock("~/features/cache/primalCache.server", () => ({
  connectToPrimalCache: primal.connectToPrimalCache,
}));
vi.mock("~/features/engagement/engagement.server", () => engagement);
vi.mock("~/lib/error-logger.server", () => logger);
vi.mock("~/features/engagement/services/thread-view-fetcher.server", () => ({
  fetchThreadViewWithTimeout: vi.fn(),
}));

import {
  processEventBatch,
  processEventBatches,
} from "~/features/engagement/services/event-processor.server";
import {
  fetchUserProfile,
  fetchUserProfilesWithTrustScores,
} from "~/features/engagement/services/profile-fetcher.server";
import {
  extractQuoteReposts,
  fetchQuoteReposts,
} from "~/features/engagement/services/quote-repost-fetcher.server";
import { fetchThreadViewWithTimeout } from "~/features/engagement/services/thread-view-fetcher.server";

const USER = "user-hex";

function quoteEvent(overrides?: {
  pubkey?: string;
  tags?: string[][];
  content?: string;
  id?: string;
}): ["EVENT", string, Record<string, unknown>] {
  return [
    "EVENT",
    "sub",
    {
      id: overrides?.id ?? "evt-1",
      pubkey: overrides?.pubkey ?? "other-hex",
      content: overrides?.content ?? "quoted you",
      kind: 1,
      tags: overrides?.tags ?? [
        ["e", "parent", "", "mention"],
        ["p", USER, "", "mention"],
      ],
    },
  ];
}

describe("quote repost fetcher", () => {
  beforeEach(() => {
    primal.connectToPrimalCache.mockReset();
    engagement.processQuoteReposts.mockReset();
    logger.logError.mockReset();
  });

  it("ignores payloads that are not quote mentions of the user", () => {
    expect(extractQuoteReposts("nope" as unknown as unknown[], USER)).toEqual(
      []
    );
    expect(
      extractQuoteReposts(
        [
          ["EOSE", "sub"],
          quoteEvent(),
          quoteEvent({ pubkey: USER }),
          quoteEvent({ tags: [["e", "parent", "", "mention"]] }),
          quoteEvent({
            tags: [
              ["e", "parent", "", "mention"],
              ["p", "someone-else", "", "mention"],
            ],
          }),
          quoteEvent({ id: "" }),
          ["EVENT", "sub", { kind: 1, content: "x" }],
          quoteEvent({
            tags: [
              ["e", "parent"],
              ["p", USER, "", ""],
            ],
          }),
        ],
        USER
      )
    ).toHaveLength(1);
  });

  it("returns processed quotes and an empty list when nothing matches", async () => {
    primal.connectToPrimalCache.mockResolvedValueOnce([quoteEvent()]);
    engagement.processQuoteReposts.mockResolvedValueOnce([{ id: "n1" }]);

    await expect(fetchQuoteReposts(USER, 10)).resolves.toEqual([{ id: "n1" }]);
    expect(primal.connectToPrimalCache).toHaveBeenCalledWith(
      "get_notifications",
      { pubkey: USER, limit: 10 }
    );

    primal.connectToPrimalCache.mockResolvedValueOnce({ not: "array" });
    await expect(fetchQuoteReposts(USER)).resolves.toEqual([]);
  });

  it("logs and returns an empty list when the cache throws", async () => {
    primal.connectToPrimalCache.mockRejectedValueOnce(new Error("down"));
    await expect(fetchQuoteReposts(USER)).resolves.toEqual([]);
    primal.connectToPrimalCache.mockRejectedValueOnce("down");
    await expect(fetchQuoteReposts(USER)).resolves.toEqual([]);
    expect(logger.logError).toHaveBeenCalledTimes(2);
  });
});

describe("event processor", () => {
  beforeEach(() => {
    vi.mocked(fetchThreadViewWithTimeout).mockReset();
    engagement.parseThreadViewNotifications.mockReset();
    engagement.parseThreadViewNotifications.mockReturnValue([]);
  });

  it("reads stats from a kind 10000100 event and ignores bad JSON", async () => {
    vi.mocked(fetchThreadViewWithTimeout)
      .mockResolvedValueOnce([
        [
          "EVENT",
          "sub",
          {
            kind: 10000100,
            content: JSON.stringify({
              likes: 2,
              replies: 1,
              zaps: 4,
              satszapped: 9,
              ref: "evt-good",
            }),
          },
        ],
        ["EOSE", "sub"],
      ])
      .mockResolvedValueOnce([
        ["EVENT", "sub", { kind: 10000100, content: "evt-bad {" }],
        ["EVENT", "sub", { kind: 1, content: "evt-bad" }],
      ])
      .mockResolvedValueOnce({ unexpected: true })
      .mockRejectedValueOnce(new Error("timeout"));

    const results = await processEventBatch(
      ["evt-good", "evt-bad", "evt-odd", "evt-fail"],
      USER
    );

    expect(results[0]).toMatchObject({
      eventId: "evt-good",
      stats: { likes: 2, replies: 1, mentions: 0, zaps: 4, satszapped: 9 },
    });
    expect(results[1]?.stats.likes).toBe(0);
    expect(results[2]?.notifications).toEqual([]);
    expect(results[3]?.eventId).toBe("evt-fail");
  });

  it("splits ids into batches", async () => {
    vi.mocked(fetchThreadViewWithTimeout).mockResolvedValue([]);
    const results = await processEventBatches(["a", "b", "c"], USER, 2);
    expect(results.map((result) => result.eventId)).toEqual(["a", "b", "c"]);
    expect(fetchThreadViewWithTimeout).toHaveBeenCalledTimes(3);
  });
});

describe("profile fetcher", () => {
  beforeEach(() => {
    primal.connectToPrimalCache.mockReset();
    logger.logError.mockReset();
  });

  it("builds a user from profile and stats events", async () => {
    primal.connectToPrimalCache.mockResolvedValueOnce([
      ["EVENT", "sub", null],
      "nope",
      [
        "EVENT",
        "sub",
        {
          kind: 0,
          content: JSON.stringify({
            name: "ada",
            display_name: "Ada",
            about: "hi",
            picture: "https://cdn.example/a.png",
            nip05: "ada@example.com",
            lud16: "ada@walletofsatoshi.com",
          }),
        },
      ],
      [
        "EVENT",
        "sub",
        {
          kind: 10000105,
          content: JSON.stringify({
            follows_count: 3,
            followers_count: 4,
            note_count: 5,
            reply_count: 1,
            time_joined: 10,
            total_zap_count: 2,
            total_satszapped: 20,
            media_count: 6,
          }),
        },
      ],
    ]);

    const user = await fetchUserProfile("pk");
    expect(user).toMatchObject({
      pubkey: "pk",
      name: "ada",
      displayName: "Ada",
      followsCount: 3,
      followersCount: 4,
      mediaCount: 6,
    });
  });

  it("returns null for a non-array payload and logs parse and fetch failures", async () => {
    primal.connectToPrimalCache.mockResolvedValueOnce({ bad: true });
    await expect(fetchUserProfile("pk")).resolves.toBeNull();

    primal.connectToPrimalCache.mockResolvedValueOnce([
      ["EVENT", "sub", { kind: 0, content: "{" }],
      ["EVENT", "sub", { kind: 10000105, content: "{" }],
      ["EVENT", "sub", { kind: 0 }],
    ]);
    const partial = await fetchUserProfile("pk");
    expect(partial?.followsCount).toBe(0);
    expect(logger.logError).toHaveBeenCalled();

    primal.connectToPrimalCache.mockRejectedValueOnce("offline");
    await expect(fetchUserProfile("pk")).resolves.toBeNull();
  });

  it("scores profiles that resolve and skips the ones that do not", async () => {
    primal.connectToPrimalCache
      .mockResolvedValueOnce([
        ["EVENT", "sub", { kind: 0, content: JSON.stringify({ name: "ada" }) }],
      ])
      .mockResolvedValueOnce(null);

    const { userProfilesMap, trustScoresMap } =
      await fetchUserProfilesWithTrustScores(["pk-1", "pk-2"]);
    expect(userProfilesMap.has("pk-1")).toBe(true);
    expect(userProfilesMap.has("pk-2")).toBe(false);
    expect(trustScoresMap.get("pk-1")).toEqual(expect.any(Number));
  });
});
