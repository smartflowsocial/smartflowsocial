import { beforeEach, describe, expect, it, vi } from "vitest";

const users = vi.hoisted(() => ({
  getUserById: vi.fn(),
}));

const giveaway = vi.hoisted(() => ({
  fetchGiveawayParticipants: vi.fn(),
}));

const giveawayLoader = vi.hoisted(() => ({
  processGiveawayParticipants: vi.fn(),
}));

vi.mock("~/features/user", () => users);
vi.mock("~/features/giveaway/giveaway.server", () => giveaway);
vi.mock("~/features/giveaway/giveaway-loader.server", () => giveawayLoader);

import { asReturn } from "./contest-test-doubles";

import { resolveContestEntries } from "~/features/contest/contest-resolver.server";
import { processGiveawayParticipants } from "~/features/giveaway/giveaway-loader.server";
import { fetchGiveawayParticipants } from "~/features/giveaway/giveaway.server";
import type { RelatedEvent } from "~/features/giveaway/types";
import { getUserById } from "~/features/user";

const SOURCE = "source-note";
const AUTHOR = "a".repeat(64);
const OTHER = "b".repeat(64);

function reply(id: string, createdAt: number, content?: string): RelatedEvent {
  return {
    id,
    pubkey: AUTHOR,
    created_at: createdAt,
    kind: 1,
    content,
    tags: [["e", SOURCE]],
  };
}

function tagged(input: {
  id: string;
  pubkey: string;
  kind: number;
  tags?: string[][] | string;
  createdAt?: number;
}): RelatedEvent {
  return {
    id: input.id,
    pubkey: input.pubkey,
    created_at: input.createdAt ?? 100,
    kind: input.kind,
    tags: input.tags as RelatedEvent["tags"],
  };
}

describe("resolveContestEntries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(processGiveawayParticipants).mockImplementation(
      async (replies) => replies
    );
  });

  it("returns no entries when the user does not exist", async () => {
    vi.mocked(getUserById).mockResolvedValueOnce(null);
    await expect(
      resolveContestEntries({
        userId: "missing",
        sourceNoteId: SOURCE,
        metric: "ZAPS",
        deadlineUnix: 200,
      })
    ).resolves.toEqual([]);
    expect(fetchGiveawayParticipants).not.toHaveBeenCalled();
  });

  it("scores each metric and ignores self, untagged, and invalid zap amounts", async () => {
    const entry = reply("evt-1", 50, "hello reply");
    const events: RelatedEvent[] = [
      entry,
      tagged({ id: "late", pubkey: OTHER, kind: 1, createdAt: 500 }),
      tagged({
        id: "other-note",
        pubkey: OTHER,
        kind: 1,
        tags: [["e", "nope"]],
      }),
      tagged({
        id: "self-zap",
        pubkey: AUTHOR,
        kind: 9735,
        tags: [
          ["e", "evt-1"],
          ["amount", "5000"],
        ],
      }),
      tagged({ id: "untagged", pubkey: OTHER, kind: 7 }),
      tagged({ id: "bad-tags", pubkey: OTHER, kind: 7, tags: "nope" }),
      tagged({ id: "reply", pubkey: OTHER, kind: 1, tags: [["e", "evt-1"]] }),
      tagged({ id: "repost", pubkey: OTHER, kind: 6, tags: [["e", "evt-1"]] }),
      tagged({ id: "like", pubkey: OTHER, kind: 7, tags: [["e", "evt-1"]] }),
      tagged({
        id: "zap-good",
        pubkey: OTHER,
        kind: 9735,
        tags: [
          ["e", "evt-1"],
          ["amount", "2500"],
        ],
      }),
      tagged({
        id: "zap-zero",
        pubkey: OTHER,
        kind: 9735,
        tags: [
          ["e", "evt-1"],
          ["amount", "0"],
        ],
      }),
      tagged({
        id: "zap-bad",
        pubkey: OTHER,
        kind: 9735,
        tags: [
          ["e", "evt-1"],
          ["amount", "nope"],
        ],
      }),
      tagged({
        id: "zap-neg",
        pubkey: OTHER,
        kind: 9735,
        tags: [
          ["e", "evt-1"],
          ["amount", "-5"],
        ],
      }),
      tagged({
        id: "zap-none",
        pubkey: OTHER,
        kind: 9735,
        tags: [["e", "evt-1"]],
      }),
    ];
    vi.mocked(getUserById).mockResolvedValue(asReturn({ id: "user-1" }));
    vi.mocked(fetchGiveawayParticipants).mockResolvedValue({
      relatedEvents: events,
      count: events.length,
      stats: { likes: 0, reposts: 0, zaps: 0, satszapped: 0, total: 0 },
    });

    const base = {
      userId: "user-1",
      sourceNoteId: SOURCE,
      deadlineUnix: 100,
    };
    const zaps = await resolveContestEntries({ ...base, metric: "ZAPS" });
    const sats = await resolveContestEntries({
      ...base,
      metric: "SATS_ZAPPED",
    });
    const reactions = await resolveContestEntries({
      ...base,
      metric: "REACTIONS",
    });
    const replies = await resolveContestEntries({ ...base, metric: "REPLIES" });
    const reposts = await resolveContestEntries({ ...base, metric: "REPOSTS" });

    expect(zaps[0]).toMatchObject({
      entryEventId: "evt-1",
      score: 5,
      zapCount: 5,
      satsZapped: 2,
      reactionsCount: 1,
      repliesCount: 1,
      repostsCount: 1,
      replySnippet: "hello reply",
    });
    expect(sats[0]?.score).toBe(2);
    expect(reactions[0]?.score).toBe(1);
    expect(replies[0]?.score).toBe(1);
    expect(reposts[0]?.score).toBe(1);
    expect(processGiveawayParticipants).toHaveBeenCalledWith(
      [entry],
      "user-1",
      expect.objectContaining({ mutedList: { npubs: [] } }),
      undefined
    );
  });

  it("sorts by score, then earlier timestamp, then event id", async () => {
    const events = [
      reply("evt-b", 20),
      reply("evt-a", 20),
      reply("evt-high", 90, "later but higher"),
    ];
    events[2] = {
      ...reply("evt-high", 90),
      pubkey: OTHER,
      tags: [
        ["e", SOURCE],
        ["e", "evt-high"],
      ],
    };
    const boost: RelatedEvent = tagged({
      id: "boost",
      pubkey: AUTHOR,
      kind: 7,
      tags: [["e", "evt-high"]],
    });
    vi.mocked(getUserById).mockResolvedValue(asReturn({ id: "user-1" }));
    vi.mocked(fetchGiveawayParticipants).mockResolvedValue({
      relatedEvents: [...events, boost],
      count: 4,
      stats: { likes: 1, reposts: 0, zaps: 0, satszapped: 0, total: 1 },
    });

    const rows = await resolveContestEntries({
      userId: "user-1",
      sourceNoteId: SOURCE,
      metric: "REACTIONS",
      deadlineUnix: 100,
    });

    expect(rows.map((row) => row.entryEventId)).toEqual([
      "evt-high",
      "evt-a",
      "evt-b",
    ]);
    expect(rows[1]?.replySnippet).toBeUndefined();
  });

  it("passes filters and normalizes each muted-list shape", async () => {
    vi.mocked(fetchGiveawayParticipants).mockResolvedValue({
      relatedEvents: [],
      count: 0,
      stats: { likes: 0, reposts: 0, zaps: 0, satszapped: 0, total: 0 },
    });
    const cases: unknown[] = [
      null,
      ["npub1"],
      { other: true },
      { npubs: "nope" },
      { npubs: ["npub1muted"] },
    ];
    const expected = [
      { npubs: [] },
      { npubs: [] },
      { npubs: [] },
      { npubs: [] },
      { npubs: ["npub1muted"] },
    ];

    for (const [index, mutedList] of cases.entries()) {
      vi.mocked(getUserById).mockResolvedValueOnce(
        asReturn({ id: "user-1", mutedList })
      );
      await resolveContestEntries({
        userId: "user-1",
        sourceNoteId: SOURCE,
        metric: "ZAPS",
        deadlineUnix: 10,
        filters: index === 4 ? { excludeMuted: true } : undefined,
      });
      expect(processGiveawayParticipants).toHaveBeenLastCalledWith(
        [],
        "user-1",
        expect.objectContaining({ mutedList: expected[index] }),
        index === 4 ? { filters: { excludeMuted: true } } : undefined
      );
    }
  });
});
