import { nip19 } from "nostr-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface LogFields {
  message: string;
}

const cache = vi.hoisted(() => ({
  fetchFromCache: vi.fn(
    async (
      _requestType: string,
      _params: { limit: number; pubkey: string }
    ): Promise<unknown> => []
  ),
}));

const logger = vi.hoisted(() => ({
  logError: vi.fn((_error: Error, _fields: LogFields) => undefined),
}));

vi.mock("~/features/cache", () => ({
  fetchFromCache: cache.fetchFromCache,
}));
vi.mock("~/features/engagement/services/engagement-loader.server", () => ({
  loadEngagementFeedData: vi.fn(),
}));
vi.mock("~/lib/error-logger.server", () => ({
  logError: logger.logError,
}));

import {
  buildGlobalMentionNotificationsFromPrimal,
  extractQuoteRepostEventsFromPrimal,
  flattenPrimalNotificationItems,
  getKind1EventFromItem,
  isPrimalGetNotificationsCallEnabled,
  isPrimalItemQuoteRepostMentioningUser,
  loadPrimalGetNotificationsResult,
} from "~/features/engagement/services/engagement-primal-notifications.server";

const FLAG = "MENTIONS_USE_PRIMAL_GET_NOTIFICATIONS";
const USER = "AbCdEf0123";
const USER_HEX = "11".repeat(32);
const USER_NPUB = nip19.npubEncode(USER_HEX);

let previousFlag: string | undefined;

function setFlag(value: string | undefined): void {
  if (value === undefined) delete process.env[FLAG];
  else process.env[FLAG] = value;
}

interface Kind1Fields {
  content?: unknown;
  created_at?: unknown;
  id?: unknown;
  kind?: number;
  pubkey?: unknown;
  tags?: unknown;
}

function kind1(fields: Kind1Fields = {}): Record<string, unknown> {
  return {
    content: fields.content ?? "nostr:note1example",
    created_at: "created_at" in fields ? fields.created_at : 10,
    id: fields.id ?? "evt-1",
    kind: fields.kind ?? 1,
    pubkey: fields.pubkey ?? "AuthorPub",
    tags: fields.tags ?? [
      ["e", "parent", "", "mention"],
      ["p", USER, "wss://relay.example.com"],
    ],
  };
}

describe("primal notification flag and fetch", () => {
  beforeEach(() => {
    previousFlag = process.env[FLAG];
    cache.fetchFromCache.mockReset();
    cache.fetchFromCache.mockResolvedValue([]);
    logger.logError.mockReset();
    setFlag(undefined);
  });

  afterEach(() => {
    setFlag(previousFlag);
  });

  it("enables get_notifications unless the flag is exactly false", () => {
    setFlag(undefined);
    expect(isPrimalGetNotificationsCallEnabled()).toBe(true);
    setFlag("");
    expect(isPrimalGetNotificationsCallEnabled()).toBe(true);
    setFlag("true");
    expect(isPrimalGetNotificationsCallEnabled()).toBe(true);
    setFlag("FALSE");
    expect(isPrimalGetNotificationsCallEnabled()).toBe(true);
    setFlag("false");
    expect(isPrimalGetNotificationsCallEnabled()).toBe(false);
  });

  it("returns the cache payload or a skipped empty list", async () => {
    cache.fetchFromCache.mockResolvedValueOnce({ hello: true });
    await expect(
      loadPrimalGetNotificationsResult({ limit: 15, pubkey: "pk" })
    ).resolves.toEqual({
      data: { hello: true },
      getNotificationsFailed: false,
      primalNotificationsSkipped: false,
    });
    expect(cache.fetchFromCache).toHaveBeenCalledWith("get_notifications", {
      limit: 15,
      pubkey: "pk",
    });

    setFlag("false");
    cache.fetchFromCache.mockClear();
    await expect(
      loadPrimalGetNotificationsResult({ limit: 1, pubkey: "pk" })
    ).resolves.toEqual({
      data: [],
      getNotificationsFailed: false,
      primalNotificationsSkipped: true,
    });
    expect(cache.fetchFromCache).not.toHaveBeenCalled();
  });

  it("logs thrown errors and strings without rejecting", async () => {
    const error = new Error("cache down");
    cache.fetchFromCache.mockRejectedValueOnce(error);
    await expect(
      loadPrimalGetNotificationsResult({ limit: 2, pubkey: "pk" })
    ).resolves.toEqual({
      data: [],
      getNotificationsFailed: true,
      primalNotificationsSkipped: false,
    });
    expect(logger.logError).toHaveBeenCalledWith(error, {
      message:
        "Primal get_notifications request failed (relay fallback may be used)",
    });

    logger.logError.mockClear();
    cache.fetchFromCache.mockRejectedValueOnce("cache down");
    await expect(
      loadPrimalGetNotificationsResult({ limit: 2, pubkey: "pk" })
    ).resolves.toEqual({
      data: [],
      getNotificationsFailed: true,
      primalNotificationsSkipped: false,
    });
    const call = logger.logError.mock.calls[0];
    if (!call) throw new Error("missing log");
    expect(call[0]).toBeInstanceOf(Error);
    expect(call[0].message).toBe("cache down");
    expect(call[1]).toEqual({
      message:
        "Primal get_notifications request failed (relay fallback may be used)",
    });
  });
});

describe("getKind1EventFromItem", () => {
  it("reads kind-1 events from tuples, wrappers, and raw objects", () => {
    const event = { id: "a", kind: 1, pubkey: "b", tags: [["p", USER]] };
    expect(getKind1EventFromItem(["EVENT", "sub", event])).toBe(event);
    expect(getKind1EventFromItem({ event })).toBe(event);
    expect(getKind1EventFromItem({ event: ["EVENT", "sub", event] })).toBe(
      event
    );
    const bare = { id: "a", kind: 1 };
    expect(getKind1EventFromItem(bare)).toBe(bare);
    const noId = { kind: 1 };
    expect(getKind1EventFromItem(["EVENT", "sub", noId])).toBe(noId);
  });

  it("returns null for every non-kind-1 shape", () => {
    expect(getKind1EventFromItem(null)).toBeNull();
    expect(getKind1EventFromItem(undefined)).toBeNull();
    expect(getKind1EventFromItem(1)).toBeNull();
    expect(getKind1EventFromItem("EVENT")).toBeNull();
    expect(getKind1EventFromItem(["EOSE", "sub"])).toBeNull();
    expect(getKind1EventFromItem(["EVENT", "sub"])).toBeNull();
    expect(getKind1EventFromItem(["EVENT", "sub", null])).toBeNull();
    expect(getKind1EventFromItem(["EVENT", "sub", []])).toBeNull();
    expect(getKind1EventFromItem(["EVENT", "sub", "x"])).toBeNull();
    expect(getKind1EventFromItem(["EVENT", "sub", { kind: 2 }])).toBeNull();
    expect(getKind1EventFromItem({ kind: 0, id: "a" })).toBeNull();
    expect(getKind1EventFromItem({ event: null })).toBeNull();
    expect(getKind1EventFromItem({ event: "x" })).toBeNull();
    expect(getKind1EventFromItem({ event: ["EOSE"] })).toBeNull();
    expect(getKind1EventFromItem({ event: { kind: 2 } })).toBeNull();
    expect(
      getKind1EventFromItem({ event: ["EVENT", "sub", { kind: 6 }] })
    ).toBeNull();
    expect(getKind1EventFromItem({ event: { kind: 2 }, kind: 1 })).toBeNull();
  });
});

describe("flattenPrimalNotificationItems", () => {
  const row = { id: "row" };

  it("unwraps notifications, data, and events in that order", () => {
    expect(flattenPrimalNotificationItems(null)).toEqual([]);
    expect(flattenPrimalNotificationItems(undefined)).toEqual([]);
    expect(flattenPrimalNotificationItems("nope")).toEqual([]);
    expect(flattenPrimalNotificationItems(3)).toEqual([]);
    expect(flattenPrimalNotificationItems([])).toEqual([]);
    expect(flattenPrimalNotificationItems([row, ["EOSE"]])).toEqual([
      row,
      ["EOSE"],
    ]);
    expect(flattenPrimalNotificationItems([["EVENT"], row])).toEqual([
      ["EVENT"],
      row,
    ]);
    expect(flattenPrimalNotificationItems([null, row])).toEqual([null, row]);
    expect(
      flattenPrimalNotificationItems([
        { data: ["nope"], events: ["nope"], notifications: [row] },
      ])
    ).toEqual([row]);
    expect(
      flattenPrimalNotificationItems([
        { data: [row], events: ["nope"], notifications: [] },
      ])
    ).toEqual([]);
    expect(
      flattenPrimalNotificationItems([
        { data: [row], events: ["nope"], notifications: "x" },
      ])
    ).toEqual([row]);
    expect(
      flattenPrimalNotificationItems([
        { data: "y", events: [row], notifications: "x" },
      ])
    ).toEqual([row]);
    expect(
      flattenPrimalNotificationItems([
        { data: {}, events: 1, notifications: "x" },
      ])
    ).toEqual([]);
    expect(flattenPrimalNotificationItems([{ other: true }, row])).toEqual([
      { other: true },
      row,
    ]);
    expect(
      flattenPrimalNotificationItems({
        data: ["nope"],
        events: ["nope"],
        notifications: [row],
      })
    ).toEqual([row]);
    expect(
      flattenPrimalNotificationItems({
        data: [row],
        events: ["no"],
        notifications: null,
      })
    ).toEqual([row]);
    expect(
      flattenPrimalNotificationItems({
        data: null,
        events: [row],
        notifications: "x",
      })
    ).toEqual([row]);
    expect(flattenPrimalNotificationItems({ other: true })).toEqual([]);
  });
});

describe("quote repost extraction", () => {
  it("accepts only other users' kind-1 quotes that p-tag the user", () => {
    expect(isPrimalItemQuoteRepostMentioningUser(kind1(), USER)).toBe(true);
    expect(
      isPrimalItemQuoteRepostMentioningUser(
        kind1({ content: "see nostr:nevent1abc" }),
        USER
      )
    ).toBe(true);
    expect(
      isPrimalItemQuoteRepostMentioningUser(
        kind1({ content: "see nostr:naddr1abc" }),
        USER
      )
    ).toBe(true);
    expect(
      isPrimalItemQuoteRepostMentioningUser(
        kind1({
          tags: [
            ["e", "parent", "", "reply"],
            ["e", "parent", "", "mention"],
            ["p", "abcdef0123"],
          ],
        }),
        USER
      )
    ).toBe(true);
    expect(
      isPrimalItemQuoteRepostMentioningUser(
        { event: ["EVENT", "sub", kind1()] },
        USER
      )
    ).toBe(true);

    expect(
      isPrimalItemQuoteRepostMentioningUser(kind1({ kind: 2 }), USER)
    ).toBe(false);
    expect(isPrimalItemQuoteRepostMentioningUser(["EOSE"], USER)).toBe(false);
    expect(isPrimalItemQuoteRepostMentioningUser(kind1({ id: "" }), USER)).toBe(
      false
    );
    expect(isPrimalItemQuoteRepostMentioningUser(kind1({ id: 1 }), USER)).toBe(
      false
    );
    expect(
      isPrimalItemQuoteRepostMentioningUser(kind1({ pubkey: "" }), USER)
    ).toBe(false);
    expect(
      isPrimalItemQuoteRepostMentioningUser(kind1({ pubkey: 1 }), USER)
    ).toBe(false);
    expect(
      isPrimalItemQuoteRepostMentioningUser(kind1({ content: 1 }), USER)
    ).toBe(false);
    expect(
      isPrimalItemQuoteRepostMentioningUser(
        kind1({ pubkey: "abcdef0123" }),
        USER
      )
    ).toBe(false);
    expect(
      isPrimalItemQuoteRepostMentioningUser(kind1({ tags: [] }), USER)
    ).toBe(false);
    expect(
      isPrimalItemQuoteRepostMentioningUser(kind1({ tags: "bad" }), USER)
    ).toBe(false);
    expect(
      isPrimalItemQuoteRepostMentioningUser(
        kind1({ tags: [["e", "parent", "", "mention"]] }),
        USER
      )
    ).toBe(false);
    expect(
      isPrimalItemQuoteRepostMentioningUser(
        kind1({
          tags: [
            ["e", "parent", "", "mention"],
            ["p", "someone-else"],
          ],
        }),
        USER
      )
    ).toBe(false);
    expect(
      isPrimalItemQuoteRepostMentioningUser(
        kind1({
          tags: [
            ["e", "parent", "", "reply"],
            ["p", USER],
          ],
        }),
        USER
      )
    ).toBe(false);
    expect(
      isPrimalItemQuoteRepostMentioningUser(
        kind1({
          content: "nostr:note1example",
          tags: [
            ["e", "parent", "", "Mention"],
            ["p", USER],
          ],
        }),
        USER
      )
    ).toBe(false);
    expect(
      isPrimalItemQuoteRepostMentioningUser(
        kind1({
          content: "hello",
          tags: [
            ["e", "parent", "", "mention"],
            ["p", USER],
          ],
        }),
        USER
      )
    ).toBe(false);
    expect(
      isPrimalItemQuoteRepostMentioningUser(
        kind1({
          content: `hello nostr:${USER_NPUB}`,
          tags: [
            ["e", "parent", "", "mention"],
            ["p", USER],
          ],
        }),
        USER
      )
    ).toBe(false);
  });

  it("collects matching quote events and skips everything else", () => {
    const quote = kind1({ id: "q1" });
    expect(extractQuoteRepostEventsFromPrimal(undefined, USER)).toEqual([]);
    expect(extractQuoteRepostEventsFromPrimal([], USER)).toEqual([]);
    expect(
      extractQuoteRepostEventsFromPrimal(
        [quote, ["EOSE", "sub"], kind1({ content: "hi", id: "no", tags: [] })],
        USER
      )
    ).toEqual([quote]);
    expect(
      extractQuoteRepostEventsFromPrimal({ notifications: [quote] }, USER)
    ).toEqual([quote]);
    const wrapped = kind1({ id: "wrapped" });
    expect(
      extractQuoteRepostEventsFromPrimal([{ event: wrapped }], USER)
    ).toEqual([wrapped]);
  });
});

describe("buildGlobalMentionNotificationsFromPrimal", () => {
  it("keeps mentions and drops replies, self posts, and excluded ids", () => {
    const plain = kind1({
      content: "hi",
      created_at: 9,
      id: "m-plain",
      tags: [["p", USER]],
    });
    const rooted = kind1({
      content: "thread",
      created_at: 4,
      id: "m-root",
      tags: [
        ["e", "first"],
        ["e", "second"],
        ["p", "abcdef0123"],
      ],
    });
    const numericContent = kind1({
      content: 5,
      created_at: "42",
      id: "m-num",
      tags: [["p", USER]],
    });
    const badTime = kind1({
      content: "time",
      created_at: "nope",
      id: "m-bad-time",
      tags: [["p", USER]],
    });
    const missingTime = kind1({
      content: "missing",
      created_at: null,
      id: "m-missing-time",
      tags: [["p", USER]],
    });
    const boolTime = kind1({
      content: "bool",
      created_at: true,
      id: "m-bool-time",
      tags: [["p", USER]],
    });
    const blankTime = kind1({
      content: "blank",
      created_at: "",
      id: "m-blank-time",
      tags: [["p", USER]],
    });
    const caseKept = kind1({
      content: "case",
      created_at: "08",
      id: "Ab",
      tags: [["p", USER]],
    });

    const mentions = buildGlobalMentionNotificationsFromPrimal(
      {
        notifications: [
          plain,
          rooted,
          numericContent,
          badTime,
          missingTime,
          boolTime,
          blankTime,
          caseKept,
          ["EOSE", "sub"],
          kind1({ id: "not-kind", kind: 7, tags: [["p", USER]] }),
          kind1({ id: 4, tags: [["p", USER]] }),
          kind1({ id: "no-author", pubkey: 4, tags: [["p", USER]] }),
          kind1({ id: "self", pubkey: "abcdef0123", tags: [["p", USER]] }),
          kind1({
            content: "no mention",
            id: "silent",
            tags: [],
          }),
          kind1({
            content: "hi",
            id: "excluded",
            tags: [["p", USER]],
          }),
          kind1({
            content: "reply",
            id: "reply",
            tags: [
              ["e", "x", "", "reply"],
              ["p", USER],
            ],
          }),
          kind1({
            content: "legacy",
            id: "legacy",
            tags: [
              ["e", "AbC"],
              ["p", USER],
            ],
          }),
          kind1({
            content: "quote",
            id: "quote-kept",
            tags: [
              ["e", "published-id", "", "mention"],
              ["p", USER],
            ],
          }),
        ],
      },
      USER,
      new Set(["excluded", "ab"]),
      new Set(["abc"])
    );

    expect(
      mentions.map((item) => [item.id, item.createdAt, item.originalEventId])
    ).toEqual([
      ["m-num", 42, "m-num"],
      ["quote-kept", 10, "published-id"],
      ["m-plain", 9, "m-plain"],
      ["Ab", 8, "Ab"],
      ["m-root", 4, "second"],
      ["m-bad-time", 0, "m-bad-time"],
      ["m-missing-time", 0, "m-missing-time"],
      ["m-bool-time", 0, "m-bool-time"],
      ["m-blank-time", 0, "m-blank-time"],
    ]);
    expect(mentions[0]).toEqual({
      content: "",
      createdAt: 42,
      eventId: "m-num",
      id: "m-num",
      originalEventId: "m-num",
      pubkey: "AuthorPub",
      type: "mention",
    });
    const plainMention = mentions.find((item) => item.id === "m-plain");
    expect(plainMention?.content).toBe("hi");
  });

  it("accepts a nostr npub in the body when tags are not an array", () => {
    const event = kind1({
      content: `hello nostr:${USER_NPUB}`,
      created_at: 3,
      id: "m-npub",
      pubkey: "OtherAuthor",
      tags: "bad",
    });
    expect(
      buildGlobalMentionNotificationsFromPrimal(
        [event],
        USER_HEX,
        new Set(),
        new Set()
      )
    ).toEqual([
      {
        content: `hello nostr:${USER_NPUB}`,
        createdAt: 3,
        eventId: "m-npub",
        id: "m-npub",
        originalEventId: "m-npub",
        pubkey: "OtherAuthor",
        type: "mention",
      },
    ]);
  });
});
