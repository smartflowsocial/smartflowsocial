import { beforeEach, describe, expect, it, vi } from "vitest";

const connectToPrimalCache = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const processQuoteReposts = vi.hoisted(() =>
  vi.fn<(events: unknown, connector: unknown) => Promise<Notification[]>>()
);
const groupNotificationsByParent = vi.hoisted(() =>
  vi.fn<
    (
      notifications: Notification[],
      posts: unknown,
      longform: unknown,
      stats: unknown
    ) => GroupedNotification[]
  >()
);
const calculateTrustScore = vi.hoisted(() => vi.fn<(user: User) => number>());
const filterMutedNotifications = vi.hoisted(() =>
  vi.fn<(notifications: Notification[], muted: string[]) => Notification[]>()
);
const filterLowTrustNotifications = vi.hoisted(() =>
  vi.fn<
    (
      notifications: Notification[],
      scores: Map<string, number>
    ) => Notification[]
  >()
);
const fetchUserProfile = vi.hoisted(() =>
  vi.fn<(pubkey: string) => Promise<User | null>>()
);

vi.mock("~/features/cache/primalCache.server", () => ({
  connectToPrimalCache,
}));
vi.mock("~/features/engagement/engagement.server", () => ({
  groupNotificationsByParent,
  processQuoteReposts,
}));
vi.mock(
  "~/features/engagement/services/engagement-loader-filters.server",
  () => ({
    filterLowTrustNotifications,
    filterMutedNotifications,
  })
);
vi.mock(
  "~/features/engagement/services/engagement-loader-profile.server",
  () => ({
    fetchUserProfile,
  })
);
vi.mock("~/features/engagement/trust-score", () => ({
  calculateTrustScore,
}));

import {
  computeGroupSummaries,
  enrichGlobalMentionNotificationsWithProfiles,
  enrichGroupedParentAuthorPictures,
  filterGroupedExcludingUser,
  mergeGroupedNotificationsByParent,
  processAndGroupQuoteReposts,
  serializeGroupedForResponse,
} from "~/features/engagement/services/engagement-loader-notifications.server";
import type { User } from "~/features/engagement/trust-score";
import type {
  EngagementLinkedAction,
  EventStats,
  GroupedNotification,
  Notification,
  NotificationMention,
  NotificationQuoteRepost,
  NotificationReply,
  NotificationZap,
} from "~/features/engagement/types";
import type { PostData } from "~/features/posts/types";

function profile(pubkey: string, extra?: Partial<User>): User {
  return {
    pubkey,
    followsCount: 1,
    followersCount: 2,
    noteCount: 3,
    replyCount: 4,
    timeJoined: 5,
    zapCount: 6,
    totalSatsZapped: 7,
    mediaCount: 8,
    ...extra,
  };
}

function reply(
  eventId: string,
  pubkey: string,
  createdAt = 1
): NotificationReply {
  return {
    id: eventId,
    eventId,
    content: "reply",
    createdAt,
    originalEventId: "parent",
    type: "reply",
    pubkey,
  };
}

function mention(eventId: string, pubkey: string): NotificationMention {
  return {
    id: eventId,
    eventId,
    content: "mention",
    createdAt: 1,
    originalEventId: "parent",
    type: "mention",
    pubkey,
    authorName: "fallback-name",
    authorPicture: "fallback-pic",
    authorNip05: "fallback@nostr",
  };
}

function zap(
  eventId: string,
  senderPubkey: string,
  pubkey: string
): NotificationZap {
  return {
    id: eventId,
    eventId,
    content: "zap",
    createdAt: 1,
    originalEventId: "parent",
    type: "zap",
    senderPubkey,
    receiverPubkey: "receiver",
    amountSats: 21,
    pubkey,
  };
}

function quote(eventId: string, pubkey: string): NotificationQuoteRepost {
  return {
    id: eventId,
    eventId,
    content: "quote",
    createdAt: 1,
    originalEventId: "parent",
    type: "quote",
    pubkey,
  };
}

function group(
  eventId: string,
  notifications: Notification[],
  extra?: Partial<GroupedNotification["parentPost"]>
): GroupedNotification {
  return {
    parentPost: {
      id: `post-${eventId}`,
      eventId,
      pubkey: "parent-pk",
      caption: `caption-${eventId}`,
      publishedAt: null,
      isLongform: false,
      ...extra,
    },
    notifications,
  };
}

describe("mergeGroupedNotificationsByParent", () => {
  it("keeps the first parent, dedupes children, and sorts groups by latest activity", () => {
    const older = group("parent-a", [reply("a1", "p", 10)], {
      caption: "first",
    });
    const newer = group("parent-b", []);
    const overlap = group(
      "parent-a",
      [reply("a1", "p", 10), reply("a2", "p", 30), reply("a3", "p", 20)],
      {
        caption: "second",
      }
    );
    const fresh = group("parent-b", [reply("b1", "p", 5)]);

    const merged = mergeGroupedNotificationsByParent(
      [older, newer],
      [overlap, fresh]
    );

    expect(merged.map((item) => item.parentPost.eventId)).toEqual([
      "parent-a",
      "parent-b",
    ]);
    expect(merged[0]?.parentPost.caption).toBe("first");
    expect(merged[0]?.notifications.map((item) => item.eventId)).toEqual([
      "a2",
      "a3",
      "a1",
    ]);
    expect(merged[1]?.notifications.map((item) => item.eventId)).toEqual([
      "b1",
    ]);
    expect(older.notifications).toHaveLength(1);
    expect(newer.notifications).toHaveLength(0);
  });
});

describe("filterGroupedExcludingUser", () => {
  it("returns the same groups when the viewer pubkey is missing", () => {
    const groups = [group("parent-a", [reply("a1", "someone")])];
    expect(filterGroupedExcludingUser(groups, null)).toBe(groups);
    expect(filterGroupedExcludingUser(groups, undefined)).toBe(groups);
    expect(filterGroupedExcludingUser(groups, "  ")).toBe(groups);
  });

  it("drops the viewer's replies, quotes, and zaps, then drops empty groups", () => {
    const kept = reply("other", "someone-else");
    const groups = [
      group("self-only", [
        reply("mine", "AbC"),
        quote("my-quote", "abc"),
        zap("my-zap", "ABC", "not-the-sender-check"),
      ]),
      group("mixed", [
        kept,
        zap("their-zap", "stranger", "abc"),
        reply("also-mine", "abc"),
      ]),
    ];

    const filtered = filterGroupedExcludingUser(groups, "aBc");

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.parentPost.eventId).toBe("mixed");
    expect(filtered[0]?.notifications).toEqual([
      kept,
      zap("their-zap", "stranger", "abc"),
    ]);
    expect(groups[0]?.notifications).toHaveLength(3);
  });
});

describe("profile enrichment and serialization", () => {
  it("fills parent pictures from the profile map and falls back to the post", () => {
    const withPicture = group("p1", [reply("n1", "a")], {
      pubkey: "known",
      authorPicture: "old",
    });
    const fallback = group("p2", [reply("n2", "a")], {
      pubkey: "partial",
      authorPicture: "kept",
    });
    const empty = group("p3", [reply("n3", "a")], { pubkey: "missing" });
    const profiles = new Map<string, User>([
      ["known", profile("known", { picture: "https://pic" })],
      ["partial", profile("partial")],
    ]);

    const enriched = enrichGroupedParentAuthorPictures(
      [withPicture, fallback, empty],
      profiles
    );

    expect(enriched.map((item) => item.parentPost.authorPicture)).toEqual([
      "https://pic",
      "kept",
      null,
    ]);
    expect(withPicture.parentPost.authorPicture).toBe("old");
  });

  it("uses an empty picture string instead of the notification fallback", () => {
    const enriched = enrichGroupedParentAuthorPictures(
      [group("p1", [reply("n1", "a")], { authorPicture: "old" })],
      new Map([["parent-pk", profile("parent-pk", { picture: "" })]])
    );
    expect(enriched[0]?.parentPost.authorPicture).toBe("");
  });

  it("overlays mention authors and leaves unknown pubkeys untouched", () => {
    const unknown = mention("m1", "unknown");
    const named = mention("m2", "named");
    const display = mention("m3", "display");
    const blank = mention("m4", "blank");
    const profiles = new Map<string, User>([
      ["named", profile("named", { name: "Name Only" })],
      [
        "display",
        profile("display", {
          displayName: "Display",
          name: "Ignored",
          picture: "https://display",
          nip05: "display@nostr",
        }),
      ],
      ["blank", profile("blank", { displayName: "", picture: "" })],
    ]);

    const enriched = enrichGlobalMentionNotificationsWithProfiles(
      [unknown, named, display, blank],
      profiles
    );

    expect(enriched[0]).toBe(unknown);
    expect(enriched[1]).toEqual({
      ...named,
      authorName: "Name Only",
      authorPicture: "fallback-pic",
      authorNip05: "fallback@nostr",
    });
    expect(enriched[2]).toEqual({
      ...display,
      authorName: "Display",
      authorPicture: "https://display",
      authorNip05: "display@nostr",
    });
    expect(enriched[3]?.authorName).toBe("");
    expect(enriched[3]?.authorPicture).toBe("");
  });

  it("serializes published dates to ISO strings without mutating the input", () => {
    const publishedAt = new Date("2024-04-01T00:00:00.000Z");
    const dated = group("p1", [reply("n1", "a")], { publishedAt });
    const undated = group("p2", [reply("n2", "a")]);

    const serialized = serializeGroupedForResponse([dated, undated]);

    expect(serialized[0]?.parentPost.publishedAt).toBe(
      "2024-04-01T00:00:00.000Z"
    );
    expect(serialized[1]?.parentPost.publishedAt).toBeNull();
    expect(dated.parentPost.publishedAt).toBe(publishedAt);
  });
});

describe("computeGroupSummaries", () => {
  it("counts every workflow state and linked action once per notification", () => {
    const notifications = [
      reply("unhandled", "a"),
      reply("explicit-unhandled", "a"),
      reply("drafted", "a"),
      reply("scheduled-state", "a"),
      reply("replied", "a"),
      reply("handled", "a"),
      reply("ignored", "a"),
      reply("snoozed", "a"),
      reply("draft-link", "a"),
      reply("scheduled-reply", "a"),
      reply("scheduled-quote", "a"),
      reply("scheduled-repost", "a"),
      reply("queued-reply", "a"),
      reply("queued-quote", "a"),
      reply("queued-repost", "a"),
      reply("draft-and-replied", "a"),
      reply("scheduled-both", "a"),
      reply("no-link-key", "a"),
    ];
    const states = {
      "explicit-unhandled": {
        state: "UNHANDLED" as const,
        repliedFromApp: false,
      },
      drafted: { state: "DRAFTED" as const, repliedFromApp: false },
      "scheduled-state": { state: "SCHEDULED" as const, repliedFromApp: false },
      replied: { state: "REPLIED" as const, repliedFromApp: true },
      handled: { state: "HANDLED" as const, repliedFromApp: false },
      ignored: { state: "IGNORED" as const, repliedFromApp: false },
      snoozed: {
        state: "SNOOZED" as const,
        repliedFromApp: false,
        snoozedUntil: "2024-05-01T00:00:00.000Z",
      },
      "draft-and-replied": { state: "REPLIED" as const, repliedFromApp: true },
      "scheduled-both": { state: "SCHEDULED" as const, repliedFromApp: false },
    };
    const linked: Record<string, EngagementLinkedAction[]> = {
      "draft-link": [{ kind: "DRAFT" }],
      "scheduled-reply": [{ kind: "SCHEDULED_REPLY" }],
      "scheduled-quote": [{ kind: "SCHEDULED_QUOTE" }],
      "scheduled-repost": [{ kind: "SCHEDULED_REPOST" }],
      "queued-reply": [{ kind: "QUEUED_REPLY" }],
      "queued-quote": [{ kind: "QUEUED_QUOTE" }],
      "queued-repost": [{ kind: "QUEUED_REPOST" }],
      "draft-and-replied": [{ kind: "DRAFT" }],
      "scheduled-both": [{ kind: "SCHEDULED_REPLY" }],
    };
    const empty = group("empty", []);

    const summaries = computeGroupSummaries({
      groups: [group("parent", notifications), empty],
      states,
      linked,
    });

    expect(summaries["parent"]).toEqual({
      total: 18,
      needResponse: 9,
      drafted: 3,
      scheduled: 5,
      handled: 4,
    });
    expect(summaries["empty"]).toEqual({
      total: 0,
      needResponse: 0,
      drafted: 0,
      scheduled: 0,
      handled: 0,
    });
  });
});

describe("processAndGroupQuoteReposts", () => {
  const stats: Record<string, EventStats> = {
    parent: {
      likes: 1,
      replies: 2,
      mentions: 3,
      reposts: 4,
      zaps: 5,
      satszapped: 6,
    },
  };
  const posts: PostData[] = [];

  beforeEach(() => {
    processQuoteReposts.mockReset();
    groupNotificationsByParent.mockReset();
    calculateTrustScore.mockReset();
    filterMutedNotifications.mockReset();
    filterLowTrustNotifications.mockReset();
    fetchUserProfile.mockReset();
  });

  it("returns an empty list without calling the cache when there are no quotes", async () => {
    const grouped = await processAndGroupQuoteReposts(
      [],
      "viewer",
      true,
      true,
      ["npub1muted"],
      new Map(),
      new Map(),
      posts,
      stats
    );

    expect(grouped).toEqual([]);
    expect(processQuoteReposts).not.toHaveBeenCalled();
  });

  it("filters muted and low-trust quotes, then fetches only missing profiles", async () => {
    const kept = reply("kept", "kept-pk");
    const dropped = reply("dropped", "dropped-pk");
    const cached = reply("cached", "cached-pk");
    const missing = reply("missing", "missing-pk");
    const keptProfile = profile("kept-pk", { displayName: "Kept" });
    const grouped = [group("parent", [kept])];
    processQuoteReposts.mockResolvedValue([kept, dropped, cached, missing]);
    filterMutedNotifications.mockReturnValue([kept, cached, missing]);
    fetchUserProfile.mockImplementation(async (pubkey) =>
      pubkey === "kept-pk" ? keptProfile : null
    );
    calculateTrustScore.mockReturnValue(77);
    filterLowTrustNotifications.mockReturnValue([kept]);
    groupNotificationsByParent.mockReturnValue(grouped);
    const profiles = new Map<string, User>([
      ["cached-pk", profile("cached-pk")],
    ]);
    const scores = new Map<string, number>([["cached-pk", 10]]);

    const result = await processAndGroupQuoteReposts(
      [
        {
          id: "raw",
          pubkey: "x",
          created_at: 1,
          kind: 1,
          content: "",
          tags: [],
        },
      ],
      "viewer",
      true,
      true,
      ["npub1muted"],
      profiles,
      scores,
      posts,
      stats
    );

    expect(result).toBe(grouped);
    expect(processQuoteReposts).toHaveBeenCalledWith(
      [
        {
          id: "raw",
          pubkey: "x",
          created_at: 1,
          kind: 1,
          content: "",
          tags: [],
        },
      ],
      connectToPrimalCache
    );
    expect(filterMutedNotifications).toHaveBeenCalledWith(
      [kept, dropped, cached, missing],
      ["npub1muted"]
    );
    expect(fetchUserProfile).toHaveBeenCalledTimes(2);
    expect(fetchUserProfile).toHaveBeenCalledWith("kept-pk");
    expect(fetchUserProfile).toHaveBeenCalledWith("missing-pk");
    expect(calculateTrustScore).toHaveBeenCalledTimes(1);
    expect(calculateTrustScore).toHaveBeenCalledWith(keptProfile);
    expect(profiles.get("kept-pk")).toBe(keptProfile);
    expect(scores.get("kept-pk")).toBe(77);
    expect(profiles.has("missing-pk")).toBe(false);
    expect(filterLowTrustNotifications).toHaveBeenCalledWith(
      [kept, cached, missing],
      scores
    );
    expect(groupNotificationsByParent).toHaveBeenCalledWith(
      [kept],
      posts,
      [],
      stats
    );
  });

  it("skips both filters when they are disabled or the mute list is empty", async () => {
    const note = reply("n1", "pk");
    processQuoteReposts.mockResolvedValue([note]);
    fetchUserProfile.mockResolvedValue(null);
    groupNotificationsByParent.mockReturnValue([]);

    await processAndGroupQuoteReposts(
      [
        {
          id: "raw",
          pubkey: "x",
          created_at: 1,
          kind: 1,
          content: "",
          tags: [],
        },
      ],
      "viewer",
      true,
      false,
      [],
      new Map(),
      new Map(),
      posts,
      stats
    );

    expect(filterMutedNotifications).not.toHaveBeenCalled();
    expect(filterLowTrustNotifications).not.toHaveBeenCalled();
    expect(groupNotificationsByParent).toHaveBeenCalledWith(
      [note],
      posts,
      [],
      stats
    );
  });

  it("propagates cache and profile failures", async () => {
    processQuoteReposts.mockRejectedValueOnce(new Error("cache down"));
    await expect(
      processAndGroupQuoteReposts(
        [
          {
            id: "raw",
            pubkey: "x",
            created_at: 1,
            kind: 1,
            content: "",
            tags: [],
          },
        ],
        "viewer",
        false,
        false,
        [],
        new Map(),
        new Map(),
        posts,
        stats
      )
    ).rejects.toThrow("cache down");

    processQuoteReposts.mockResolvedValueOnce([reply("n1", "pk")]);
    fetchUserProfile.mockRejectedValueOnce(new Error("profile down"));
    await expect(
      processAndGroupQuoteReposts(
        [
          {
            id: "raw",
            pubkey: "x",
            created_at: 1,
            kind: 1,
            content: "",
            tags: [],
          },
        ],
        "viewer",
        false,
        false,
        [],
        new Map(),
        new Map(),
        posts,
        stats
      )
    ).rejects.toThrow("profile down");
  });
});
