import { type Giveaway } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface EventRow {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
}

interface EligibleUser {
  id: string;
  npub: string;
  filterMuted: boolean;
  mutedList: unknown;
}

interface Winner {
  pubkey: string;
  npub: string;
  qualifyingActions: Array<{ kind: number; eventId: string }>;
  satsPerWinner?: number;
}

const users = vi.hoisted(() => ({
  getUserById: vi.fn(
    async (_userId: string): Promise<EligibleUser | null> => null
  ),
}));

const loader = vi.hoisted(() => ({
  getParticipantPubkeysForFollowScope: vi.fn(
    async (
      _userId: string,
      _scope: { type: string; reference: Record<string, unknown> },
      _npub: string
    ): Promise<string[]> => []
  ),
  processGiveawayParticipants: vi.fn(
    async (
      events: EventRow[],
      _userId: string,
      _user: {
        id: string;
        npub: string;
        filterMuted: boolean;
        mutedList: { npubs: string[] };
      },
      _options?: { filters?: unknown }
    ): Promise<EventRow[]> => events
  ),
}));

const scopeApi = vi.hoisted(() => ({
  getPostsInScope: vi.fn(
    async (
      _userId: string,
      _scope: { type: string; reference: Record<string, unknown> }
    ): Promise<Array<{ signedEvent: unknown }>> => []
  ),
}));

const selection = vi.hoisted(() => ({
  countEligibleAccountsForEngagementTypes: vi.fn(
    (events: EventRow[], types: string[]): number =>
      events.length + types.length
  ),
  runGiveawayAccountPoolSelection: vi.fn(
    (_events: EventRow[], _winnerCount: number): Winner[] => []
  ),
  runGiveawaySelection: vi.fn(
    (_input: {
      relatedEvents: EventRow[];
      engagementTypes: string[];
      selectionMode: string;
      engagementWeights: unknown;
      winnerCount: number;
    }): Winner[] => []
  ),
  runGiveawaySelectionPerEngagement: vi.fn(
    (_input: {
      relatedEvents: EventRow[];
      engagementConfig: Record<string, unknown>;
      selectionMode: string;
      engagementWeights: unknown;
    }): Winner[] => []
  ),
}));

const singlePost = vi.hoisted(() => ({
  excludeSelfEngagementForScopedRootPosts: vi.fn(
    (events: EventRow[], _roots: Map<string, string>): EventRow[] => events
  ),
  filterRelatedEventsToRootNoteEngagementOnly: vi.fn(
    (events: EventRow[], _rootId: string): EventRow[] => events
  ),
}));

const participants = vi.hoisted(() => ({
  fetchGiveawayParticipants: vi.fn(
    async (_eventIds: unknown[]): Promise<{ relatedEvents: EventRow[] }> => ({
      relatedEvents: [],
    })
  ),
}));

vi.mock("~/features/user", () => ({ getUserById: users.getUserById }));
vi.mock("~/features/giveaway/giveaway-loader.server", () => loader);
vi.mock("~/features/giveaway/giveaway-scope.server", () => scopeApi);
vi.mock("~/features/giveaway/giveaway-selection.server", () => selection);
vi.mock(
  "~/features/giveaway/giveaway-single-post-engagement.server",
  () => singlePost
);
vi.mock("~/features/giveaway/giveaway.server", () => participants);

import {
  eligibleAccountCountForPreviewMeta,
  getEligibleParticipantsForGiveaway,
  relatedEventsFromPubkeys,
  runSelectionForGiveaway,
  scopeFromGiveaway,
} from "~/features/giveaway/giveaway-actions-eligibility.server";
import { DEFAULT_ENGAGEMENT_TYPES } from "~/features/giveaway/giveaway-actions-shared.server";

function giveaway(overrides: Partial<Giveaway> = {}): Giveaway {
  const row: Giveaway = {
    id: "giveaway-1",
    userId: "user-1",
    name: "Spring",
    scopeType: "PERIOD",
    scopeReference: { days: 7 },
    eligibilityFrom: null,
    eligibilityTo: null,
    engagementTypes: ["REACTION"],
    winnerCount: 2,
    engagementConfig: null,
    selectionMode: "UNIQUE_USER",
    engagementWeights: null,
    filters: null,
    status: "DRAFT",
    lockedAt: null,
    lockedByUserId: null,
    plannedPayoutSats: null,
    finalizationFeeRateBps: null,
    finalizationFeeSats: null,
    finalizationFeeStatus: null,
    planAtFinalization: null,
    lockConfigHash: null,
    winnerSnapshot: null,
    payoutState: null,
    payoutWalletMode: "manual",
    payoutAutoRunEnabled: false,
    payoutAutoRunSpendCapSats: null,
    lastPreviewMeta: null,
    rerollCount: 0,
    activityLog: null,
    excludedPubkeys: null,
    createdAt: new Date("2099-01-01T00:00:00.000Z"),
    updatedAt: new Date("2099-01-02T00:00:00.000Z"),
    ...overrides,
  };
  return row;
}

function isGiveaway(value: object): value is Giveaway {
  return "id" in value && "scopeType" in value;
}

function withScopeType(row: Giveaway, scopeType: string): Giveaway {
  const next = { ...row, scopeType };
  if (!isGiveaway(next)) throw new Error("bad scope fixture");
  return next;
}

function event(id: string, pubkey = "pubkey-1"): EventRow {
  return { id, pubkey, created_at: 10, kind: 1 };
}

function account(): EligibleUser {
  return {
    id: "user-1",
    npub: "ab".repeat(32),
    filterMuted: true,
    mutedList: { npubs: ["npub1mute"] },
  };
}

describe("scopeFromGiveaway and follow events", () => {
  it("builds each scope and falls back when reference fields are missing", () => {
    const from = "2099-01-01T00:00:00.000Z";
    const to = "2099-02-01T00:00:00.000Z";
    expect(
      scopeFromGiveaway(
        giveaway({
          scopeType: "PERIOD",
          scopeReference: { days: 14, from, to, queueId: "  queue-1  " },
        })
      )
    ).toEqual({
      type: "PERIOD",
      reference: {
        days: 14,
        from: new Date(from),
        to: new Date(to),
        queueId: "  queue-1  ",
      },
    });
    expect(
      scopeFromGiveaway(
        giveaway({
          scopeReference: { days: "7", from: "", to: null, queueId: "   " },
        })
      )
    ).toEqual({
      type: "PERIOD",
      reference: {
        days: 7,
        from: undefined,
        to: undefined,
        queueId: undefined,
      },
    });
    expect(
      scopeFromGiveaway(giveaway({ scopeReference: { days: 0, queueId: 12 } }))
    ).toEqual({
      type: "PERIOD",
      reference: {
        days: 0,
        from: undefined,
        to: undefined,
        queueId: undefined,
      },
    });
    expect(
      scopeFromGiveaway(
        giveaway({ scopeType: "SINGLE_POST", scopeReference: { postId: 12 } })
      )
    ).toEqual({ type: "SINGLE_POST", reference: { postId: "12" } });
    expect(
      scopeFromGiveaway(
        giveaway({ scopeType: "SINGLE_POST", scopeReference: {} })
      )
    ).toEqual({ type: "SINGLE_POST", reference: { postId: "" } });
    expect(
      scopeFromGiveaway(
        giveaway({
          scopeType: "QUEUE",
          scopeReference: { queueId: "q1", from, to },
        })
      )
    ).toEqual({
      type: "QUEUE",
      reference: { queueId: "q1", from: new Date(from), to: new Date(to) },
    });
    expect(
      scopeFromGiveaway(giveaway({ scopeType: "QUEUE", scopeReference: {} }))
    ).toEqual({
      type: "QUEUE",
      reference: { queueId: "", from: undefined, to: undefined },
    });
    expect(
      scopeFromGiveaway(
        giveaway({ scopeType: "FOLLOWERS", scopeReference: { days: 3 } })
      )
    ).toEqual({ type: "FOLLOWERS", reference: {} });
    expect(
      scopeFromGiveaway(
        giveaway({ scopeType: "FOLLOWING", scopeReference: {} })
      )
    ).toEqual({ type: "FOLLOWING", reference: {} });
    expect(scopeFromGiveaway(withScopeType(giveaway(), "ARCHIVE"))).toEqual({
      type: "PERIOD",
      reference: { days: 7 },
    });
  });

  it("builds a kind-7 event per follow pubkey", () => {
    expect(relatedEventsFromPubkeys(["aa", "bb"])).toEqual([
      { id: "follow-aa-0", pubkey: "aa", created_at: 0, kind: 7 },
      { id: "follow-bb-1", pubkey: "bb", created_at: 0, kind: 7 },
    ]);
    expect(relatedEventsFromPubkeys([])).toEqual([]);
  });
});

describe("getEligibleParticipantsForGiveaway", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    users.getUserById.mockResolvedValue(account());
    loader.getParticipantPubkeysForFollowScope.mockResolvedValue([]);
    loader.processGiveawayParticipants.mockImplementation(
      async (events) => events
    );
    scopeApi.getPostsInScope.mockResolvedValue([]);
    participants.fetchGiveawayParticipants.mockResolvedValue({
      relatedEvents: [],
    });
    singlePost.filterRelatedEventsToRootNoteEngagementOnly.mockImplementation(
      (events) => events
    );
    singlePost.excludeSelfEngagementForScopedRootPosts.mockImplementation(
      (events) => events
    );
  });

  it("throws when the user does not exist and propagates lookup failures", async () => {
    users.getUserById.mockResolvedValueOnce(null);
    await expect(
      getEligibleParticipantsForGiveaway("user-1", giveaway())
    ).rejects.toThrow("User not found");
    expect(scopeApi.getPostsInScope).not.toHaveBeenCalled();

    users.getUserById.mockRejectedValueOnce(new Error("user down"));
    await expect(
      getEligibleParticipantsForGiveaway("user-1", giveaway())
    ).rejects.toThrow("user down");
    users.getUserById.mockRejectedValueOnce("user string");
    await expect(
      getEligibleParticipantsForGiveaway("user-1", giveaway())
    ).rejects.toBe("user string");
  });

  it("normalizes muted lists and passes filters for follower pools", async () => {
    const cases: Array<{ mutedList: unknown; npubs: string[] }> = [
      { mutedList: { npubs: ["npub1mute"] }, npubs: ["npub1mute"] },
      { mutedList: { npubs: "nope" }, npubs: [] },
      { mutedList: ["npub1mute"], npubs: [] },
      { mutedList: null, npubs: [] },
      { mutedList: { other: true }, npubs: [] },
      { mutedList: "muted", npubs: [] },
    ];
    for (const item of cases) {
      users.getUserById.mockResolvedValueOnce({
        ...account(),
        mutedList: item.mutedList,
      });
      loader.getParticipantPubkeysForFollowScope.mockResolvedValueOnce([
        "pk-1",
      ]);
      await getEligibleParticipantsForGiveaway(
        "user-1",
        giveaway({ scopeType: "FOLLOWERS", scopeReference: {} })
      );
      const call = loader.processGiveawayParticipants.mock.calls.at(-1);
      expect(call?.[2].mutedList).toEqual({ npubs: item.npubs });
    }

    users.getUserById.mockResolvedValueOnce(account());
    loader.getParticipantPubkeysForFollowScope.mockResolvedValueOnce([
      "pk-1",
      "pk-2",
    ]);
    const row = giveaway({
      scopeType: "FOLLOWING",
      scopeReference: {},
      filters: { excludeMuted: true },
    });
    await expect(
      getEligibleParticipantsForGiveaway("user-1", row)
    ).resolves.toEqual({
      relatedEvents: relatedEventsFromPubkeys(["pk-1", "pk-2"]),
    });
    expect(loader.getParticipantPubkeysForFollowScope).toHaveBeenCalledWith(
      "user-1",
      { type: "FOLLOWING", reference: {} },
      account().npub
    );
    expect(loader.processGiveawayParticipants.mock.calls.at(-1)?.[3]).toEqual({
      filters: { excludeMuted: true },
    });
    expect(scopeApi.getPostsInScope).not.toHaveBeenCalled();
  });

  it("returns no events when the scope has no signed ids", async () => {
    scopeApi.getPostsInScope.mockResolvedValueOnce([]);
    await expect(
      getEligibleParticipantsForGiveaway("user-1", giveaway())
    ).resolves.toEqual({ relatedEvents: [] });
    scopeApi.getPostsInScope.mockResolvedValueOnce([
      { signedEvent: null },
      { signedEvent: "note" },
      { signedEvent: [] },
      { signedEvent: { pubkey: "author" } },
    ]);
    await expect(
      getEligibleParticipantsForGiveaway("user-1", giveaway())
    ).resolves.toEqual({ relatedEvents: [] });
    expect(participants.fetchGiveawayParticipants).not.toHaveBeenCalled();
  });

  it("keeps valid root authors and filters a single post down to that note", async () => {
    const fetched = [event("rel-1", "fan")];
    const filtered = [event("filtered", "fan")];
    const excluded = [event("excluded", "fan")];
    const processed = [event("processed", "fan")];
    scopeApi.getPostsInScope.mockResolvedValueOnce([
      { signedEvent: null },
      { signedEvent: { id: "   ", pubkey: "   " } },
      { signedEvent: { id: 5, pubkey: "author-number" } },
      { signedEvent: { id: "evt-1", pubkey: "author-1" } },
      { signedEvent: { id: "evt-2", pubkey: "" } },
    ]);
    participants.fetchGiveawayParticipants.mockResolvedValueOnce({
      relatedEvents: fetched,
    });
    singlePost.filterRelatedEventsToRootNoteEngagementOnly.mockReturnValueOnce(
      filtered
    );
    singlePost.excludeSelfEngagementForScopedRootPosts.mockReturnValueOnce(
      excluded
    );
    loader.processGiveawayParticipants.mockResolvedValueOnce(processed);

    await expect(
      getEligibleParticipantsForGiveaway(
        "user-1",
        giveaway({
          scopeType: "PERIOD",
          filters: null,
        })
      )
    ).resolves.toEqual({ relatedEvents: processed });
    expect(participants.fetchGiveawayParticipants).toHaveBeenCalledWith([
      "   ",
      5,
      "evt-1",
      "evt-2",
    ]);
    expect(
      singlePost.filterRelatedEventsToRootNoteEngagementOnly
    ).not.toHaveBeenCalled();
    expect(
      singlePost.excludeSelfEngagementForScopedRootPosts
    ).toHaveBeenCalledWith(fetched, new Map([["evt-1", "author-1"]]));
    expect(
      loader.processGiveawayParticipants.mock.calls[0]?.[3]
    ).toBeUndefined();

    scopeApi.getPostsInScope.mockResolvedValueOnce([
      { signedEvent: { id: "root-1", pubkey: "author-1" } },
    ]);
    participants.fetchGiveawayParticipants.mockResolvedValueOnce({
      relatedEvents: fetched,
    });
    await getEligibleParticipantsForGiveaway(
      "user-1",
      giveaway({
        scopeType: "SINGLE_POST",
        scopeReference: { postId: "post-1" },
        filters: {},
      })
    );
    expect(
      singlePost.filterRelatedEventsToRootNoteEngagementOnly
    ).toHaveBeenCalledWith(fetched, "root-1");
    expect(loader.processGiveawayParticipants.mock.calls.at(-1)?.[3]).toEqual({
      filters: {},
    });
  });

  it("does not narrow engagement when a single post has several ids", async () => {
    scopeApi.getPostsInScope.mockResolvedValueOnce([
      { signedEvent: { id: "root-1", pubkey: "author-1" } },
      { signedEvent: { id: "root-2", pubkey: "author-2" } },
    ]);
    const fetched = [event("rel-1")];
    participants.fetchGiveawayParticipants.mockResolvedValueOnce({
      relatedEvents: fetched,
    });
    await getEligibleParticipantsForGiveaway(
      "user-1",
      giveaway({
        scopeType: "SINGLE_POST",
        scopeReference: { postId: "post-1" },
      })
    );
    expect(
      singlePost.filterRelatedEventsToRootNoteEngagementOnly
    ).not.toHaveBeenCalled();
    expect(
      singlePost.excludeSelfEngagementForScopedRootPosts
    ).toHaveBeenCalledWith(
      fetched,
      new Map([
        ["root-1", "author-1"],
        ["root-2", "author-2"],
      ])
    );

    scopeApi.getPostsInScope.mockRejectedValueOnce("scope down");
    await expect(
      getEligibleParticipantsForGiveaway("user-1", giveaway())
    ).rejects.toBe("scope down");
    participants.fetchGiveawayParticipants.mockRejectedValueOnce(
      new Error("fetch down")
    );
    scopeApi.getPostsInScope.mockResolvedValueOnce([
      { signedEvent: { id: "root-1", pubkey: "author-1" } },
    ]);
    await expect(
      getEligibleParticipantsForGiveaway("user-1", giveaway())
    ).rejects.toThrow("fetch down");
  });
});

describe("runSelectionForGiveaway", () => {
  const events = [event("e1", "p1"), event("e2", "p1"), event("e3", "p2")];
  const pooled: Winner[] = [
    {
      pubkey: "pool",
      npub: "npool",
      qualifyingActions: [{ kind: 7, eventId: "e1" }],
    },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    selection.runGiveawayAccountPoolSelection.mockReturnValue(pooled);
    selection.runGiveawaySelection.mockReturnValue(pooled);
    selection.runGiveawaySelectionPerEngagement.mockReturnValue(pooled);
  });

  it("pays a follower pool the unified amount and otherwise returns the pool", () => {
    expect(
      runSelectionForGiveaway(
        giveaway({
          scopeType: "FOLLOWERS",
          winnerCount: 3,
          engagementConfig: { _simpleUnified: { satsPerWinner: 25 } },
          selectionMode: "WEIGHTED_BY_ENGAGEMENT",
        }),
        events
      )
    ).toEqual([{ ...pooled[0], satsPerWinner: 25 }]);
    expect(selection.runGiveawayAccountPoolSelection).toHaveBeenCalledWith(
      events,
      3
    );
    expect(selection.runGiveawaySelection).not.toHaveBeenCalled();

    const same = runSelectionForGiveaway(
      giveaway({
        scopeType: "FOLLOWING",
        winnerCount: 1,
        engagementConfig: { _simpleUnified: { satsPerWinner: 0 } },
      }),
      events
    );
    expect(same).toBe(pooled);
    expect(
      runSelectionForGiveaway(
        giveaway({
          scopeType: "FOLLOWERS",
          engagementConfig: { REACTION: { winnerCount: 1, satsPerWinner: 5 } },
        }),
        events
      )
    ).toBe(pooled);
  });

  it("applies a simple unified amount, including zero, on engagement scopes", () => {
    expect(
      runSelectionForGiveaway(
        giveaway({
          scopeType: "PERIOD",
          engagementTypes: ["ZAP"],
          engagementConfig: { _simpleUnified: { satsPerWinner: 10 } },
          selectionMode: "WEIGHTED_BY_ENGAGEMENT",
          engagementWeights: { ZAP: 2 },
          winnerCount: 4,
        }),
        events
      )
    ).toEqual([{ ...pooled[0], satsPerWinner: 10 }]);
    expect(selection.runGiveawaySelection).toHaveBeenCalledWith({
      relatedEvents: events,
      engagementTypes: ["ZAP"],
      selectionMode: "WEIGHTED_BY_ENGAGEMENT",
      engagementWeights: { ZAP: 2 },
      winnerCount: 4,
    });

    expect(
      runSelectionForGiveaway(
        giveaway({
          engagementTypes: [],
          engagementConfig: { _simpleUnified: { satsPerWinner: 0 } },
          engagementWeights: null,
        }),
        events
      )
    ).toEqual([{ ...pooled[0], satsPerWinner: undefined }]);
    expect(selection.runGiveawaySelection.mock.calls.at(-1)?.[0]).toMatchObject(
      {
        engagementTypes: [...DEFAULT_ENGAGEMENT_TYPES],
        engagementWeights: null,
      }
    );
  });

  it("uses per-engagement selection when the config has types and plain selection otherwise", () => {
    const config = {
      REACTION: { winnerCount: 1, satsPerWinner: 5 },
      COMMENT: { winnerCount: 2, satsPerWinner: 9 },
    };
    expect(
      runSelectionForGiveaway(
        giveaway({
          scopeType: "QUEUE",
          engagementConfig: config,
          selectionMode: "UNIQUE_USER",
          engagementWeights: { COMMENT: 3 },
        }),
        events
      )
    ).toBe(pooled);
    expect(selection.runGiveawaySelectionPerEngagement).toHaveBeenCalledWith({
      relatedEvents: events,
      engagementConfig: config,
      selectionMode: "UNIQUE_USER",
      engagementWeights: { COMMENT: 3 },
    });
    expect(selection.runGiveawaySelection).not.toHaveBeenCalled();

    expect(
      runSelectionForGiveaway(
        giveaway({ engagementConfig: {}, engagementTypes: ["REPOST"] }),
        events
      )
    ).toBe(pooled);
    expect(selection.runGiveawaySelection).toHaveBeenCalledWith({
      relatedEvents: events,
      engagementTypes: ["REPOST"],
      selectionMode: "UNIQUE_USER",
      engagementWeights: null,
      winnerCount: 2,
    });
  });
});

describe("eligibleAccountCountForPreviewMeta", () => {
  const events = [event("e1", "p1"), event("e2", "p1"), event("e3", "p2")];

  beforeEach(() => {
    vi.resetAllMocks();
    selection.countEligibleAccountsForEngagementTypes.mockImplementation(
      (rows, types) => rows.length + types.length
    );
  });

  it("counts unique follow pubkeys without asking the engagement counter", () => {
    expect(
      eligibleAccountCountForPreviewMeta(
        giveaway({ scopeType: "FOLLOWERS" }),
        events
      )
    ).toBe(2);
    expect(
      eligibleAccountCountForPreviewMeta(
        giveaway({ scopeType: "FOLLOWING" }),
        []
      )
    ).toBe(0);
    expect(
      selection.countEligibleAccountsForEngagementTypes
    ).not.toHaveBeenCalled();
  });

  it("counts simple, configured, and default engagement types", () => {
    expect(
      eligibleAccountCountForPreviewMeta(
        giveaway({
          engagementConfig: { _simpleUnified: { satsPerWinner: 5 } },
          engagementTypes: ["ZAP", "COMMENT"],
        }),
        events
      )
    ).toBe(5);
    expect(
      selection.countEligibleAccountsForEngagementTypes
    ).toHaveBeenCalledWith(events, ["ZAP", "COMMENT"]);

    expect(
      eligibleAccountCountForPreviewMeta(
        giveaway({
          engagementConfig: {
            REACTION: { winnerCount: 1, satsPerWinner: 1 },
            REPOST: { winnerCount: 1, satsPerWinner: 1 },
          },
          engagementTypes: [],
        }),
        events
      )
    ).toBe(5);
    expect(
      selection.countEligibleAccountsForEngagementTypes.mock.calls.at(-1)?.[1]
    ).toEqual(["REACTION", "REPOST"]);

    expect(
      eligibleAccountCountForPreviewMeta(
        giveaway({ engagementConfig: {}, engagementTypes: [] }),
        events
      )
    ).toBe(events.length + DEFAULT_ENGAGEMENT_TYPES.length);
    expect(
      selection.countEligibleAccountsForEngagementTypes.mock.calls.at(-1)?.[1]
    ).toEqual([...DEFAULT_ENGAGEMENT_TYPES]);
  });
});
