import { beforeEach, describe, expect, it, vi } from "vitest";

interface Rel {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags?: string[][];
}

interface WinnerShape {
  pubkey: string;
  npub: string;
  qualifyingActions: Array<{ kind: number; eventId: string }>;
  satsPerWinner?: number;
}

interface LoaderUser {
  id: string;
  npub?: string;
  filterMuted?: boolean;
  mutedList?: unknown;
  hidePostsFromLowTrustUsers?: boolean;
}

interface PassedUser {
  id: string;
  npub?: string;
  filterMuted?: boolean;
  mutedList: { npubs: string[] };
  hidePostsFromLowTrustUsers?: boolean;
}

const userApi = vi.hoisted(() => ({
  getUserById: vi.fn(
    async (_userId: string): Promise<LoaderUser | null> => null
  ),
}));

const loader = vi.hoisted(() => ({
  getParticipantPubkeysForFollowScope: vi.fn(
    async (
      _userId: string,
      _scope: { type: string },
      _npub: string
    ): Promise<string[]> => []
  ),
  processGiveawayParticipants: vi.fn(
    async (
      events: Rel[],
      _userId: string,
      _user: PassedUser,
      _options?: { filters?: Record<string, unknown> }
    ): Promise<Rel[]> => events
  ),
}));

const scopeApi = vi.hoisted(() => ({
  getPostsInScope: vi.fn(
    async (
      _userId: string,
      _scope: { type: string }
    ): Promise<Array<{ signedEvent?: unknown }>> => []
  ),
}));

const selection = vi.hoisted(() => ({
  countEligibleAccountsForEngagementTypes: vi.fn(
    (_events: Array<{ pubkey: string }>, _types: string[]): number => 0
  ),
  runGiveawayAccountPoolSelection: vi.fn(
    (_events: Array<{ pubkey: string }>, _count: number): WinnerShape[] => []
  ),
  runGiveawaySelection: vi.fn(
    (_input: {
      relatedEvents: Array<{ pubkey: string }>;
      engagementTypes: string[];
      selectionMode: string;
      engagementWeights?: Record<string, number>;
      winnerCount: number;
    }): WinnerShape[] => []
  ),
  runGiveawaySelectionPerEngagement: vi.fn(
    (_input: {
      relatedEvents: Array<{ pubkey: string }>;
      engagementConfig: Record<string, unknown>;
      selectionMode: string;
      engagementWeights?: Record<string, number>;
    }): WinnerShape[] => []
  ),
}));

const singlePost = vi.hoisted(() => ({
  excludeSelfEngagementForScopedRootPosts: vi.fn(
    (events: Rel[], _map: Map<string, string>): Rel[] => events
  ),
  filterRelatedEventsToRootNoteEngagementOnly: vi.fn(
    (events: Rel[], _rootId: string): Rel[] => events
  ),
}));

const participantsApi = vi.hoisted(() => ({
  fetchGiveawayParticipants: vi.fn(
    async (_ids: readonly unknown[]): Promise<{ relatedEvents: Rel[] }> => ({
      relatedEvents: [],
    })
  ),
}));

vi.mock("~/features/user", () => userApi);
vi.mock("~/features/giveaway/giveaway-loader.server", () => loader);
vi.mock("~/features/giveaway/giveaway-scope.server", () => scopeApi);
vi.mock("~/features/giveaway/giveaway-selection.server", () => selection);
vi.mock(
  "~/features/giveaway/giveaway-single-post-engagement.server",
  () => singlePost
);
vi.mock("~/features/giveaway/giveaway.server", () => participantsApi);

import type { Giveaway } from "~/features/giveaway/data/giveaway-prisma-types.server";
import {
  eligibleAccountCountForPreviewMeta,
  getEligibleParticipantsForGiveaway,
  relatedEventsFromPubkeys,
  runSelectionForGiveaway,
  scopeFromGiveaway,
} from "~/features/giveaway/giveaway-actions-eligibility.server";
import type { RelatedEvent } from "~/features/giveaway/types";

function draft(overrides: Record<string, unknown> = {}): Giveaway {
  const base: Record<string, unknown> = {
    id: "g1",
    userId: "u1",
    status: "DRAFT",
    scopeType: "PERIOD",
    scopeReference: { days: 7 },
    winnerCount: 1,
    engagementTypes: ["REACTION"],
    selectionMode: "UNIQUE_USER",
    engagementConfig: null,
    engagementWeights: null,
    filters: null,
  };
  const merged: Record<string, unknown> = { ...base, ...overrides };
  return merged as Giveaway;
}

function related(pubkey: string, id = pubkey): RelatedEvent {
  return { id, pubkey, created_at: 1, kind: 7 };
}

const DEFAULT_TYPES = ["REACTION", "REPOST", "COMMENT", "ZAP"];

describe("giveaway-actions-eligibility.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userApi.getUserById.mockResolvedValue({
      id: "u1",
      npub: "npub1user",
      filterMuted: false,
      mutedList: null,
    });
    loader.getParticipantPubkeysForFollowScope.mockResolvedValue([]);
    loader.processGiveawayParticipants.mockImplementation(
      async (events) => events
    );
    scopeApi.getPostsInScope.mockResolvedValue([]);
    selection.countEligibleAccountsForEngagementTypes.mockReturnValue(0);
    selection.runGiveawayAccountPoolSelection.mockReturnValue([]);
    selection.runGiveawaySelection.mockReturnValue([]);
    selection.runGiveawaySelectionPerEngagement.mockReturnValue([]);
    singlePost.excludeSelfEngagementForScopedRootPosts.mockImplementation(
      (events) => events
    );
    singlePost.filterRelatedEventsToRootNoteEngagementOnly.mockImplementation(
      (events) => events
    );
    participantsApi.fetchGiveawayParticipants.mockResolvedValue({
      relatedEvents: [],
    });
  });

  describe("scopeFromGiveaway", () => {
    it("reads a full period reference and falls back when fields are unusable", () => {
      const full = scopeFromGiveaway(
        draft({
          scopeType: "PERIOD",
          scopeReference: {
            days: 3,
            from: "2024-01-02T00:00:00.000Z",
            to: "2024-02-03T00:00:00.000Z",
            queueId: "q1",
          },
        })
      );
      expect(full.type).toBe("PERIOD");
      if (full.type !== "PERIOD") throw new Error("expected period");
      expect(full.reference.days).toBe(3);
      expect(full.reference.queueId).toBe("q1");
      expect(full.reference.from?.toISOString()).toBe(
        "2024-01-02T00:00:00.000Z"
      );
      expect(full.reference.to?.toISOString()).toBe("2024-02-03T00:00:00.000Z");

      const fallback = scopeFromGiveaway(
        draft({
          scopeType: "PERIOD",
          scopeReference: { days: "7", from: "", to: 0, queueId: "   " },
        })
      );
      expect(fallback.type).toBe("PERIOD");
      if (fallback.type !== "PERIOD") throw new Error("expected period");
      expect(fallback.reference.days).toBe(7);
      expect(fallback.reference.from).toBeUndefined();
      expect(fallback.reference.to).toBeUndefined();
      expect(fallback.reference.queueId).toBeUndefined();

      const numericQueue = scopeFromGiveaway(
        draft({
          scopeType: "PERIOD",
          scopeReference: { queueId: 4 },
        })
      );
      if (numericQueue.type !== "PERIOD") throw new Error("expected period");
      expect(numericQueue.reference.queueId).toBeUndefined();
    });

    it("stringifies single-post and queue ids", () => {
      const missingPost = scopeFromGiveaway(
        draft({ scopeType: "SINGLE_POST", scopeReference: {} })
      );
      expect(missingPost).toEqual({
        type: "SINGLE_POST",
        reference: { postId: "" },
      });
      const numericPost = scopeFromGiveaway(
        draft({ scopeType: "SINGLE_POST", scopeReference: { postId: 12 } })
      );
      expect(numericPost).toEqual({
        type: "SINGLE_POST",
        reference: { postId: "12" },
      });

      const missingQueue = scopeFromGiveaway(
        draft({ scopeType: "QUEUE", scopeReference: {} })
      );
      expect(missingQueue.type).toBe("QUEUE");
      if (missingQueue.type !== "QUEUE") throw new Error("expected queue");
      expect(missingQueue.reference.queueId).toBe("");

      const zeroQueue = scopeFromGiveaway(
        draft({
          scopeType: "QUEUE",
          scopeReference: {
            queueId: 0,
            from: "2024-03-01T00:00:00.000Z",
            to: "",
          },
        })
      );
      if (zeroQueue.type !== "QUEUE") throw new Error("expected queue");
      expect(zeroQueue.reference.queueId).toBe("0");
      expect(zeroQueue.reference.from?.toISOString()).toBe(
        "2024-03-01T00:00:00.000Z"
      );
      expect(zeroQueue.reference.to).toBeUndefined();
    });

    it("returns follow scopes and a period default for an unknown type", () => {
      expect(
        scopeFromGiveaway(draft({ scopeType: "FOLLOWERS", scopeReference: {} }))
      ).toEqual({ type: "FOLLOWERS", reference: {} });
      expect(
        scopeFromGiveaway(draft({ scopeType: "FOLLOWING", scopeReference: {} }))
      ).toEqual({ type: "FOLLOWING", reference: {} });
      const unknown = scopeFromGiveaway(
        draft({ scopeType: "NOPE", scopeReference: { days: 1 } })
      );
      expect(unknown).toEqual({ type: "PERIOD", reference: { days: 7 } });
    });
  });

  describe("relatedEventsFromPubkeys", () => {
    it("builds kind 7 placeholders", () => {
      expect(relatedEventsFromPubkeys(["aa", "bb"])).toEqual([
        { id: "follow-aa-0", pubkey: "aa", created_at: 0, kind: 7 },
        { id: "follow-bb-1", pubkey: "bb", created_at: 0, kind: 7 },
      ]);
      expect(relatedEventsFromPubkeys([])).toEqual([]);
    });
  });

  describe("getEligibleParticipantsForGiveaway", () => {
    it("throws when the user does not exist", async () => {
      userApi.getUserById.mockResolvedValue(null);
      await expect(
        getEligibleParticipantsForGiveaway("u1", draft())
      ).rejects.toThrow("User not found");
      expect(scopeApi.getPostsInScope).not.toHaveBeenCalled();
    });

    it.each([
      { label: "null", mutedList: null, npubs: [] as string[] },
      { label: "array", mutedList: ["raw"], npubs: [] as string[] },
      {
        label: "npubs",
        mutedList: { npubs: ["a", "b"] },
        npubs: ["a", "b"],
      },
      { label: "string npubs", mutedList: { npubs: "no" }, npubs: [] },
      { label: "other keys", mutedList: { other: 1 }, npubs: [] },
      { label: "number", mutedList: 3, npubs: [] },
    ])("normalizes mutedList ($label)", async ({ mutedList, npubs }) => {
      userApi.getUserById.mockResolvedValue({
        id: "u1",
        npub: "npub1user",
        filterMuted: true,
        mutedList,
        hidePostsFromLowTrustUsers: true,
      });
      loader.getParticipantPubkeysForFollowScope.mockResolvedValue(["p1"]);
      await getEligibleParticipantsForGiveaway(
        "u1",
        draft({ scopeType: "FOLLOWERS", scopeReference: {}, filters: null })
      );
      const passed = loader.processGiveawayParticipants.mock.calls[0]?.[2];
      expect(passed?.mutedList).toEqual({ npubs });
      expect(passed?.filterMuted).toBe(true);
      expect(passed?.hidePostsFromLowTrustUsers).toBe(true);
      expect(passed?.id).toBe("u1");
      expect(passed?.npub).toBe("npub1user");
    });

    it("loads follow-graph pubkeys and skips post lookup", async () => {
      loader.getParticipantPubkeysForFollowScope.mockResolvedValue([
        "p1",
        "p2",
      ]);
      const followers = await getEligibleParticipantsForGiveaway(
        "u1",
        draft({
          scopeType: "FOLLOWERS",
          scopeReference: {},
          filters: { excludeMuted: true },
        })
      );
      expect(followers.relatedEvents.map((event) => event.pubkey)).toEqual([
        "p1",
        "p2",
      ]);
      expect(followers.relatedEvents.every((event) => event.kind === 7)).toBe(
        true
      );
      expect(loader.getParticipantPubkeysForFollowScope).toHaveBeenCalledWith(
        "u1",
        { type: "FOLLOWERS", reference: {} },
        "npub1user"
      );
      expect(scopeApi.getPostsInScope).not.toHaveBeenCalled();
      expect(loader.processGiveawayParticipants.mock.calls[0]?.[3]).toEqual({
        filters: { excludeMuted: true },
      });

      loader.getParticipantPubkeysForFollowScope.mockClear();
      await getEligibleParticipantsForGiveaway(
        "u1",
        draft({ scopeType: "FOLLOWING", scopeReference: {}, filters: {} })
      );
      expect(loader.getParticipantPubkeysForFollowScope).toHaveBeenCalledWith(
        "u1",
        { type: "FOLLOWING", reference: {} },
        "npub1user"
      );
      expect(loader.processGiveawayParticipants.mock.calls.at(-1)?.[3]).toEqual(
        { filters: {} }
      );
    });

    it("returns no events when scoped posts have no event ids", async () => {
      scopeApi.getPostsInScope.mockResolvedValue([
        { signedEvent: null },
        { signedEvent: "x" },
        { signedEvent: { nope: true } },
      ]);
      const result = await getEligibleParticipantsForGiveaway("u1", draft());
      expect(result).toEqual({ relatedEvents: [] });
      expect(participantsApi.fetchGiveawayParticipants).not.toHaveBeenCalled();
      expect(loader.processGiveawayParticipants).not.toHaveBeenCalled();
    });

    it("builds the root-author map and skips single-post filtering for period scope", async () => {
      scopeApi.getPostsInScope.mockResolvedValue([
        { signedEvent: null },
        { signedEvent: "x" },
        { signedEvent: { nope: true } },
        { signedEvent: { id: "  ", pubkey: "author" } },
        { signedEvent: { id: "root", pubkey: "   " } },
        { signedEvent: { id: 5, pubkey: "author" } },
        { signedEvent: { id: "root", pubkey: "author" } },
        { signedEvent: { id: "root2", pubkey: "author2" } },
      ]);
      participantsApi.fetchGiveawayParticipants.mockResolvedValue({
        relatedEvents: [related("fan", "e-fan")],
      });
      const result = await getEligibleParticipantsForGiveaway(
        "u1",
        draft({ filters: null })
      );
      expect(participantsApi.fetchGiveawayParticipants).toHaveBeenCalledWith([
        "  ",
        "root",
        5,
        "root",
        "root2",
      ]);
      expect(
        singlePost.filterRelatedEventsToRootNoteEngagementOnly
      ).not.toHaveBeenCalled();
      const map =
        singlePost.excludeSelfEngagementForScopedRootPosts.mock.calls[0]?.[1];
      expect(map?.size).toBe(2);
      expect(map?.get("root")).toBe("author");
      expect(map?.get("root2")).toBe("author2");
      expect(map?.has("  ")).toBe(false);
      expect(result.relatedEvents.map((event) => event.pubkey)).toEqual([
        "fan",
      ]);
      expect(
        loader.processGiveawayParticipants.mock.calls[0]?.[3]
      ).toBeUndefined();
    });

    it("filters a single string root and keeps numeric or multi-note scopes unfiltered", async () => {
      scopeApi.getPostsInScope.mockResolvedValue([
        { signedEvent: { id: "only", pubkey: "author" } },
      ]);
      participantsApi.fetchGiveawayParticipants.mockResolvedValue({
        relatedEvents: [related("drop"), related("keep")],
      });
      singlePost.filterRelatedEventsToRootNoteEngagementOnly.mockImplementation(
        (events) => events.filter((event) => event.pubkey !== "drop")
      );
      await getEligibleParticipantsForGiveaway(
        "u1",
        draft({
          scopeType: "SINGLE_POST",
          scopeReference: { postId: "only" },
        })
      );
      expect(
        singlePost.filterRelatedEventsToRootNoteEngagementOnly.mock
          .calls[0]?.[1]
      ).toBe("only");
      expect(
        loader.processGiveawayParticipants.mock.calls[0]?.[0].map(
          (event) => event.pubkey
        )
      ).toEqual(["keep"]);

      scopeApi.getPostsInScope.mockResolvedValue([
        { signedEvent: { id: 9, pubkey: "author" } },
      ]);
      singlePost.filterRelatedEventsToRootNoteEngagementOnly.mockClear();
      await getEligibleParticipantsForGiveaway(
        "u1",
        draft({ scopeType: "SINGLE_POST", scopeReference: { postId: "9" } })
      );
      expect(
        singlePost.filterRelatedEventsToRootNoteEngagementOnly
      ).not.toHaveBeenCalled();

      scopeApi.getPostsInScope.mockResolvedValue([
        { signedEvent: { id: "a", pubkey: "author" } },
        { signedEvent: { id: "b", pubkey: "author" } },
      ]);
      await getEligibleParticipantsForGiveaway(
        "u1",
        draft({ scopeType: "SINGLE_POST", scopeReference: { postId: "a" } })
      );
      expect(
        singlePost.filterRelatedEventsToRootNoteEngagementOnly
      ).not.toHaveBeenCalled();
    });
  });

  describe("runSelectionForGiveaway", () => {
    const selected: WinnerShape = {
      pubkey: "p1",
      npub: "npub1",
      qualifyingActions: [{ kind: 7, eventId: "e1" }],
    };

    it("attaches positive unified sats for follow-graph pools", () => {
      const events = [related("p1"), related("p2")];
      selection.runGiveawayAccountPoolSelection.mockReturnValue([selected]);
      const winners = runSelectionForGiveaway(
        draft({
          scopeType: "FOLLOWERS",
          scopeReference: {},
          winnerCount: 2,
          engagementConfig: { _simpleUnified: { satsPerWinner: 21 } },
        }),
        events
      );
      expect(winners).toEqual([{ ...selected, satsPerWinner: 21 }]);
      expect(selection.runGiveawayAccountPoolSelection).toHaveBeenCalledWith(
        events,
        2
      );

      selection.runGiveawayAccountPoolSelection.mockReturnValue([selected]);
      const zero = runSelectionForGiveaway(
        draft({
          scopeType: "FOLLOWING",
          scopeReference: {},
          winnerCount: 1,
          engagementConfig: { _simpleUnified: { satsPerWinner: 0 } },
        }),
        events
      );
      const first = zero[0];
      expect(first).toEqual(selected);
      if (!first) throw new Error("missing winner");
      expect(Object.hasOwn(first, "satsPerWinner")).toBe(false);

      const plain = runSelectionForGiveaway(
        draft({
          scopeType: "FOLLOWERS",
          scopeReference: {},
          engagementConfig: null,
        }),
        events
      );
      expect(plain).toEqual([selected]);
    });

    it("selects one pool for simple unified config and defaults empty engagement types", () => {
      const events = [related("p1")];
      selection.runGiveawaySelection.mockReturnValue([selected]);
      const winners = runSelectionForGiveaway(
        draft({
          engagementConfig: { _simpleUnified: { satsPerWinner: 8 } },
          engagementTypes: [],
          engagementWeights: { ZAP: 3 },
          selectionMode: "WEIGHTED_BY_ENGAGEMENT",
          winnerCount: 4,
        }),
        events
      );
      expect(winners[0]?.satsPerWinner).toBe(8);
      const call = selection.runGiveawaySelection.mock.calls[0]?.[0];
      expect(call?.engagementTypes).toEqual(DEFAULT_TYPES);
      expect(call?.selectionMode).toBe("WEIGHTED_BY_ENGAGEMENT");
      expect(call?.engagementWeights).toEqual({ ZAP: 3 });
      expect(call?.winnerCount).toBe(4);
      expect(call?.relatedEvents).toBe(events);

      selection.runGiveawaySelection.mockClear();
      runSelectionForGiveaway(
        draft({
          engagementConfig: { _simpleUnified: { satsPerWinner: 8 } },
          engagementTypes: ["ZAP"],
        }),
        events
      );
      expect(
        selection.runGiveawaySelection.mock.calls[0]?.[0].engagementTypes
      ).toEqual(["ZAP"]);

      const cleared = runSelectionForGiveaway(
        draft({
          engagementConfig: { _simpleUnified: { satsPerWinner: 0 } },
          engagementTypes: ["REACTION"],
        }),
        events
      );
      const row = cleared[0];
      if (!row) throw new Error("missing winner");
      expect(Object.hasOwn(row, "satsPerWinner")).toBe(true);
      expect(row.satsPerWinner).toBeUndefined();
    });

    it("uses per-engagement selection only for a non-empty typed config", () => {
      const events = [related("p1")];
      const per = [{ ...selected, satsPerWinner: 4 }];
      selection.runGiveawaySelectionPerEngagement.mockReturnValue(per);
      const config = {
        ZAP: { winnerCount: 1, satsPerWinner: 4 },
        REACTION: { winnerCount: 2, satsPerWinner: 1 },
      };
      const winners = runSelectionForGiveaway(
        draft({ engagementConfig: config, selectionMode: "UNIQUE_USER" }),
        events
      );
      expect(winners).toBe(per);
      expect(selection.runGiveawaySelection).not.toHaveBeenCalled();
      expect(
        selection.runGiveawaySelectionPerEngagement.mock.calls[0]?.[0]
          .engagementConfig
      ).toBe(config);

      selection.runGiveawaySelectionPerEngagement.mockClear();
      selection.runGiveawaySelection.mockReturnValue([selected]);
      runSelectionForGiveaway(draft({ engagementConfig: {} }), events);
      runSelectionForGiveaway(draft({ engagementConfig: null }), events);
      expect(
        selection.runGiveawaySelectionPerEngagement
      ).not.toHaveBeenCalled();
      expect(selection.runGiveawaySelection).toHaveBeenCalledTimes(2);
    });
  });

  describe("eligibleAccountCountForPreviewMeta", () => {
    const events = [related("a"), related("a", "e2"), related("b")];

    it("counts unique follow-graph pubkeys without the engagement counter", () => {
      expect(
        eligibleAccountCountForPreviewMeta(
          draft({ scopeType: "FOLLOWERS", scopeReference: {} }),
          events
        )
      ).toBe(2);
      expect(
        eligibleAccountCountForPreviewMeta(
          draft({ scopeType: "FOLLOWING", scopeReference: {} }),
          events
        )
      ).toBe(2);
      expect(
        selection.countEligibleAccountsForEngagementTypes
      ).not.toHaveBeenCalled();
    });

    it("counts simple, per-type, and default engagement sets", () => {
      selection.countEligibleAccountsForEngagementTypes.mockReturnValue(6);
      expect(
        eligibleAccountCountForPreviewMeta(
          draft({
            engagementConfig: {
              _simpleUnified: { satsPerWinner: 1 },
              REACTION: { winnerCount: 1, satsPerWinner: 1 },
            },
            engagementTypes: ["COMMENT"],
          }),
          events
        )
      ).toBe(6);
      expect(
        selection.countEligibleAccountsForEngagementTypes.mock.calls[0]?.[1]
      ).toEqual(["COMMENT"]);

      eligibleAccountCountForPreviewMeta(
        draft({
          engagementConfig: {
            ZAP: { winnerCount: 1, satsPerWinner: 2 },
            REACTION: { winnerCount: 1, satsPerWinner: 3 },
          },
          engagementTypes: ["COMMENT"],
        }),
        events
      );
      expect(
        selection.countEligibleAccountsForEngagementTypes.mock.calls[1]?.[1]
      ).toEqual(["ZAP", "REACTION"]);

      eligibleAccountCountForPreviewMeta(
        draft({ engagementConfig: null, engagementTypes: ["ZAP"] }),
        events
      );
      expect(
        selection.countEligibleAccountsForEngagementTypes.mock.calls[2]?.[1]
      ).toEqual(["ZAP"]);

      eligibleAccountCountForPreviewMeta(
        draft({ engagementConfig: {}, engagementTypes: [] }),
        events
      );
      expect(
        selection.countEligibleAccountsForEngagementTypes.mock.calls[3]?.[1]
      ).toEqual(DEFAULT_TYPES);
    });
  });
});
