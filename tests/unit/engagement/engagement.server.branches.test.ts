import { beforeEach, describe, expect, it, vi } from "vitest";

interface Pointer {
  id?: string | number;
  identifier?: string;
  kind?: number;
  pubkey?: string | number;
}

interface Block {
  end: number;
  pointer?: Pointer;
  start: number;
  text?: string;
  type: string;
}

function raise(value: unknown): never {
  throw value;
}

function blocksFor(content: string): Block[] {
  if (content.includes("THROW_ERROR")) raise(new Error("nip27 blew up"));
  if (content.includes("THROW_STRING")) raise("nip27 blew up");
  const blocks: Block[] = [];
  if (content.includes("TEXT_BLOCK")) {
    blocks.push({ end: 2, start: 0, text: "hi", type: "text" });
  }
  if (content.includes("REF_BAD_ID")) {
    blocks.push({ end: 1, pointer: { id: 5 }, start: 0, type: "reference" });
  }
  if (content.includes("REF_BAD_PUB")) {
    blocks.push({
      end: 1,
      pointer: { pubkey: 5 },
      start: 0,
      type: "reference",
    });
  }
  if (content.includes("REF_ADDR")) {
    blocks.push({
      end: 1,
      pointer: { identifier: "slug", kind: 30023, pubkey: "addrpub" },
      start: 0,
      type: "reference",
    });
  }
  if (content.includes("REF_EMPTY_POINTER")) {
    blocks.push({ end: 1, pointer: {}, start: 0, type: "reference" });
  }
  for (const match of content.matchAll(/REF_ID:([A-Za-z0-9]+)/g)) {
    const id = match[1];
    if (!id) continue;
    blocks.push({ end: 1, pointer: { id }, start: 0, type: "reference" });
  }
  for (const match of content.matchAll(/REF_PUB:([A-Za-z0-9]+)/g)) {
    const pubkey = match[1];
    if (!pubkey) continue;
    blocks.push({ end: 1, pointer: { pubkey }, start: 0, type: "reference" });
  }
  return blocks;
}

const nip27 = vi.hoisted(() => ({
  parse: vi.fn((content: string | { content?: string }): Block[] => {
    const text = typeof content === "string" ? content : "";
    return blocksFor(text);
  }),
}));

const loader = vi.hoisted(() => ({
  loadEngagementFeedData: vi.fn(async () => ({ posts: [] as unknown[] })),
}));

vi.mock("nostr-tools/nip27", () => ({
  parse: nip27.parse,
}));
vi.mock("~/features/engagement/services/engagement-loader.server", () => ({
  loadEngagementFeedData: loader.loadEngagementFeedData,
}));
vi.mock("~/lib/error-logger.server", () => ({
  logError: vi.fn(),
}));

import {
  doesEventMentionUser,
  getEngagementData,
  inferThreadRootEventIdFromTags,
  isQuotePost,
  isReplyToUserPublishedEvent,
  isStructuredThreadReplyKind1,
  parseThreadViewNotifications,
  shouldExcludeKind1FromGlobalMentionInbox,
} from "~/features/engagement/engagement.server";

const USER = "UserPub";
const ROOT = "RootId";
const OTHER = "OtherPub";

interface NoteFields {
  content?: string;
  createdAt?: number;
  id?: string;
  kind?: number;
  omitContent?: boolean;
  omitCreatedAt?: boolean;
  omitId?: boolean;
  omitPubkey?: boolean;
  pubkey?: string;
  tags?: string[][];
}

function eventRow(fields: NoteFields = {}): unknown[] {
  const event: Record<string, unknown> = {
    kind: fields.kind ?? 1,
  };
  if (!fields.omitId) event["id"] = fields.id ?? "note-1";
  if (!fields.omitPubkey) event["pubkey"] = fields.pubkey ?? OTHER;
  if (!fields.omitContent) event["content"] = fields.content ?? "hello";
  if (!fields.omitCreatedAt) event["created_at"] = fields.createdAt ?? 10;
  if (fields.tags) event["tags"] = fields.tags;
  return ["EVENT", "sub", event];
}

function profileRow(pubkey: string, body: unknown): unknown[] {
  return ["EVENT", "sub", { content: JSON.stringify(body), kind: 0, pubkey }];
}

function statsRow(body: unknown): unknown[] {
  return ["EVENT", "sub", { content: JSON.stringify(body), kind: 10000100 }];
}

function zapBody(input: {
  amount?: string;
  content?: string;
  pubkey?: string;
}): string {
  const tags: string[][] = [];
  if (input.amount !== undefined) tags.push(["amount", input.amount]);
  const body: Record<string, unknown> = { tags };
  if (input.pubkey !== undefined) body["pubkey"] = input.pubkey;
  if (input.content !== undefined) body["content"] = input.content;
  return JSON.stringify(body);
}

function parsed(items: unknown[], original = ROOT, user = USER) {
  return parseThreadViewNotifications(items, original, user);
}

describe("quote and mention helpers", () => {
  beforeEach(() => {
    nip27.parse.mockClear();
  });

  it("classifies quotes from markers and nostr references", () => {
    const mention = ["e", "abc", "", "mention"];
    expect(isQuotePost({ content: "nostr:note1abc" }, undefined)).toBe(false);
    expect(
      isQuotePost({ content: "nostr:note1abc" }, ["e", "abc", "", "reply"])
    ).toBe(false);
    expect(
      isQuotePost({ content: "nostr:note1abc" }, ["e", "abc", "", "Mention"])
    ).toBe(false);
    expect(isQuotePost({}, mention)).toBe(false);
    expect(isQuotePost({ content: "" }, mention)).toBe(false);
    expect(isQuotePost({ content: "nostr:note1abc" }, mention)).toBe(true);
    expect(isQuotePost({ content: "see nostr:nevent1abc" }, mention)).toBe(
      true
    );
    expect(isQuotePost({ content: "see nostr:naddr1abc" }, mention)).toBe(true);
    expect(nip27.parse).not.toHaveBeenCalled();

    expect(isQuotePost({ content: "REF_ID:abc" }, mention)).toBe(true);
    expect(isQuotePost({ content: "REF_ID:nope REF_ID:abc" }, mention)).toBe(
      true
    );
    expect(isQuotePost({ content: "TEXT_BLOCK REF_ID:abc" }, mention)).toBe(
      true
    );
    expect(isQuotePost({ content: "REF_ID:zzz" }, mention)).toBe(false);
    expect(isQuotePost({ content: "TEXT_BLOCK" }, mention)).toBe(false);
    expect(isQuotePost({ content: "REF_BAD_ID" }, mention)).toBe(false);
    expect(isQuotePost({ content: "REF_ADDR" }, mention)).toBe(false);
    expect(isQuotePost({ content: "REF_EMPTY_POINTER" }, mention)).toBe(false);
    expect(isQuotePost({ content: "hello" }, ["e", "", "", "mention"])).toBe(
      false
    );
    expect(isQuotePost({ content: "THROW_ERROR" }, mention)).toBe(false);
    expect(isQuotePost({ content: "THROW_STRING" }, mention)).toBe(false);
  });

  it("matches p tags and nip-27 pubkeys", () => {
    nip27.parse.mockClear();
    expect(doesEventMentionUser("THROW_ERROR", [["p", "USERPUB"]], USER)).toBe(
      true
    );
    expect(nip27.parse).not.toHaveBeenCalled();

    expect(doesEventMentionUser(undefined, undefined, USER)).toBe(false);
    expect(doesEventMentionUser("", [["p"]], USER)).toBe(false);
    expect(doesEventMentionUser("hi", [["p", "someone"]], USER)).toBe(false);
    expect(doesEventMentionUser("REF_PUB:userpub", [["e", "x"]], USER)).toBe(
      true
    );
    expect(doesEventMentionUser("REF_PUB:addrpub", undefined, "ADDRPUB")).toBe(
      true
    );
    expect(doesEventMentionUser("REF_PUB:addrpub", undefined, OTHER)).toBe(
      false
    );
    expect(doesEventMentionUser("REF_ADDR", undefined, "ADDRPUB")).toBe(true);
    expect(doesEventMentionUser("REF_BAD_PUB", undefined, USER)).toBe(false);
    expect(doesEventMentionUser("TEXT_BLOCK", undefined, USER)).toBe(false);
    expect(doesEventMentionUser("REF_EMPTY_POINTER", undefined, USER)).toBe(
      false
    );
    expect(doesEventMentionUser("THROW_ERROR", undefined, USER)).toBe(false);
    expect(doesEventMentionUser("THROW_STRING", [["p", "nope"]], USER)).toBe(
      false
    );
  });
});

describe("thread root and mention inbox helpers", () => {
  it("drops structured replies and legacy replies to published notes", () => {
    const published = new Set(["abc"]);
    expect(isStructuredThreadReplyKind1(undefined)).toBe(false);
    expect(isStructuredThreadReplyKind1([])).toBe(false);
    expect(isStructuredThreadReplyKind1([["p", USER]])).toBe(false);
    expect(isStructuredThreadReplyKind1([["e", "id"]])).toBe(false);
    expect(isStructuredThreadReplyKind1([["e", "id", "", ""]])).toBe(false);
    expect(isStructuredThreadReplyKind1([["e", "id", "", " mention"]])).toBe(
      false
    );
    expect(isStructuredThreadReplyKind1([["e", "id", "", "mention"]])).toBe(
      false
    );
    expect(
      isStructuredThreadReplyKind1([
        ["e", "id", "", "mention"],
        ["e", "id2", "", "reply"],
      ])
    ).toBe(false);
    expect(isStructuredThreadReplyKind1([["e", "id", "", "reply"]])).toBe(true);
    expect(isStructuredThreadReplyKind1([["e", "id", "", "REPLY"]])).toBe(true);
    expect(isStructuredThreadReplyKind1([["e", "id", "", "root"]])).toBe(true);
    expect(isStructuredThreadReplyKind1([["e", "id", "", "ROOT"]])).toBe(true);

    expect(
      isReplyToUserPublishedEvent([["e", "abc", "", "reply"]], new Set())
    ).toBe(false);
    expect(isReplyToUserPublishedEvent(undefined, published)).toBe(false);
    expect(isReplyToUserPublishedEvent([["p", USER]], published)).toBe(false);
    expect(isReplyToUserPublishedEvent([["e"]], published)).toBe(false);
    expect(
      isReplyToUserPublishedEvent([["e", "zzz", "", "reply"]], published)
    ).toBe(false);
    expect(
      isReplyToUserPublishedEvent([["e", "abc", "", "mention"]], published)
    ).toBe(false);
    expect(
      isReplyToUserPublishedEvent([["e", "ABC", "", "Mention"]], published)
    ).toBe(false);
    expect(
      isReplyToUserPublishedEvent([["e", "AbC", "", "reply"]], published)
    ).toBe(true);
    expect(
      isReplyToUserPublishedEvent([["e", "abc", "", "root"]], published)
    ).toBe(true);
    expect(isReplyToUserPublishedEvent([["e", "abc"]], published)).toBe(true);
    expect(
      isReplyToUserPublishedEvent(
        [
          ["e", "abc", "", "mention"],
          ["e", "abc", "", ""],
        ],
        published
      )
    ).toBe(true);

    expect(
      shouldExcludeKind1FromGlobalMentionInbox(
        [["e", "id", "", "reply"]],
        new Set()
      )
    ).toBe(true);
    expect(
      shouldExcludeKind1FromGlobalMentionInbox([["e", "abc"]], published)
    ).toBe(true);
    expect(
      shouldExcludeKind1FromGlobalMentionInbox(
        [
          ["e", "other", "", "mention"],
          ["e", "abc", "", ""],
        ],
        published
      )
    ).toBe(true);
    expect(
      shouldExcludeKind1FromGlobalMentionInbox(
        [["e", "abc", "", "mention"]],
        published
      )
    ).toBe(false);
    expect(
      shouldExcludeKind1FromGlobalMentionInbox([["p", USER]], published)
    ).toBe(false);
  });

  it("infers a thread root from nip-10 tags", () => {
    expect(inferThreadRootEventIdFromTags(undefined, "note")).toBe("note");
    expect(inferThreadRootEventIdFromTags([], "note")).toBe("note");
    expect(
      inferThreadRootEventIdFromTags(
        [
          ["e", "child", "", "reply"],
          ["e", "root", "", "root"],
        ],
        "note"
      )
    ).toBe("root");
    expect(
      inferThreadRootEventIdFromTags([["e", "", "", "root"]], "note")
    ).toBe("note");
    expect(
      inferThreadRootEventIdFromTags([["e", "kept", "", "Root"]], "note")
    ).toBe("kept");
    expect(
      inferThreadRootEventIdFromTags(
        [
          ["e", "child", "", "reply"],
          ["e", "root", "", "mention"],
        ],
        "note"
      )
    ).toBe("root");
    expect(
      inferThreadRootEventIdFromTags(
        [
          ["e", "same", "", "reply"],
          ["e", "", ""],
          ["e", "other", "", "mention"],
        ],
        "note"
      )
    ).toBe("other");
    expect(
      inferThreadRootEventIdFromTags(
        [
          ["e", "same", "", "reply"],
          ["e", "same", "", "mention"],
        ],
        "note"
      )
    ).toBe("same");
    expect(
      inferThreadRootEventIdFromTags([["e", "only", "", "reply"]], "note")
    ).toBe("only");
    expect(
      inferThreadRootEventIdFromTags(
        [
          ["e", "first"],
          ["e", "second"],
        ],
        "note"
      )
    ).toBe("second");
    expect(
      inferThreadRootEventIdFromTags(
        [
          ["e", "first"],
          ["e", "second", "", "mention"],
        ],
        "note"
      )
    ).toBe("first");
    expect(
      inferThreadRootEventIdFromTags(
        [
          ["e", "first"],
          ["e", "", "", ""],
        ],
        "note"
      )
    ).toBe("first");
    expect(
      inferThreadRootEventIdFromTags(
        [
          ["e", "", "", "x"],
          ["e", "later", "", "reply"],
        ],
        "note"
      )
    ).toBe("later");
    expect(
      inferThreadRootEventIdFromTags([["e", "", "", "reply"]], "note")
    ).toBe("note");
    expect(
      inferThreadRootEventIdFromTags(
        [
          ["e", "", "", "root"],
          ["e", "second"],
        ],
        "note"
      )
    ).toBe("note");
  });
});

describe("parseThreadViewNotifications", () => {
  it("builds a reply with profile, stats, and name fallback", () => {
    const rich = parsed([
      profileRow(OTHER, {
        display_name: "Ada",
        name: "ada",
        nip05: "ada@example.com",
        picture: "https://cdn.example/a.png",
      }),
      statsRow({
        event_id: "reply-1",
        likes: 2,
        mentions: 4,
        replies: 3,
        reposts: 5,
        satszapped: 7,
        zaps: 6,
      }),
      eventRow({
        content: "hi",
        createdAt: 10,
        id: "reply-1",
        tags: [["e", ROOT, "", "reply"]],
      }),
    ]);
    expect(rich).toEqual([
      {
        authorName: "Ada",
        authorNip05: "ada@example.com",
        authorPicture: "https://cdn.example/a.png",
        content: "hi",
        createdAt: 10,
        eventId: "reply-1",
        id: "reply-1",
        originalEventId: ROOT,
        pubkey: OTHER,
        stats: {
          likes: 2,
          mentions: 4,
          replies: 3,
          reposts: 5,
          satszapped: 7,
          zaps: 6,
        },
        type: "reply",
      },
    ]);

    const named = parsed([
      profileRow(OTHER, { name: "ada", picture: null }),
      eventRow({
        createdAt: 0,
        id: "reply-0",
        tags: [["e", ROOT, "", "root"]],
      }),
    ]);
    expect(named).toEqual([
      {
        authorName: "ada",
        authorNip05: undefined,
        authorPicture: null,
        content: "hello",
        createdAt: 0,
        eventId: "reply-0",
        id: "reply-0",
        originalEventId: ROOT,
        pubkey: OTHER,
        stats: undefined,
        type: "reply",
      },
    ]);
  });

  it("splits quotes from replies using the mention marker", () => {
    const notes = parsed([
      eventRow({
        content: "nostr:note1abc",
        createdAt: 4,
        id: "quote-note",
        tags: [["e", ROOT, "", "mention"]],
      }),
      eventRow({
        content: "nostr:nevent1abc",
        createdAt: 3,
        id: "quote-nevent",
        tags: [["e", ROOT, "", "mention"]],
      }),
      eventRow({
        content: "nostr:naddr1abc",
        createdAt: 2,
        id: "quote-naddr",
        tags: [["e", ROOT, "", "mention"]],
      }),
      eventRow({
        content: `REF_ID:${ROOT}`,
        createdAt: 1,
        id: "quote-embed",
        tags: [["e", ROOT, "", "mention"]],
      }),
      eventRow({
        content: "REF_ID:other",
        createdAt: 6,
        id: "not-embed",
        tags: [["e", ROOT, "", "mention"]],
      }),
      eventRow({
        content: "nostr:note1abc",
        createdAt: 7,
        id: "bad-marker",
        tags: [["e", ROOT, "", "Mention"]],
      }),
      eventRow({
        content: "plain",
        createdAt: 8,
        id: "empty-marker",
        tags: [
          ["e", "else", ""],
          ["e", ROOT],
        ],
      }),
    ]);
    expect(notes.map((note) => [note.id, note.type])).toEqual([
      ["empty-marker", "reply"],
      ["bad-marker", "reply"],
      ["not-embed", "reply"],
      ["quote-note", "mention"],
      ["quote-nevent", "mention"],
      ["quote-naddr", "mention"],
      ["quote-embed", "mention"],
    ]);
  });

  it("walks parent chains, cycles, and reply-before-root markers", () => {
    const chained = parsed([
      eventRow({
        createdAt: 2,
        id: "mid",
        tags: [["e", ROOT, "", "reply"]],
      }),
      eventRow({
        createdAt: 3,
        id: "child",
        pubkey: "ThirdPub",
        tags: [["e", "mid", "", "reply"]],
      }),
      eventRow({
        content: "nostr:note1abc",
        createdAt: 4,
        id: "quoted-child",
        pubkey: "FourthPub",
        tags: [["e", "mid", "", "mention"]],
      }),
    ]);
    expect(chained.map((note) => [note.id, note.type])).toEqual([
      ["quoted-child", "mention"],
      ["child", "reply"],
      ["mid", "reply"],
    ]);

    const missingParent = parsed([
      eventRow({
        id: "mid",
        tags: [["e", ROOT, "", "reply"]],
      }),
      eventRow({
        id: "orphan",
        pubkey: "ThirdPub",
        tags: [
          ["e", "missing", "", "reply"],
          ["e", "mid", "", "root"],
        ],
      }),
    ]);
    expect(missingParent.map((note) => note.id)).toEqual(["mid"]);

    const rootFallback = parsed([
      eventRow({
        id: "mid",
        tags: [["e", ROOT, "", "reply"]],
      }),
      eventRow({
        id: "child",
        pubkey: "ThirdPub",
        tags: [
          ["e", "", "", "reply"],
          ["e", "mid", "", "root"],
        ],
      }),
    ]);
    expect(rootFallback.map((note) => note.id).sort()).toEqual([
      "child",
      "mid",
    ]);

    expect(
      parsed([
        eventRow({
          id: "a",
          tags: [["e", "b", "", "reply"]],
        }),
        eventRow({
          id: "b",
          pubkey: "ThirdPub",
          tags: [["e", "a", "", "reply"]],
        }),
      ])
    ).toEqual([]);
  });

  it("keeps body mentions that are not thread replies", () => {
    const mentions = parsed([
      eventRow({
        content: "hi",
        createdAt: 2,
        id: "p-mention",
        tags: [["p", "userpub"]],
      }),
      eventRow({
        content: "REF_PUB:userpub",
        createdAt: 3,
        id: "body-mention",
        pubkey: "ThirdPub",
        tags: [],
      }),
      eventRow({
        content: "REF_PUB:userpub",
        createdAt: 4,
        id: "self",
        pubkey: "userpub",
        tags: [],
      }),
      eventRow({
        content: "REF_PUB:userpub",
        createdAt: 5,
        id: "also-reply",
        pubkey: "FourthPub",
        tags: [["e", ROOT, "", "reply"]],
      }),
    ]);
    expect(mentions.map((note) => [note.id, note.type])).toEqual([
      ["also-reply", "reply"],
      ["body-mention", "mention"],
      ["p-mention", "mention"],
    ]);
    const body = mentions.find((note) => note.id === "body-mention");
    expect(body?.originalEventId).toBe(ROOT);
  });

  it("ignores junk rows, self events, and incomplete notes", () => {
    const notes = parsed([
      "nope",
      ["EOSE", "sub"],
      ["EVENT", "sub"],
      ["EVENT", "sub", null],
      eventRow({
        id: "wrong-kind",
        kind: 7,
        tags: [["e", ROOT, "", "reply"]],
      }),
      eventRow({
        omitId: true,
        tags: [["e", ROOT, "", "reply"]],
      }),
      eventRow({
        id: "no-key",
        omitPubkey: true,
        tags: [["e", ROOT, "", "reply"]],
      }),
      eventRow({
        id: "blank-key",
        pubkey: "",
        tags: [["e", ROOT, "", "reply"]],
      }),
      eventRow({
        id: "self",
        pubkey: "userpub",
        tags: [["e", ROOT, "", "reply"]],
      }),
      eventRow({
        id: "rootid",
        pubkey: "ThirdPub",
        tags: [["e", "else", "", "reply"]],
      }),
      eventRow({
        id: "no-time",
        omitCreatedAt: true,
        tags: [["e", ROOT, "", "reply"]],
      }),
      eventRow({
        content: undefined,
        id: "kept",
        omitContent: true,
        tags: [["e", "rootid", "", "reply"]],
      }),
    ]);
    expect(notes).toEqual([
      {
        authorName: undefined,
        authorNip05: undefined,
        authorPicture: undefined,
        content: "",
        createdAt: 10,
        eventId: "kept",
        id: "kept",
        originalEventId: ROOT,
        pubkey: OTHER,
        stats: undefined,
        type: "reply",
      },
    ]);
  });

  it("ignores bad profile and stats payloads", () => {
    const notes = parsed([
      ["EVENT", "sub", { content: "{", kind: 0, pubkey: OTHER }],
      ["EVENT", "sub", { content: "{}", kind: 0 }],
      ["EVENT", "sub", { kind: 0, pubkey: OTHER }],
      statsRow({ likes: 9 }),
      statsRow({ event_id: "Reply-1", likes: 9 }),
      ["EVENT", "sub", { content: "{", kind: 10000100 }],
      statsRow({ event_id: "reply-1", reposts: 3 }),
      eventRow({
        id: "reply-1",
        tags: [["e", ROOT, "", "reply"]],
      }),
    ]);
    expect(notes[0]?.stats).toEqual({
      likes: 0,
      mentions: 0,
      replies: 0,
      reposts: 3,
      satszapped: 0,
      zaps: 0,
    });
    expect(notes[0]?.authorName).toBeUndefined();
  });

  it("builds zap notifications and ignores malformed zap rows", () => {
    const profile = profileRow("Sender", { name: "Zap Ada" });
    const stats = statsRow({
      event_id: "zap-1",
      likes: 1,
      satszapped: 9,
    });
    const rich = parsed([
      profile,
      stats,
      [
        "EVENT",
        "sub",
        {
          content: "thanks",
          created_at: 40,
          id: "zap-1",
          kind: 9735,
          pubkey: "ZapPub",
          tags: [
            ["e", "rootid"],
            [
              "description",
              zapBody({
                amount: "2500",
                content: "from request",
                pubkey: "Sender",
              }),
            ],
          ],
        },
      ],
    ]);
    expect(rich).toEqual([
      {
        amountSats: 2,
        authorName: "Zap Ada",
        authorNip05: undefined,
        authorPicture: undefined,
        content: "thanks",
        createdAt: 40,
        eventId: "zap-1",
        id: "zap-1",
        originalEventId: ROOT,
        pubkey: "Sender",
        receiverPubkey: USER,
        senderName: "Zap Ada",
        senderNip05: undefined,
        senderPicture: undefined,
        senderPubkey: "Sender",
        stats: {
          likes: 1,
          mentions: 0,
          replies: 0,
          reposts: 0,
          satszapped: 9,
          zaps: 0,
        },
        type: "zap",
      },
    ]);

    const fallback = parsed([
      profileRow("ZapPub", { display_name: "Relay" }),
      [
        "EVENT",
        "sub",
        {
          content: "",
          created_at: 0,
          id: "zap-fallback",
          kind: 9735,
          pubkey: "ZapPub",
          tags: [
            ["description", zapBody({ content: "hidden" })],
            ["e", ROOT],
          ],
        },
      ],
    ]);
    expect(fallback[0]).toMatchObject({
      amountSats: 0,
      authorName: "Relay",
      content: "",
      createdAt: 0,
      senderPubkey: "ZapPub",
    });

    const anonymous = parsed([
      [
        "EVENT",
        "sub",
        {
          created_at: 4,
          id: "zap-anon",
          kind: 9735,
          tags: [
            ["description", zapBody({})],
            ["e", ROOT],
          ],
        },
      ],
    ]);
    expect(anonymous[0]).toMatchObject({
      content: "",
      senderPubkey: "",
      senderName: undefined,
    });

    const nanAmount = parsed([
      [
        "EVENT",
        "sub",
        {
          created_at: 4,
          id: "zap-nan",
          kind: 9735,
          pubkey: "ZapPub",
          tags: [
            ["description", zapBody({ amount: "nope" })],
            ["e", ROOT],
          ],
        },
      ],
    ]);
    const zap = nanAmount[0];
    if (zap?.type !== "zap") throw new Error("expected zap");
    expect(zap.amountSats).toBeNaN();

    expect(
      parsed([["EVENT", "sub", { content: "{", kind: 10000100 }]])
    ).toEqual([]);
    expect(
      parsed([
        [
          "EVENT",
          "sub",
          {
            created_at: 4,
            id: "zap-other",
            kind: 9735,
            tags: [
              ["description", zapBody({})],
              ["e", "someone-else"],
            ],
          },
        ],
      ])
    ).toEqual([]);
    expect(
      parsed([
        [
          "EVENT",
          "sub",
          {
            created_at: 4,
            id: "zap-bad-json",
            kind: 9735,
            tags: [
              ["description", "{"],
              ["e", ROOT],
            ],
          },
        ],
      ])
    ).toEqual([]);
    expect(
      parsed([
        [
          "EVENT",
          "sub",
          {
            created_at: 4,
            id: "zap-num",
            kind: 9735,
            tags: [
              ["description", 12],
              ["e", ROOT],
            ],
          },
        ],
      ])
    ).toEqual([]);
    expect(
      parsed([
        [
          "EVENT",
          "sub",
          {
            created_at: 4,
            id: "zap-empty",
            kind: 9735,
            tags: [
              ["description", ""],
              ["e", ROOT],
            ],
          },
        ],
      ])
    ).toEqual([]);
    expect(
      parsed([
        [
          "EVENT",
          "sub",
          {
            created_at: 4,
            id: "zap-missing-desc",
            kind: 9735,
            tags: [["e", ROOT]],
          },
        ],
      ])
    ).toEqual([]);
    expect(
      parsed([
        [
          "EVENT",
          "sub",
          {
            created_at: 4,
            kind: 9735,
            tags: [
              ["description", zapBody({})],
              ["e", ROOT],
            ],
          },
        ],
      ])
    ).toEqual([]);
    expect(
      parsed([
        [
          "EVENT",
          "sub",
          {
            id: "zap-no-time",
            kind: 9735,
            tags: [
              ["description", zapBody({})],
              ["e", ROOT],
            ],
          },
        ],
      ])
    ).toEqual([]);
    expect(
      parsed([
        [
          "EVENT",
          "sub",
          {
            created_at: 4,
            id: "zap-no-tags",
            kind: 9735,
          },
        ],
      ])
    ).toEqual([]);
  });

  it("sorts replies, mentions, and zaps newest first", () => {
    const notes = parsed([
      eventRow({
        createdAt: 1,
        id: "reply",
        tags: [["e", ROOT, "", "reply"]],
      }),
      eventRow({
        createdAt: 5,
        id: "mention",
        pubkey: "ThirdPub",
        tags: [["p", USER]],
      }),
      [
        "EVENT",
        "sub",
        {
          created_at: 3,
          id: "zap",
          kind: 9735,
          pubkey: "ZapPub",
          tags: [
            ["description", zapBody({ amount: "1000" })],
            ["e", ROOT],
          ],
        },
      ],
    ]);
    expect(notes.map((note) => note.id)).toEqual(["mention", "zap", "reply"]);
  });
});

describe("getEngagementData", () => {
  beforeEach(() => {
    loader.loadEngagementFeedData.mockReset();
    loader.loadEngagementFeedData.mockResolvedValue({ posts: [] });
  });

  it("forwards to the engagement feed loader", async () => {
    await expect(getEngagementData("user-1")).resolves.toEqual({ posts: [] });
    await expect(getEngagementData("user-1", 2, 5)).resolves.toEqual({
      posts: [],
    });
    expect(loader.loadEngagementFeedData).toHaveBeenNthCalledWith(1, "user-1");
    expect(loader.loadEngagementFeedData).toHaveBeenNthCalledWith(
      2,
      "user-1",
      2,
      5
    );
  });
});
