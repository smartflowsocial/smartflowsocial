import { describe, expect, it } from "vitest";

import { mapLooseNostrEventsToSearchReplyItems } from "~/features/search/services/search-reply-items.server";
import type { LooseNostrEvent } from "~/features/search/services/search-thread-replies.server";

const PK = "abcdef12restofkey";

describe("mapLooseNostrEventsToSearchReplyItems", () => {
  it("maps author info and dedupes media urls", () => {
    const authors = new Map<string, { name: string; image: string | null }>([
      [PK, { image: "https://img.example/ada.png", name: "Ada" }],
    ]);
    const events: LooseNostrEvent[] = [
      {
        content: "hi https://cdn.example.com/a.jpg",
        created_at: 20,
        id: "reply-1",
        pubkey: PK,
        tags: [
          ["url", "https://cdn.example.com/a.jpg"],
          ["imeta", "dim", "https://cdn.example.com/b.mp4"],
        ],
      },
    ];

    expect(mapLooseNostrEventsToSearchReplyItems(events, authors)).toEqual([
      {
        authorImage: "https://img.example/ada.png",
        authorName: "Ada",
        content: "hi https://cdn.example.com/a.jpg",
        created_at: 20,
        id: "reply-1",
        mediaUrls: [
          "https://cdn.example.com/a.jpg",
          "https://cdn.example.com/b.mp4",
        ],
        pubkey: PK,
      },
    ]);
  });

  it("returns an empty list for no events", () => {
    expect(
      mapLooseNostrEventsToSearchReplyItems(
        [],
        new Map<string, { name: string; image: string | null }>()
      )
    ).toEqual([]);
  });

  it("fills defaults when the event and author map are incomplete", () => {
    const events: LooseNostrEvent[] = [
      {
        event_id: "from-event-id",
        pubkey: "zzzzzzzz",
      },
      {
        event_id: "from-empty-id",
        id: "",
        pubkey: "",
      },
      {
        pubkey: "only-pubkey",
      },
      {
        event_id: "secondary",
        id: "preferred",
        pubkey: PK,
      },
    ];

    expect(
      mapLooseNostrEventsToSearchReplyItems(
        events,
        new Map<string, { name: string; image: string | null }>()
      )
    ).toEqual([
      {
        authorImage: null,
        authorName: "zzzzzzzz...",
        content: "",
        created_at: 0,
        id: "from-event-id",
        pubkey: "zzzzzzzz",
      },
      {
        authorImage: null,
        authorName: "...",
        content: "",
        created_at: 0,
        id: "from-empty-id",
        pubkey: "",
      },
      {
        authorImage: null,
        authorName: "only-pub...",
        content: "",
        created_at: 0,
        id: "",
        pubkey: "only-pubkey",
      },
      {
        authorImage: null,
        authorName: `${PK.slice(0, 8)}...`,
        content: "",
        created_at: 0,
        id: "preferred",
        pubkey: PK,
      },
    ]);
  });

  it("omits mediaUrls when the note has no media", () => {
    const events: LooseNostrEvent[] = [
      {
        content: "plain text",
        created_at: 1,
        id: "plain",
        pubkey: PK,
        tags: [["t", "topic"]],
      },
    ];
    const authors = new Map<string, { name: string; image: string | null }>([
      [PK, { image: null, name: "Ada" }],
    ]);
    const [item] = mapLooseNostrEventsToSearchReplyItems(events, authors);

    expect(item).toEqual({
      authorImage: null,
      authorName: "Ada",
      content: "plain text",
      created_at: 1,
      id: "plain",
      pubkey: PK,
    });
    expect(item?.mediaUrls).toBeUndefined();
  });
});
