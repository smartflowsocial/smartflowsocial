import { nip19 } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({
  connectToPrimalCache: vi.fn(),
}));

const statsApi = vi.hoisted(() => ({
  getPostStats: vi.fn(),
}));

const logger = vi.hoisted(() => ({
  logError: vi.fn(),
  logWarning: vi.fn(),
}));

vi.mock("~/features/cache/primalCache.server", () => cache);
vi.mock("~/features/posts/stats.server", () => statsApi);
vi.mock("~/lib/error-logger.server", () => logger);

import {
  decodeEventId,
  decodeSearchInput,
  deriveLookupIdentifierKind,
  handleSearchEvent,
} from "~/features/search/services/search-action.server";
import {
  ExternalServiceError,
  LookupUnsupportedKindError,
  NotFoundError,
  ValidationError,
} from "~/lib/errors";

const EVENT_ID = "ab".repeat(32);
const PUBKEY = "cd".repeat(32);
const REPLY_ID = "ef".repeat(32);
const REPLY_PK = "12".repeat(32);
const NOTE = nip19.noteEncode(EVENT_ID);
const NEVENT = nip19.neventEncode({ id: EVENT_ID });
const NADDR = nip19.naddrEncode({
  identifier: "my-article",
  kind: 30023,
  pubkey: PUBKEY,
});
const PUBKEY_LABEL = `${PUBKEY.slice(0, 8)}...`;
const ROOT_CONTENT = "Hello https://cdn.example.com/pic.jpg";
const ROOT_TAGS = [
  ["url", "https://cdn.example.com/pic.jpg"],
  ["url", "https://cdn.example.com/clip.mp4"],
  ["imeta", "dim", "https://cdn.example.com/extra.png"],
  ["t", "nostr"],
];
const STATS = {
  likes: 2,
  mentions: 0,
  replies: 1,
  reposts: 3,
  satszapped: 9,
  zaps: 4,
};
const EMPTY_STATS = {
  likes: 0,
  mentions: 0,
  replies: 0,
  reposts: 0,
  satszapped: 0,
  zaps: 0,
};

let threadPayload: unknown[] = [];
let eventsPayload: unknown[] = [];
let fallbackEventsPayload: unknown[] | null = null;
let naddrPayload: unknown[] = [];
let threadError: unknown = null;
let eventsError: unknown = null;
let naddrError: unknown = null;
let userInfoError: unknown = null;
let userInfoRows: unknown[] | null = null;
let eventsCalls = 0;

function eventTuple(event: Record<string, unknown>): unknown[] {
  return ["EVENT", "sub", event];
}

function pubkeyList(params: unknown): string[] {
  if (typeof params !== "object" || params === null) return [];
  const record = params as Record<string, unknown>;
  const value = record["pubkeys"];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function profilesFor(pubkeys: string[]): unknown[] {
  return pubkeys.map((pubkey) =>
    eventTuple({
      content: JSON.stringify({
        name: `name-${pubkey.slice(0, 4)}`,
        picture: `https://img.example/${pubkey.slice(0, 4)}`,
      }),
      kind: 0,
      pubkey,
    })
  );
}

function rootEvent(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    content: ROOT_CONTENT,
    created_at: 1_700_000_000,
    id: EVENT_ID,
    kind: 1,
    pubkey: PUBKEY,
    tags: ROOT_TAGS,
    ...overrides,
  };
}

function replyEvent(): Record<string, unknown> {
  return {
    content: "reply https://cdn.example.com/reply.webp",
    created_at: 1_700_000_050,
    id: REPLY_ID,
    kind: 1,
    pubkey: REPLY_PK,
    tags: [
      ["e", EVENT_ID],
      ["url", "https://cdn.example.com/reply.webp"],
    ],
  };
}

function stageThread(root: Record<string, unknown>, withReply = true): void {
  threadPayload = [
    eventTuple(root),
    ...(withReply ? [eventTuple(replyEvent())] : []),
  ];
  eventsPayload = [eventTuple(root)];
}

describe("deriveLookupIdentifierKind", () => {
  it("classifies naddr, nevent, note, and hex", () => {
    expect(deriveLookupIdentifierKind("nostr:naddr1abc")).toBe("naddr");
    expect(deriveLookupIdentifierKind("nostr:  note1abc")).toBe("note");
    expect(deriveLookupIdentifierKind("  nevent1abc")).toBe("nevent");
    expect(deriveLookupIdentifierKind(`  ${EVENT_ID}  `)).toBe("hex");
    expect(deriveLookupIdentifierKind("nostr:abcd")).toBe("hex");
  });
});

describe("decodeEventId", () => {
  it("returns a hex id, a note, and a nevent", () => {
    expect(decodeEventId(`  ${EVENT_ID}  `)).toBe(EVENT_ID);
    expect(decodeEventId(`nostr:${EVENT_ID}`)).toBe(EVENT_ID);
    expect(decodeEventId(EVENT_ID.toUpperCase())).toBe(EVENT_ID.toUpperCase());
    expect(decodeEventId(NOTE)).toBe(EVENT_ID);
    expect(decodeEventId(`nostr:${NOTE}`)).toBe(EVENT_ID);
    expect(decodeEventId(NEVENT)).toBe(EVENT_ID);
    expect(decodeEventId(` nostr:${NEVENT} `)).toBe(EVENT_ID);
  });

  it("rejects an invalid note, nevent, or hex string", () => {
    expect(() => decodeEventId("note1qqqq")).toThrow("Invalid note1 format");
    expect(() => decodeEventId("nevent1qqqq")).toThrow(
      "Invalid nevent1 format"
    );
    expect(() => decodeEventId("hello")).toThrow(
      "Invalid event ID format. Must be a 64-character hex string, note1, nevent1, or naddr1"
    );
    expect(() => decodeEventId("")).toThrow(
      "Invalid event ID format. Must be a 64-character hex string, note1, nevent1, or naddr1"
    );
  });
});

describe("decodeSearchInput", () => {
  it("decodes an naddr and delegates notes to an event id", () => {
    expect(decodeSearchInput(NADDR)).toEqual({
      identifier: "my-article",
      kind: 30023,
      pubkey: PUBKEY,
      type: "naddr",
    });
    expect(decodeSearchInput(` nostr:${NADDR} `)).toEqual({
      identifier: "my-article",
      kind: 30023,
      pubkey: PUBKEY,
      type: "naddr",
    });
    expect(decodeSearchInput(NOTE)).toEqual({
      eventId: EVENT_ID,
      type: "event_id",
    });
    expect(decodeSearchInput(EVENT_ID)).toEqual({
      eventId: EVENT_ID,
      type: "event_id",
    });
  });

  it("rejects an invalid naddr", () => {
    expect(() => decodeSearchInput("naddr1qqqq")).toThrow(
      "Invalid naddr1 format"
    );
  });
});

describe("handleSearchEvent", () => {
  beforeEach(() => {
    threadPayload = [];
    eventsPayload = [];
    fallbackEventsPayload = null;
    naddrPayload = [];
    threadError = null;
    eventsError = null;
    naddrError = null;
    userInfoError = null;
    userInfoRows = null;
    eventsCalls = 0;
    cache.connectToPrimalCache.mockReset();
    statsApi.getPostStats.mockReset();
    logger.logError.mockReset();
    logger.logWarning.mockReset();
    statsApi.getPostStats.mockResolvedValue({ [EVENT_ID]: STATS });
    cache.connectToPrimalCache.mockImplementation(
      async (requestType: string, params: Record<string, unknown>) => {
        if (requestType === "user_infos") {
          if (userInfoError !== null) throw userInfoError;
          if (userInfoRows !== null) return userInfoRows;
          return profilesFor(pubkeyList(params));
        }
        if (requestType === "thread_view") {
          if (threadError !== null) throw threadError;
          return threadPayload;
        }
        if (requestType === "events") {
          eventsCalls += 1;
          if (eventsCalls > 1 && fallbackEventsPayload !== null) {
            return fallbackEventsPayload;
          }
          if (eventsError !== null) throw eventsError;
          return eventsPayload;
        }
        if (requestType === "parametrized_replaceable_event") {
          if (naddrError !== null) throw naddrError;
          return naddrPayload;
        }
        return [];
      }
    );
  });

  it("rejects an empty search", async () => {
    await expect(handleSearchEvent("")).rejects.toBeInstanceOf(ValidationError);
    await expect(handleSearchEvent("   ")).rejects.toMatchObject({
      message: "Please enter an event ID, nevent1, or naddr1",
    });
    expect(cache.connectToPrimalCache).not.toHaveBeenCalled();
  });

  it("rejects an identifier that cannot be decoded", async () => {
    await expect(handleSearchEvent("  hello  ")).rejects.toMatchObject({
      context: { input: "hello" },
      message:
        "Invalid event ID format. Must be a 64-character hex string, note1, nevent1, or naddr1",
    });
    await expect(handleSearchEvent("naddr1qqqq")).rejects.toMatchObject({
      context: { input: "naddr1qqqq" },
      message: "Invalid naddr1 format",
    });
  });

  it("returns the note, author, stats, media, and direct replies", async () => {
    stageThread(rootEvent());

    const result = await handleSearchEvent(EVENT_ID);

    expect(result.success).toBe(true);
    expect(result.event).toMatchObject({
      authorImage: "https://img.example/cdcd",
      authorName: "name-cdcd",
      content: ROOT_CONTENT,
      created_at: 1_700_000_000,
      id: EVENT_ID,
      kind: 1,
      mediaUrls: [
        "https://cdn.example.com/pic.jpg",
        "https://cdn.example.com/clip.mp4",
        "https://cdn.example.com/extra.png",
      ],
      pubkey: PUBKEY,
    });
    expect(result.event.tags).toEqual(ROOT_TAGS);
    expect(result.stats).toEqual(STATS);
    expect(result.replies).toEqual([
      {
        authorImage: "https://img.example/1212",
        authorName: "name-1212",
        content: "reply https://cdn.example.com/reply.webp",
        created_at: 1_700_000_050,
        id: REPLY_ID,
        mediaUrls: ["https://cdn.example.com/reply.webp"],
        pubkey: REPLY_PK,
      },
    ]);
    expect(result.resolution).toEqual({
      identifierKind: "hex",
      labels: ["Resolved from event ID", "Thread replies loaded: 1"],
      statsUnavailable: false,
      status: "resolved",
      threadPartial: false,
      topLevelReplyCount: 1,
    });
    expect(cache.connectToPrimalCache).toHaveBeenCalledWith("thread_view", {
      event_id: EVENT_ID,
    });
    expect(cache.connectToPrimalCache).toHaveBeenCalledWith("events", {
      event_ids: [EVENT_ID],
    });
    expect(statsApi.getPostStats).toHaveBeenCalledWith([EVENT_ID]);
    expect(eventsCalls).toBe(1);
  });

  it("resolves a note url and a nevent", async () => {
    stageThread(rootEvent(), false);

    const fromNote = await handleSearchEvent(`https://primal.net/e/${NOTE}`);
    expect(fromNote.resolution.identifierKind).toBe("note");
    expect(fromNote.resolution.labels[0]).toBe("Resolved from note");
    expect(fromNote.event.id).toBe(EVENT_ID);

    cache.connectToPrimalCache.mockClear();
    const fromNevent = await handleSearchEvent(`nostr:${NEVENT}`);
    expect(fromNevent.resolution.identifierKind).toBe("nevent");
    expect(fromNevent.resolution.labels[0]).toBe("Resolved from nevent");
    expect(cache.connectToPrimalCache).toHaveBeenCalledWith("events", {
      event_ids: [EVENT_ID],
    });
  });

  it("matches an uppercase hex id against a lowercase cached event", async () => {
    stageThread(rootEvent(), false);
    const upper = EVENT_ID.toUpperCase();

    const result = await handleSearchEvent(upper);

    expect(result.event.id).toBe(EVENT_ID);
    expect(cache.connectToPrimalCache).toHaveBeenCalledWith("events", {
      event_ids: [upper],
    });
    expect(statsApi.getPostStats).toHaveBeenCalledWith([EVENT_ID]);
  });

  it("prefers the richer kind 1 body over other copies of the same id", async () => {
    eventsPayload = [
      eventTuple({
        content: "aa",
        created_at: 1,
        id: EVENT_ID,
        kind: 1,
        pubkey: PUBKEY,
        tags: [],
      }),
      eventTuple({
        content: "aa",
        created_at: 1,
        event_id: EVENT_ID,
        kind: 1,
        pubkey: PUBKEY,
        tags: [],
      }),
      eventTuple({
        content: "short",
        created_at: 1,
        id: EVENT_ID,
        kind: 1,
        tags: [],
      }),
      eventTuple({
        content: "repost",
        created_at: 1,
        id: EVENT_ID,
        kind: 6,
        pubkey: PUBKEY,
        tags: [],
      }),
      eventTuple({
        content: "a".repeat(30),
        created_at: 9,
        id: EVENT_ID,
        kind: 1,
        pubkey: PUBKEY,
        tags: [],
      }),
    ];

    const result = await handleSearchEvent(EVENT_ID);

    expect(result.event.content).toBe("a".repeat(30));
    expect(result.event.kind).toBe(1);
    expect(result.replies).toEqual([]);
  });

  it("uses event_id, body, and event_kind when the cache shape is loose", async () => {
    eventsPayload = [
      eventTuple({
        body: "from-body",
        event_id: EVENT_ID,
        event_kind: 1,
        pubkey: PUBKEY,
      }),
    ];

    const result = await handleSearchEvent(EVENT_ID);

    expect(result.event).toMatchObject({
      content: "from-body",
      created_at: 0,
      id: EVENT_ID,
      kind: 1,
      tags: [],
    });
  });

  it("returns a pubkey prefix when the note has no author metadata", async () => {
    stageThread(rootEvent({ pubkey: undefined }), false);
    userInfoRows = [];

    const result = await handleSearchEvent(EVENT_ID);

    expect(result.event.pubkey).toBe("");
    expect(result.event.authorName).toBe("...");
    expect(result.event.authorImage).toBeNull();
  });

  it("keeps a fallback name when profile json is invalid or blank", async () => {
    stageThread(rootEvent(), false);
    userInfoRows = [eventTuple({ content: "{bad", kind: 0, pubkey: PUBKEY })];

    const invalid = await handleSearchEvent(EVENT_ID);
    expect(invalid.event.authorName).toBe(PUBKEY_LABEL);
    expect(invalid.event.authorImage).toBeNull();
    expect(logger.logError).not.toHaveBeenCalled();

    userInfoRows = [
      eventTuple({
        content: JSON.stringify({
          name: "   ",
          picture: "https://pic.example/p.png",
        }),
        kind: 0,
        pubkey: PUBKEY,
      }),
    ];
    const blank = await handleSearchEvent(EVENT_ID);
    expect(blank.event.authorName).toBe(PUBKEY_LABEL);
    expect(blank.event.authorImage).toBe("https://pic.example/p.png");

    userInfoRows = [
      eventTuple({
        content: JSON.stringify({ name: "..." }),
        kind: 0,
        pubkey: PUBKEY,
      }),
    ];
    const dots = await handleSearchEvent(EVENT_ID);
    expect(dots.event.authorName).toBe(PUBKEY_LABEL);

    userInfoRows = [
      eventTuple({
        content: JSON.stringify({
          display_name: "Dee",
          picture: "https://pic.example/d.png",
        }),
        kind: 0,
        pubkey: PUBKEY,
      }),
    ];
    const display = await handleSearchEvent(EVENT_ID);
    expect(display.event.authorName).toBe("Dee");
    expect(display.event.authorImage).toBe("https://pic.example/d.png");

    userInfoRows = [
      ["EOSE"],
      eventTuple({ content: "{}", kind: 1, pubkey: PUBKEY }),
      eventTuple({
        content: JSON.stringify({ name: "Other" }),
        kind: 0,
        pubkey: "ff".repeat(32),
      }),
    ];
    const unmatched = await handleSearchEvent(EVENT_ID);
    expect(unmatched.event.authorName).toBe(PUBKEY_LABEL);
    expect(unmatched.event.authorImage).toBeNull();
  });

  it("still returns the note when author lookup throws", async () => {
    stageThread(rootEvent(), false);
    userInfoError = new Error("profiles down");

    const result = await handleSearchEvent(EVENT_ID);

    expect(result.event.authorName).toBe(PUBKEY_LABEL);
    expect(result.event.content).toBe(ROOT_CONTENT);
    expect(logger.logError).toHaveBeenCalledWith(userInfoError, {
      message: "[Search] Error fetching author info",
      pubkey: PUBKEY,
    });

    userInfoError = "profiles-string";
    await handleSearchEvent(EVENT_ID);
    expect(logger.logError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "profiles-string" }),
      {
        message: "[Search] Error fetching author info",
        pubkey: PUBKEY,
      }
    );
  });

  it("marks stats unavailable when the stats service throws", async () => {
    stageThread(rootEvent(), false);
    statsApi.getPostStats.mockRejectedValue(new Error("stats down"));

    const result = await handleSearchEvent(EVENT_ID);

    expect(result.stats).toEqual(EMPTY_STATS);
    expect(result.resolution.status).toBe("partial");
    expect(result.resolution.statsUnavailable).toBe(true);
    expect(result.resolution.labels).toContain("Stats unavailable");
    expect(logger.logWarning).toHaveBeenCalledWith(
      "Failed to fetch stats for searched event",
      { error: "stats down", eventId: EVENT_ID }
    );

    statsApi.getPostStats.mockRejectedValue("stats-string");
    await handleSearchEvent(EVENT_ID);
    expect(logger.logWarning).toHaveBeenCalledWith(
      "Failed to fetch stats for searched event",
      { error: "stats-string", eventId: EVENT_ID }
    );
  });

  it("uses empty stats when the stats map has no entry for the event", async () => {
    stageThread(rootEvent(), false);
    statsApi.getPostStats.mockResolvedValue({});

    const result = await handleSearchEvent(EVENT_ID);

    expect(result.stats).toEqual(EMPTY_STATS);
    expect(result.resolution.statsUnavailable).toBe(false);
    expect(result.resolution.status).toBe("resolved");
  });

  it("marks the thread partial when thread_view fails and events succeed", async () => {
    eventsPayload = [eventTuple(rootEvent())];
    threadError = new Error("thread down");

    const result = await handleSearchEvent(EVENT_ID);

    expect(result.event.id).toBe(EVENT_ID);
    expect(result.resolution.threadPartial).toBe(true);
    expect(result.resolution.status).toBe("partial");
    expect(result.resolution.labels).toContain("Thread data may be incomplete");
    expect(eventsCalls).toBe(1);
  });

  it("uses the thread when the events request fails", async () => {
    threadPayload = [eventTuple(rootEvent())];
    eventsError = new Error("events down");

    const result = await handleSearchEvent(EVENT_ID);

    expect(result.event.id).toBe(EVENT_ID);
    expect(result.resolution.threadPartial).toBe(false);
    expect(eventsCalls).toBe(1);
  });

  it("falls back to a second events fetch when both first responses are empty", async () => {
    fallbackEventsPayload = [eventTuple(rootEvent())];

    const result = await handleSearchEvent(EVENT_ID);

    expect(result.event.id).toBe(EVENT_ID);
    expect(result.resolution.threadPartial).toBe(false);
    expect(eventsCalls).toBe(2);
    expect(cache.connectToPrimalCache).toHaveBeenCalledWith("events", {
      event_ids: [EVENT_ID],
    });
  });

  it("reports both cache failures when the events fallback throws", async () => {
    threadError = "thread-string";
    eventsError = new Error("events-down");

    await expect(handleSearchEvent(EVENT_ID)).rejects.toMatchObject({
      context: {
        eventId: EVENT_ID,
        originalError: "events-down",
        service: "PrimalCache",
        threadViewError: "thread-string",
      },
      message: "Failed to fetch event from cache",
    });
    await expect(handleSearchEvent(EVENT_ID)).rejects.toBeInstanceOf(
      ExternalServiceError
    );
  });

  it("throws when the cached id is not a kind 1 note", async () => {
    eventsPayload = [
      eventTuple({
        content: "repost",
        id: EVENT_ID,
        kind: 6,
        pubkey: PUBKEY,
      }),
    ];

    await expect(handleSearchEvent(EVENT_ID)).rejects.toBeInstanceOf(
      LookupUnsupportedKindError
    );
    await expect(handleSearchEvent(EVENT_ID)).rejects.toMatchObject({
      context: { input: EVENT_ID, kind: 6 },
      message:
        "This identifier is valid, but this object type is not supported in lookup yet.",
    });
  });

  it("throws when the event id is not in the cache", async () => {
    eventsPayload = [
      eventTuple({
        content: "other",
        id: "ff".repeat(32),
        kind: 1,
        pubkey: PUBKEY,
      }),
    ];

    await expect(handleSearchEvent(NOTE)).rejects.toBeInstanceOf(NotFoundError);
    await expect(handleSearchEvent(NOTE)).rejects.toMatchObject({
      context: { input: EVENT_ID },
      message: "Event not found. Please check the ID or address and try again.",
    });
  });

  it("resolves an addressable article and its direct replies", async () => {
    naddrPayload = [
      eventTuple({
        content: "Article https://cdn.example.com/cover.jpg",
        created_at: 1_700_000_000,
        id: EVENT_ID,
        kind: 30023,
        pubkey: PUBKEY,
        tags: [
          ["d", "my-article"],
          ["url", "https://cdn.example.com/cover.jpg"],
        ],
      }),
    ];
    threadPayload = [eventTuple(replyEvent())];

    const result = await handleSearchEvent(`nostr:${NADDR}`);

    expect(result.event).toMatchObject({
      content: "Article https://cdn.example.com/cover.jpg",
      id: EVENT_ID,
      kind: 30023,
      pubkey: PUBKEY,
    });
    expect(result.replies).toHaveLength(1);
    expect(result.resolution.identifierKind).toBe("naddr");
    expect(result.resolution.labels[0]).toBe("Resolved from naddr");
    expect(result.resolution.threadPartial).toBe(false);
    expect(cache.connectToPrimalCache).toHaveBeenCalledWith(
      "parametrized_replaceable_event",
      {
        extended_response: true,
        identifier: "my-article",
        kind: 30023,
        pubkey: PUBKEY,
      }
    );
    expect(cache.connectToPrimalCache).toHaveBeenCalledWith("thread_view", {
      event_id: EVENT_ID,
    });
  });

  it("skips the article thread lookup when the article has no event id", async () => {
    naddrPayload = [
      eventTuple({
        content: "Article",
        created_at: 4,
        kind: 30023,
        pubkey: PUBKEY,
        tags: [["d", "my-article"]],
      }),
    ];

    const result = await handleSearchEvent(NADDR);

    expect(result.event.id).toBe("");
    expect(result.event.kind).toBe(30023);
    expect(result.replies).toEqual([]);
    expect(cache.connectToPrimalCache).not.toHaveBeenCalledWith(
      "thread_view",
      expect.anything()
    );
  });

  it("reports kind 0 addressable events as kind 1", async () => {
    const address = nip19.naddrEncode({
      identifier: "profile",
      kind: 0,
      pubkey: PUBKEY,
    });
    naddrPayload = [
      eventTuple({
        content: "profile",
        created_at: 4,
        kind: 0,
        pubkey: PUBKEY,
        tags: [["d", "profile"]],
      }),
    ];

    const result = await handleSearchEvent(address);

    expect(result.event.kind).toBe(1);
    expect(result.event.created_at).toBe(4);
  });

  it("marks the article partial when its thread lookup throws", async () => {
    naddrPayload = [
      eventTuple({
        content: "Article",
        created_at: 4,
        id: EVENT_ID,
        kind: 30023,
        pubkey: PUBKEY,
        tags: [["d", "my-article"]],
      }),
    ];
    threadError = new Error("no thread");

    const result = await handleSearchEvent(NADDR);

    expect(result.event.id).toBe(EVENT_ID);
    expect(result.replies).toEqual([]);
    expect(result.resolution.threadPartial).toBe(true);
    expect(result.resolution.status).toBe("partial");
    expect(result.resolution.labels).toContain("Thread data may be incomplete");
  });

  it("throws when the addressable event is not in the cache response", async () => {
    naddrPayload = [
      eventTuple({
        content: "other",
        id: EVENT_ID,
        kind: 30023,
        pubkey: PUBKEY,
        tags: [["d", "someone-else"]],
      }),
    ];

    await expect(handleSearchEvent(NADDR)).rejects.toBeInstanceOf(
      NotFoundError
    );
    await expect(handleSearchEvent(NADDR)).rejects.toMatchObject({
      context: { input: "naddr" },
      message: "Event not found. Please check the ID or address and try again.",
    });
  });

  it("wraps an addressable cache Error", async () => {
    naddrError = new Error("naddr-down");

    await expect(handleSearchEvent(NADDR)).rejects.toBeInstanceOf(
      ExternalServiceError
    );
    await expect(handleSearchEvent(NADDR)).rejects.toMatchObject({
      context: {
        originalError: "naddr-down",
        service: "PrimalCache",
      },
      message: "Failed to fetch replaceable event from cache",
    });
  });

  it("wraps a non-Error addressable cache failure", async () => {
    naddrError = "naddr-string";

    await expect(handleSearchEvent(NADDR)).rejects.toMatchObject({
      context: { originalError: "naddr-string", service: "PrimalCache" },
      message: "Failed to fetch replaceable event from cache",
    });
  });
});
