// @ts-nocheck -- mocked collaborators are narrower than the production types.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface PostStatsShape {
  likes: number;
  replies: number;
  mentions: number;
  reposts: number;
  zaps: number;
  satszapped: number;
}

interface LoaderUser {
  id: string;
  npub?: string;
  filterMuted?: boolean;
  mutedList?: unknown;
  hidePostsFromLowTrustUsers?: boolean;
}

interface QueueRow {
  id: string;
  name: string;
  isEnabled?: boolean;
}

interface ScopePost {
  id?: string;
  queueType?: { id: string; name: string; userId: string } | null;
  signedEvent?: unknown;
}

const cache = vi.hoisted(() => ({
  connectToPrimalCache: vi.fn(
    async (_command: string, _args: { pubkey: string }): Promise<unknown> => []
  ),
}));

const trust = vi.hoisted(() => ({
  calculateTrustScore: vi.fn((_user: { pubkey: string }): number => 0),
}));

const social = vi.hoisted(() => ({
  getFollowedPubkeys: vi.fn(async (_hex: string): Promise<string[]> => []),
  getFollowerPubkeys: vi.fn(async (_hex: string): Promise<string[]> => []),
}));

const postsDto = vi.hoisted(() => ({
  toPostDTOArray: vi.fn((posts: Array<{ id?: string }>) =>
    posts.map((post, index) => ({
      id: typeof post.id === "string" ? post.id : `post-${index}`,
    }))
  ),
}));

const postsApi = vi.hoisted(() => ({
  getRecentPublishedPosts: vi.fn(
    async (_query: {
      userId: string;
      days?: number;
      queueType?: string;
    }): Promise<ScopePost[]> => []
  ),
  getPostsInScope: vi.fn(
    async (_userId: string, _scope: unknown): Promise<ScopePost[]> => []
  ),
}));

const statsApi = vi.hoisted(() => ({
  getPostStats: vi.fn(
    async (
      _ids: readonly unknown[]
    ): Promise<Record<string, PostStatsShape>> => ({})
  ),
}));

const postTypes = vi.hoisted(() => ({
  convertPrismaQueueTypeToQueueType: vi.fn(
    (
      queueType: { id?: string; name?: string } | null | undefined
    ): { id: string; name: string } | undefined => {
      if (!queueType) return undefined;
      return { id: queueType.id ?? "q", name: queueType.name ?? "Queue" };
    }
  ),
}));

const userApi = vi.hoisted(() => ({
  getGiveawayBlacklist: vi.fn(async (_userId: string): Promise<string[]> => []),
  getUserById: vi.fn(
    async (_userId: string): Promise<LoaderUser | null> => null
  ),
}));

const queueCache = vi.hoisted(() => ({
  getQueueTypesCached: vi.fn(
    async (_userId: string): Promise<QueueRow[]> => []
  ),
}));

const profileCache = vi.hoisted(() => ({
  getUserProfileWithCache: vi.fn(
    async (_pubkey: string): Promise<unknown> => []
  ),
}));

const logs = vi.hoisted(() => ({
  logError: vi.fn(
    (_error: unknown, _context?: Record<string, unknown>): undefined =>
      undefined
  ),
  logWarning: vi.fn(
    (
      _message: string,
      _context?: { pubkey?: string; error?: string }
    ): undefined => undefined
  ),
}));

const helpers = vi.hoisted(() => ({
  convertToHex: vi.fn((value: string): string | null => value),
}));

const nostr = vi.hoisted(() => ({
  nostrAdapter: {
    decodeNpub: vi.fn((npub: string): string | null =>
      npub ? `hex:${npub}` : null
    ),
  },
}));

const participantsApi = vi.hoisted(() => ({
  fetchGiveawayParticipants: vi.fn(
    async (
      _ids: readonly unknown[]
    ): Promise<{ relatedEvents: RelatedEvent[] }> => ({
      relatedEvents: [],
    })
  ),
}));

vi.mock("~/features/cache/primalCache.server", () => cache);
vi.mock("~/features/engagement/trust-score", () => trust);
vi.mock("~/features/nostr/social-graph.server", () => social);
vi.mock("~/features/posts/dtos", () => postsDto);
vi.mock("~/features/posts/server", () => ({
  getRecentPublishedPosts: postsApi.getRecentPublishedPosts,
}));
vi.mock("~/features/posts/stats.server", () => statsApi);
vi.mock("~/features/posts/types", () => postTypes);
vi.mock("~/features/user", () => userApi);
vi.mock("~/features/user/services/user-cache.server", () => queueCache);
vi.mock(
  "~/features/user/services/user-profile-cache.server",
  () => profileCache
);
vi.mock("~/lib/error-logger.server", () => logs);
vi.mock("~/lib/helpers", () => helpers);
vi.mock("~/lib/nostr-adapter.server", () => nostr);
vi.mock("~/features/giveaway/giveaway-scope.server", () => ({
  getPostsInScope: postsApi.getPostsInScope,
}));
vi.mock("~/features/giveaway/giveaway.server", () => participantsApi);

import {
  fetchUserProfile,
  getParticipantPubkeysForFollowScope,
  getWinnerProfiles,
  loadGiveawayData,
  processGiveawayParticipants,
} from "~/features/giveaway/giveaway-loader.server";
import type { GiveawayScope, RelatedEvent } from "~/features/giveaway/types";
import { ExternalServiceError } from "~/lib/errors";

function zeros(): PostStatsShape {
  return {
    likes: 0,
    replies: 0,
    mentions: 0,
    reposts: 0,
    zaps: 0,
    satszapped: 0,
  };
}

function related(pubkey: string, id = pubkey): RelatedEvent {
  return { id, pubkey, created_at: 1_700_000_000, kind: 7 };
}

function loaderUser(partial?: Partial<LoaderUser>): LoaderUser {
  return {
    id: "u1",
    npub: "npub1user",
    filterMuted: false,
    mutedList: null,
    ...partial,
  };
}

function participantEvents(options?: {
  notArray?: boolean;
  lud16?: string | null;
  zaps?: number;
  followers?: number;
  joined?: number;
  profileContent?: unknown;
  statsContent?: unknown;
  skipProfile?: boolean;
  skipStats?: boolean;
  omitFollowers?: boolean;
  omitJoined?: boolean;
  omitZaps?: boolean;
}): unknown {
  if (options?.notArray) return { bad: true };
  const rows: unknown[] = [
    "EOSE",
    ["NOT", "x"],
    ["EVENT", "s"],
    ["EVENT", "s", "text"],
    ["EVENT", "s", []],
    ["EVENT", "s", { kind: 3, content: "{}" }],
  ];
  if (!options?.skipProfile) {
    const content =
      options && "profileContent" in options
        ? options.profileContent
        : JSON.stringify({
            lud16:
              options?.lud16 === undefined ? "alice@pay.com" : options.lud16,
          });
    rows.push(["EVENT", "s", { kind: 0, content }]);
  }
  if (!options?.skipStats) {
    const stats: Record<string, number> = {};
    if (!options?.omitZaps) stats["total_zap_count"] = options?.zaps ?? 10;
    if (!options?.omitFollowers) {
      stats["followers_count"] = options?.followers ?? 50;
    }
    if (!options?.omitJoined) {
      stats["time_joined"] = options?.joined ?? 1_600_000_000;
    }
    const content =
      options && "statsContent" in options
        ? options.statsContent
        : JSON.stringify(stats);
    rows.push(["EVENT", "s", { kind: 10000105, content }]);
  }
  return rows;
}

function primalPayload(options?: {
  notArray?: boolean;
  profile?: Record<string, unknown> | null;
  stats?: Record<string, unknown> | null;
  profileContent?: unknown;
  statsContent?: unknown;
}): unknown {
  if (options?.notArray) return "nope";
  const rows: unknown[] = [
    "EOSE",
    ["NOT", "x"],
    ["EVENT", "s"],
    ["EVENT", "s", null],
    ["EVENT", "s", "text"],
    ["EVENT", "s", []],
    ["EVENT", "s", { kind: 2 }],
  ];
  if (options?.profile !== null) {
    const content =
      options && "profileContent" in options
        ? options.profileContent
        : JSON.stringify(options?.profile ?? { name: "Ada" });
    rows.push(["EVENT", "s", { kind: 0, content }]);
  }
  if (options?.stats !== null) {
    const content =
      options && "statsContent" in options
        ? options.statsContent
        : JSON.stringify(options?.stats ?? { followers_count: 3 });
    rows.push(["EVENT", "s", { kind: 10000105, content }]);
  }
  return rows;
}

describe("giveaway-loader.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.connectToPrimalCache.mockImplementation(async () => primalPayload());
    trust.calculateTrustScore.mockReturnValue(80);
    social.getFollowedPubkeys.mockResolvedValue([]);
    social.getFollowerPubkeys.mockResolvedValue([]);
    postsApi.getRecentPublishedPosts.mockResolvedValue([]);
    postsApi.getPostsInScope.mockResolvedValue([]);
    statsApi.getPostStats.mockResolvedValue({});
    postTypes.convertPrismaQueueTypeToQueueType.mockImplementation(
      (queueType) => {
        if (!queueType) return undefined;
        return { id: queueType.id ?? "q", name: queueType.name ?? "Queue" };
      }
    );
    postsDto.toPostDTOArray.mockImplementation((posts) =>
      posts.map((post, index) => ({
        id: typeof post.id === "string" ? post.id : `post-${index}`,
      }))
    );
    userApi.getGiveawayBlacklist.mockResolvedValue([]);
    userApi.getUserById.mockResolvedValue(loaderUser());
    queueCache.getQueueTypesCached.mockResolvedValue([
      { id: "q1", name: "Posts", isEnabled: true },
    ]);
    profileCache.getUserProfileWithCache.mockImplementation(async () =>
      participantEvents()
    );
    logs.logError.mockImplementation(() => undefined);
    logs.logWarning.mockImplementation(() => undefined);
    helpers.convertToHex.mockImplementation((value: string) => value);
    nostr.nostrAdapter.decodeNpub.mockImplementation((npub: string) =>
      npub ? `hex:${npub}` : null
    );
    participantsApi.fetchGiveawayParticipants.mockResolvedValue({
      relatedEvents: [],
    });
  });

  describe("getParticipantPubkeysForFollowScope", () => {
    it("returns an empty list when the npub does not decode", async () => {
      nostr.nostrAdapter.decodeNpub.mockImplementation(() => null);
      const following: GiveawayScope = { type: "FOLLOWING", reference: {} };
      await expect(
        getParticipantPubkeysForFollowScope("u1", following, "")
      ).resolves.toEqual([]);

      nostr.nostrAdapter.decodeNpub.mockImplementation(() => "");
      const followers: GiveawayScope = { type: "FOLLOWERS", reference: {} };
      await expect(
        getParticipantPubkeysForFollowScope("u1", followers, "npub1user")
      ).resolves.toEqual([]);
      expect(social.getFollowedPubkeys).not.toHaveBeenCalled();
      expect(social.getFollowerPubkeys).not.toHaveBeenCalled();
    });

    it("loads followed pubkeys for FOLLOWING scope", async () => {
      const followed = ["alpha", "beta"];
      social.getFollowedPubkeys.mockResolvedValue(followed);
      const scope: GiveawayScope = { type: "FOLLOWING", reference: {} };
      const result = await getParticipantPubkeysForFollowScope(
        "u1",
        scope,
        "npub1user"
      );
      expect(result).toBe(followed);
      expect(social.getFollowedPubkeys).toHaveBeenCalledWith("hex:npub1user");
      expect(social.getFollowerPubkeys).not.toHaveBeenCalled();
    });

    it("loads follower pubkeys for FOLLOWERS scope", async () => {
      const followers = ["gamma"];
      social.getFollowerPubkeys.mockResolvedValue(followers);
      const scope: GiveawayScope = { type: "FOLLOWERS", reference: {} };
      const result = await getParticipantPubkeysForFollowScope(
        "u1",
        scope,
        "npub1user"
      );
      expect(result).toBe(followers);
      expect(social.getFollowerPubkeys).toHaveBeenCalledWith("hex:npub1user");
      expect(social.getFollowedPubkeys).not.toHaveBeenCalled();
    });

    it("returns no pubkeys for scopes that are not follow graphs", async () => {
      const period: GiveawayScope = { type: "PERIOD", reference: { days: 7 } };
      const single: GiveawayScope = {
        type: "SINGLE_POST",
        reference: { postId: "p1" },
      };
      const queue: GiveawayScope = {
        type: "QUEUE",
        reference: { queueId: "q1" },
      };
      await expect(
        getParticipantPubkeysForFollowScope("u1", period, "npub1user")
      ).resolves.toEqual([]);
      await expect(
        getParticipantPubkeysForFollowScope("u1", single, "npub1user")
      ).resolves.toEqual([]);
      await expect(
        getParticipantPubkeysForFollowScope("u1", queue, "npub1user")
      ).resolves.toEqual([]);
      expect(social.getFollowedPubkeys).not.toHaveBeenCalled();
      expect(social.getFollowerPubkeys).not.toHaveBeenCalled();
    });
  });

  describe("fetchUserProfile", () => {
    it("maps profile and stats events into a trust-score user", async () => {
      cache.connectToPrimalCache.mockResolvedValue(
        primalPayload({
          profile: {
            name: "Ada",
            display_name: "Countess",
            about: "math",
            picture: "pic",
            nip05: "ada@example.com",
            lud16: "ada@pay.com",
          },
          stats: {
            follows_count: 1,
            followers_count: 2,
            note_count: 3,
            reply_count: 4,
            time_joined: 5,
            total_zap_count: 6,
            total_satszapped: 7,
            media_count: 8,
          },
        })
      );
      const user = await fetchUserProfile("pk1");
      expect(cache.connectToPrimalCache).toHaveBeenCalledWith("user_profile", {
        pubkey: "pk1",
      });
      expect(user).toEqual({
        pubkey: "pk1",
        name: "Ada",
        displayName: "Countess",
        about: "math",
        picture: "pic",
        nip05: "ada@example.com",
        lud16: "ada@pay.com",
        followsCount: 1,
        followersCount: 2,
        noteCount: 3,
        replyCount: 4,
        timeJoined: 5,
        zapCount: 6,
        totalSatsZapped: 7,
        mediaCount: 8,
      });
    });

    it("returns zeros when profile and stats events have no content", async () => {
      cache.connectToPrimalCache.mockResolvedValue([
        ["EVENT", "s", { kind: 0 }],
        ["EVENT", "s", { kind: 10000105, content: "" }],
      ]);
      const user = await fetchUserProfile("pk-empty");
      expect(user?.name).toBeUndefined();
      expect(user?.followersCount).toBe(0);
      expect(user?.zapCount).toBe(0);
      expect(logs.logWarning).not.toHaveBeenCalled();
    });

    it("continues when profile or stats JSON cannot be parsed", async () => {
      cache.connectToPrimalCache.mockResolvedValue(
        primalPayload({
          profileContent: "{bad",
          statsContent: "{bad",
        })
      );
      const user = await fetchUserProfile("pk-bad");
      expect(user?.pubkey).toBe("pk-bad");
      expect(user?.name).toBeUndefined();
      expect(user?.followersCount).toBe(0);
      expect(logs.logWarning).toHaveBeenCalledTimes(2);
      expect(logs.logWarning.mock.calls[0]?.[0]).toBe(
        "Failed to parse profile content"
      );
      expect(logs.logWarning.mock.calls[1]?.[0]).toBe(
        "Failed to parse stats content"
      );
      expect(logs.logWarning.mock.calls[0]?.[1]?.pubkey).toBe("pk-bad");
      expect(typeof logs.logWarning.mock.calls[0]?.[1]?.error).toBe("string");
    });

    it("returns null when primal payload is not an array", async () => {
      cache.connectToPrimalCache.mockResolvedValue({ not: "array" });
      await expect(fetchUserProfile("pk-obj")).resolves.toBeNull();
      expect(logs.logError).not.toHaveBeenCalled();
    });

    it("logs and returns null when the profile request throws", async () => {
      cache.connectToPrimalCache.mockImplementation(() => {
        throw new Error("down");
      });
      await expect(fetchUserProfile("pk1")).resolves.toBeNull();
      const logged = logs.logError.mock.calls[0]?.[0];
      expect(logged).toBeInstanceOf(ExternalServiceError);
      if (!(logged instanceof ExternalServiceError)) {
        throw new Error("expected ExternalServiceError");
      }
      expect(logged.message).toContain("pk1");
      expect(logged.statusCode).toBe(502);
      expect(logged.context?.["service"]).toBe("PrimalCache");
      expect(logged.context?.["pubkey"]).toBe("pk1");
      expect(logged.context?.["originalError"]).toBe("down");

      cache.connectToPrimalCache.mockImplementation(() => {
        throw 5;
      });
      await expect(fetchUserProfile("pk2")).resolves.toBeNull();
      const second = logs.logError.mock.calls[1]?.[0];
      if (!(second instanceof ExternalServiceError)) {
        throw new Error("expected ExternalServiceError");
      }
      expect(second.context?.["originalError"]).toBe("5");
    });
  });

  describe("getWinnerProfiles", () => {
    it("returns an empty record for no pubkeys", async () => {
      await expect(getWinnerProfiles([])).resolves.toEqual({});
      expect(cache.connectToPrimalCache).not.toHaveBeenCalled();
    });

    it("dedupes pubkeys and prefers display name over name", async () => {
      cache.connectToPrimalCache.mockImplementation(
        async (_command: string, args: { pubkey: string }) => {
          if (args.pubkey === "display") {
            return primalPayload({
              profile: {
                name: "Ada",
                display_name: "Countess",
                picture: "pic",
              },
            });
          }
          if (args.pubkey === "named") {
            return primalPayload({
              profile: { name: "Grace", picture: "g" },
              stats: null,
            });
          }
          if (args.pubkey === "blank") {
            return primalPayload({ profile: {}, stats: {} });
          }
          return primalPayload({ notArray: true });
        }
      );
      const profiles = await getWinnerProfiles([
        "display",
        "display",
        "named",
        "blank",
        "missing",
      ]);
      expect(cache.connectToPrimalCache).toHaveBeenCalledTimes(4);
      expect(profiles).toEqual({
        display: { displayName: "Countess", picture: "pic" },
        named: { displayName: "Grace", picture: "g" },
        blank: { displayName: null, picture: null },
        missing: { displayName: null, picture: null },
      });
    });
  });

  describe("processGiveawayParticipants", () => {
    it("returns an empty list without reading the blacklist", async () => {
      await expect(
        processGiveawayParticipants([], "u1", loaderUser())
      ).resolves.toEqual([]);
      expect(userApi.getGiveawayBlacklist).not.toHaveBeenCalled();
    });

    it("keeps the first event for each pubkey", async () => {
      const first = related("same", "e1");
      const second = related("same", "e2");
      const result = await processGiveawayParticipants(
        [first, second],
        "u1",
        loaderUser()
      );
      expect(result).toEqual([first]);
      expect(profileCache.getUserProfileWithCache).toHaveBeenCalledTimes(1);
      expect(profileCache.getUserProfileWithCache).toHaveBeenCalledWith("same");
    });

    it("applies the default blacklist and mute lists", async () => {
      userApi.getGiveawayBlacklist.mockResolvedValue([
        "npub-black",
        "raw-black",
      ]);
      helpers.convertToHex.mockImplementation((value: string) => {
        if (value === "npub-black") return "hex-black";
        if (value === "raw-black") return null;
        return value;
      });
      const result = await processGiveawayParticipants(
        [
          related("hex-black"),
          related("raw-black"),
          related("muted-pk"),
          related("fan"),
        ],
        "u1",
        loaderUser({
          filterMuted: true,
          mutedList: { npubs: ["muted-pk"] },
        })
      );
      expect(result.map((item) => item.pubkey)).toEqual(["fan"]);
      expect(userApi.getGiveawayBlacklist).toHaveBeenCalledWith("u1");
      expect(profileCache.getUserProfileWithCache).toHaveBeenCalledTimes(1);
      expect(profileCache.getUserProfileWithCache).toHaveBeenCalledWith("fan");
    });

    it("lets explicit filters disable or force blocked and muted checks", async () => {
      userApi.getGiveawayBlacklist.mockResolvedValue(["fan"]);
      const kept = await processGiveawayParticipants(
        [related("fan"), related("muted-pk")],
        "u1",
        loaderUser({
          filterMuted: true,
          mutedList: { npubs: ["muted-pk"] },
        }),
        { filters: { excludeBlocked: false, excludeMuted: false } }
      );
      expect(kept.map((item) => item.pubkey)).toEqual(["fan", "muted-pk"]);
      expect(userApi.getGiveawayBlacklist).not.toHaveBeenCalled();

      userApi.getGiveawayBlacklist.mockClear();
      const forced = await processGiveawayParticipants(
        [related("fan"), related("muted-pk")],
        "u1",
        loaderUser({
          filterMuted: false,
          mutedList: { npubs: ["muted-pk"] },
        }),
        { filters: { excludeBlocked: true, excludeMuted: true } }
      );
      expect(forced.map((item) => item.pubkey)).toEqual([]);
      expect(userApi.getGiveawayBlacklist).toHaveBeenCalledWith("u1");
    });

    it("drops invalid profiles and continues when one log write throws", async () => {
      profileCache.getUserProfileWithCache.mockImplementation(
        async (pubkey: string) => {
          if (pubkey === "no-lud") return participantEvents({ lud16: null });
          if (pubkey === "empty-lud") return participantEvents({ lud16: "" });
          if (pubkey === "low-zap") return participantEvents({ zaps: 5 });
          if (pubkey === "omit-zaps") {
            return participantEvents({ omitZaps: true });
          }
          if (pubkey === "bad-json") {
            return participantEvents({ profileContent: "{" });
          }
          if (pubkey === "num-content") {
            return participantEvents({ profileContent: 5 });
          }
          if (pubkey === "stats-num") {
            return participantEvents({ statsContent: 5 });
          }
          if (pubkey === "not-array") return { bad: true };
          if (pubkey === "boom-string") throw "x";
          if (pubkey === "boom-log") throw new Error("profile down");
          if (pubkey === "skip-profile") {
            return participantEvents({ skipProfile: true });
          }
          if (pubkey === "skip-stats") {
            return participantEvents({ skipStats: true });
          }
          return participantEvents({ zaps: 6 });
        }
      );
      logs.logError.mockImplementation((_error, context) => {
        if (context?.["pubkey"] === "boom-log") {
          throw new Error("log failed");
        }
      });
      const result = await processGiveawayParticipants(
        [
          "good",
          "no-lud",
          "empty-lud",
          "low-zap",
          "omit-zaps",
          "bad-json",
          "num-content",
          "stats-num",
          "not-array",
          "skip-profile",
          "boom-string",
          "boom-log",
          "skip-stats",
          "good-2",
        ].map((pubkey) => related(pubkey)),
        "u1",
        loaderUser()
      );
      expect(result.map((item) => item.pubkey)).toEqual(["good", "good-2"]);
      expect(logs.logError.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it("applies minimum follower and account-age filters when stats exist", async () => {
      const now = Math.floor(Date.now() / 1000);
      profileCache.getUserProfileWithCache.mockImplementation(
        async (pubkey: string) => {
          if (pubkey === "few") {
            return participantEvents({
              followers: 0,
              joined: 1_000_000_000,
            });
          }
          if (pubkey === "enough") {
            return participantEvents({
              followers: 10,
              joined: 1_000_000_000,
            });
          }
          if (pubkey === "young") {
            return participantEvents({ followers: 100, joined: now });
          }
          if (pubkey === "old") {
            return participantEvents({
              followers: 100,
              joined: 1_000_000_000,
            });
          }
          return participantEvents({ omitFollowers: true, omitJoined: true });
        }
      );
      const result = await processGiveawayParticipants(
        ["few", "enough", "young", "old", "partial"].map((pubkey) =>
          related(pubkey)
        ),
        "u1",
        loaderUser(),
        { filters: { minFollowers: 10, minAccountAgeDays: 30 } }
      );
      expect(result.map((item) => item.pubkey)).toEqual([
        "enough",
        "old",
        "partial",
      ]);
    });

    it("keeps scores at or above 40 when low-trust filtering is on", async () => {
      trust.calculateTrustScore.mockImplementation(
        (user: { pubkey: string }) => {
          if (user.pubkey === "score-error") throw new Error("score");
          if (user.pubkey === "score-string") throw "bad";
          if (user.pubkey === "low") return 39;
          if (user.pubkey === "edge") return 40;
          return 80;
        }
      );
      cache.connectToPrimalCache.mockImplementation(
        async (_command: string, args: { pubkey: string }) => {
          if (args.pubkey === "ghost") return "nope";
          if (args.pubkey === "down") throw new Error("down");
          return primalPayload({ profile: { name: args.pubkey } });
        }
      );
      const result = await processGiveawayParticipants(
        [
          "low",
          "edge",
          "high",
          "ghost",
          "down",
          "score-error",
          "score-string",
        ].map((pubkey) => related(pubkey)),
        "u1",
        loaderUser(),
        { filters: { excludeLowTrust: true } }
      );
      expect(result.map((item) => item.pubkey)).toEqual(["edge", "high"]);
      expect(trust.calculateTrustScore).toHaveBeenCalledWith(
        expect.objectContaining({ pubkey: "edge" })
      );
      const scored = trust.calculateTrustScore.mock.calls.map(
        (call) => call[0].pubkey
      );
      expect(scored).not.toContain("ghost");
      expect(scored).not.toContain("down");
    });

    it("filters low trust from the user setting without a giveaway filter", async () => {
      trust.calculateTrustScore.mockImplementation(
        (user: { pubkey: string }) => (user.pubkey === "low" ? 10 : 80)
      );
      const result = await processGiveawayParticipants(
        [related("low"), related("high")],
        "u1",
        loaderUser({ hidePostsFromLowTrustUsers: true })
      );
      expect(result.map((item) => item.pubkey)).toEqual(["high"]);
    });

    it("does not score trust when neither flag is set", async () => {
      const result = await processGiveawayParticipants(
        [related("low"), related("high")],
        "u1",
        loaderUser(),
        { filters: { excludeLowTrust: false } }
      );
      expect(result.map((item) => item.pubkey)).toEqual(["low", "high"]);
      expect(trust.calculateTrustScore).not.toHaveBeenCalled();
      expect(cache.connectToPrimalCache).not.toHaveBeenCalled();
    });

    it("drops a rejected trust lookup without failing the batch", async () => {
      trust.calculateTrustScore.mockImplementation(() => {
        throw new Error("score");
      });
      logs.logError.mockImplementation((_error, context) => {
        if (context?.["message"] === "Failed to fetch trust score") {
          throw new Error("log failed");
        }
      });
      const result = await processGiveawayParticipants(
        [related("boom"), related("also")],
        "u1",
        loaderUser({ hidePostsFromLowTrustUsers: true })
      );
      expect(result).toEqual([]);
    });

    it("limits the pool to accounts the user follows", async () => {
      social.getFollowedPubkeys.mockResolvedValue(["fan-hex", "raw-keep"]);
      helpers.convertToHex.mockImplementation((value: string) => {
        if (value === "fan-hex") return "fan";
        if (value === "raw-keep") return null;
        return value;
      });
      nostr.nostrAdapter.decodeNpub.mockReturnValue("decoded-user");
      const result = await processGiveawayParticipants(
        [related("fan"), related("raw-keep"), related("other")],
        "u1",
        loaderUser({ npub: "npub1user" }),
        { filters: { excludeNonFollowers: true } }
      );
      expect(result.map((item) => item.pubkey)).toEqual(["fan", "raw-keep"]);
      expect(social.getFollowedPubkeys).toHaveBeenCalledWith("decoded-user");
    });

    it("skips the follower filter when the user has no npub", async () => {
      const result = await processGiveawayParticipants(
        [related("fan"), related("other")],
        "u1",
        loaderUser({ npub: undefined }),
        { filters: { excludeNonFollowers: true } }
      );
      expect(result.map((item) => item.pubkey)).toEqual(["fan", "other"]);
      expect(social.getFollowedPubkeys).not.toHaveBeenCalled();
    });

    it("asks for follows of an empty hex when decode fails", async () => {
      nostr.nostrAdapter.decodeNpub.mockReturnValue(null);
      const result = await processGiveawayParticipants(
        [related("fan")],
        "u1",
        loaderUser(),
        { filters: { excludeNonFollowers: true } }
      );
      expect(result).toEqual([]);
      expect(social.getFollowedPubkeys).toHaveBeenCalledWith("");
    });
  });

  describe("loadGiveawayData", () => {
    const queue = { id: "q", name: "Posts", userId: "u1" };

    it("loads a legacy queue, drops self and muted engagement, and keeps enabled queues", async () => {
      const user = loaderUser({
        filterMuted: true,
        mutedList: { npubs: ["muted-pk"] },
      });
      userApi.getUserById.mockResolvedValue(user);
      queueCache.getQueueTypesCached.mockResolvedValue([
        { id: "q1", name: "Memes", isEnabled: true },
        { id: "q2", name: "Off", isEnabled: false },
        { id: "q3", name: "Unset" },
      ]);
      postsDto.toPostDTOArray.mockImplementation((posts) => {
        const dtos = posts.map((post, index) => ({
          id: typeof post.id === "string" ? post.id : `post-${index}`,
        }));
        dtos.push({ id: "extra-dto" });
        return dtos;
      });
      statsApi.getPostStats.mockImplementation(async (ids) => {
        const stats: Record<string, PostStatsShape> = {};
        for (const id of ids) {
          const key = String(id);
          stats[key] =
            key === "root"
              ? {
                  likes: 1,
                  replies: 2,
                  mentions: 3,
                  reposts: 4,
                  zaps: 5,
                  satszapped: 9,
                }
              : {
                  likes: 1,
                  replies: 0,
                  mentions: 0,
                  reposts: 0,
                  zaps: 0,
                  satszapped: 0,
                };
        }
        return stats;
      });
      postsApi.getRecentPublishedPosts.mockResolvedValue([
        { id: "p-none", queueType: queue, signedEvent: null },
        { id: "p-str", queueType: queue, signedEvent: "nope" },
        { id: "p-obj", queueType: queue, signedEvent: { nope: true } },
        {
          id: "p-blank-id",
          queueType: queue,
          signedEvent: { id: "  ", pubkey: "author" },
        },
        {
          id: "p-blank-pk",
          queueType: queue,
          signedEvent: { id: "blank-pk", pubkey: "   " },
        },
        {
          id: "p-num",
          queueType: queue,
          signedEvent: { id: 12, pubkey: "author" },
        },
        { id: "p-no-pk", queueType: queue, signedEvent: { id: "no-pk" } },
        {
          id: "p-good",
          queueType: null,
          signedEvent: { id: "root", pubkey: "author" },
        },
        {
          id: "p-good2",
          queueType: queue,
          signedEvent: { id: "root2", pubkey: "author2" },
        },
      ]);
      participantsApi.fetchGiveawayParticipants.mockResolvedValue({
        relatedEvents: [
          {
            id: "self",
            pubkey: "author",
            created_at: 1,
            kind: 7,
            tags: [["e", "root"]],
          },
          {
            id: "fan-event",
            pubkey: "fan",
            created_at: 2,
            kind: 7,
            tags: [["e", "root"]],
          },
          {
            id: "stranger-event",
            pubkey: "stranger",
            created_at: 3,
            kind: 1,
          },
          {
            id: "muted-event",
            pubkey: "muted-pk",
            created_at: 4,
            kind: 6,
            tags: [["e", "root2"]],
          },
        ],
      });

      const result = await loadGiveawayData("u1", "memes", 7);

      expect(postsApi.getRecentPublishedPosts).toHaveBeenCalledWith({
        userId: "u1",
        days: 7,
        queueType: "memes",
      });
      expect(postsApi.getPostsInScope).not.toHaveBeenCalled();
      expect(statsApi.getPostStats).toHaveBeenCalledWith([
        "  ",
        "blank-pk",
        12,
        "no-pk",
        "root",
        "root2",
      ]);
      expect(participantsApi.fetchGiveawayParticipants).toHaveBeenCalledWith([
        "  ",
        "blank-pk",
        12,
        "no-pk",
        "root",
        "root2",
      ]);
      expect(userApi.getGiveawayBlacklist).toHaveBeenCalledWith("u1");
      expect(queueCache.getQueueTypesCached).toHaveBeenCalledWith("u1");
      expect(postTypes.convertPrismaQueueTypeToQueueType).toHaveBeenCalledWith(
        null
      );
      expect(postTypes.convertPrismaQueueTypeToQueueType).toHaveBeenCalledWith(
        queue
      );
      expect(result.user).toBe(user);
      expect(result.selectedQueueType).toBe("memes");
      expect(result.queueTypes.map((item) => item.name)).toEqual([
        "Memes",
        "Unset",
      ]);
      expect(result.relatedEvents.map((item) => item.pubkey)).toEqual([
        "fan",
        "stranger",
      ]);
      const good = result.posts.find((post) => post.id === "p-good");
      expect(good?.totalEngagement).toBe(15);
      expect(good?.stats).toEqual({
        likes: 1,
        replies: 2,
        mentions: 3,
        reposts: 4,
        zaps: 5,
        satszapped: 9,
      });
      const extra = result.posts.find((post) => post.id === "extra-dto");
      expect(extra?.totalEngagement).toBe(0);
      expect(extra?.stats).toEqual(zeros());
      expect(result.posts.map((post) => post.id)).not.toContain("p-none");
      expect(result.stats["root"]?.likes).toBe(1);
    });

    it("drops posts with no engagement and does not fetch participants", async () => {
      postsApi.getRecentPublishedPosts.mockResolvedValue([
        { id: "p-none", queueType: queue, signedEvent: null },
        {
          id: "p-gone",
          queueType: queue,
          signedEvent: { id: "gone", pubkey: "author" },
        },
      ]);
      statsApi.getPostStats.mockResolvedValue({});
      const result = await loadGiveawayData("u1", "memes", 7);
      expect(result.posts).toEqual([]);
      expect(result.relatedEvents).toEqual([]);
      expect(participantsApi.fetchGiveawayParticipants).not.toHaveBeenCalled();
      expect(statsApi.getPostStats).toHaveBeenCalledWith(["gone"]);
    });

    it("throws when the user is missing after optional participant fetch", async () => {
      userApi.getUserById.mockResolvedValue(null);
      await expect(loadGiveawayData("u1", "memes", 7)).rejects.toThrow(
        "User not found"
      );
      expect(participantsApi.fetchGiveawayParticipants).not.toHaveBeenCalled();

      postsApi.getRecentPublishedPosts.mockResolvedValue([
        {
          id: "p1",
          queueType: queue,
          signedEvent: { id: "root", pubkey: "author" },
        },
      ]);
      statsApi.getPostStats.mockResolvedValue({
        root: {
          likes: 1,
          replies: 0,
          mentions: 0,
          reposts: 0,
          zaps: 0,
          satszapped: 0,
        },
      });
      participantsApi.fetchGiveawayParticipants.mockResolvedValue({
        relatedEvents: [related("fan")],
      });
      await expect(loadGiveawayData("u1", "posts", 3)).rejects.toThrow(
        "User not found"
      );
      expect(participantsApi.fetchGiveawayParticipants).toHaveBeenCalledWith([
        "root",
      ]);
    });

    it("derives the selected queue from scope and ignores a numeric days argument", async () => {
      queueCache.getQueueTypesCached.mockResolvedValue([
        { id: "q1", name: "Memes", isEnabled: true },
        { id: "q2", name: "Off", isEnabled: false },
      ]);
      const matched = await loadGiveawayData("u1", {
        type: "QUEUE",
        reference: { queueId: "q1" },
      });
      expect(matched.selectedQueueType).toBe("Memes");
      expect(postsApi.getPostsInScope).toHaveBeenCalledWith("u1", {
        type: "QUEUE",
        reference: { queueId: "q1" },
      });
      expect(postsApi.getRecentPublishedPosts).not.toHaveBeenCalled();
      expect(matched.queueTypes.map((item) => item.name)).toEqual(["Memes"]);

      const missing = await loadGiveawayData("u1", {
        type: "QUEUE",
        reference: { queueId: "missing" },
      });
      expect(missing.selectedQueueType).toBe("all");

      const period = await loadGiveawayData("u1", {
        type: "PERIOD",
        reference: { days: 4, queueId: "q1" },
      });
      expect(period.selectedQueueType).toBe("all");

      const withDays = await loadGiveawayData(
        "u1",
        { type: "FOLLOWING", reference: {} },
        9
      );
      expect(withDays.selectedQueueType).toBe("all");
      expect(postsApi.getRecentPublishedPosts).not.toHaveBeenCalled();

      const bare = await loadGiveawayData("u1", "memes");
      expect(bare.selectedQueueType).toBe("all");
      expect(postsApi.getPostsInScope).toHaveBeenCalledWith("u1", "memes");
    });

    it.each([
      {
        label: "npub list",
        mutedList: { npubs: ["muted-pk"] },
        kept: ["fan"],
      },
      {
        label: "array list",
        mutedList: ["muted-pk"],
        kept: ["fan", "muted-pk"],
      },
      {
        label: "string npubs",
        mutedList: { npubs: "muted-pk" },
        kept: ["fan", "muted-pk"],
      },
      {
        label: "null list",
        mutedList: null,
        kept: ["fan", "muted-pk"],
      },
      {
        label: "numeric list",
        mutedList: 4,
        kept: ["fan", "muted-pk"],
      },
      {
        label: "object without npubs",
        mutedList: { other: true },
        kept: ["fan", "muted-pk"],
      },
    ])("normalizes mutedList for $label", async ({ mutedList, kept }) => {
      postsApi.getRecentPublishedPosts.mockResolvedValue([
        {
          id: "p1",
          queueType: queue,
          signedEvent: { id: "root", pubkey: "author" },
        },
      ]);
      statsApi.getPostStats.mockResolvedValue({
        root: {
          likes: 1,
          replies: 0,
          mentions: 0,
          reposts: 0,
          zaps: 0,
          satszapped: 0,
        },
      });
      participantsApi.fetchGiveawayParticipants.mockResolvedValue({
        relatedEvents: [related("fan"), related("muted-pk")],
      });
      userApi.getUserById.mockResolvedValue(
        loaderUser({ filterMuted: true, mutedList })
      );
      const result = await loadGiveawayData("u1", "posts", 7);
      expect(result.relatedEvents.map((item) => item.pubkey)).toEqual(kept);
    });
  });
});
