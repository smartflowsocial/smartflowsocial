import { nip19 } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface LogFields {
  message: string;
  npub: string;
}

function raise(value: unknown): never {
  throw value;
}

const HEX = "ab".repeat(32);

const adapter = vi.hoisted(() => ({
  decodeNpub: vi.fn((_npub: string): string | null => null),
}));

const logger = vi.hoisted(() => ({
  logError: vi.fn((_error: Error, _fields: LogFields) => undefined),
}));

const primal = vi.hoisted(() => ({
  connectToPrimalCache: vi.fn(
    async (
      _requestType: string,
      _params: { pubkey?: string | null }
    ): Promise<unknown[]> => []
  ),
}));

const users = vi.hoisted(() => ({
  createUser: vi.fn(async (_npub: string, _nostrProfile: string) => undefined),
  getUserById: vi.fn(async (_id: string) => null as StoredUser | null),
}));

vi.mock("~/features/cache/primalCache.server", () => ({
  connectToPrimalCache: primal.connectToPrimalCache,
}));
vi.mock("~/features/user", () => ({
  createUser: users.createUser,
  getUserById: users.getUserById,
}));
vi.mock("~/lib/error-logger.server", () => ({
  logError: logger.logError,
}));
vi.mock("~/lib/nostr-adapter.server", () => ({
  nostrAdapter: { decodeNpub: adapter.decodeNpub },
}));

import {
  fetchPrimalProfileData,
  getCompleteProfile,
  LOGIN_FLOW_PRIMAL_FETCH_BUDGET_MS,
  processPrimalData,
  refreshUserProfileIfChanged,
  refreshUserProfileIfEmpty,
  validateNpub,
} from "~/features/auth/profile.server";
import type { PrimalEvent } from "~/features/nostr/types";
import type { UserWithHashTagPresets } from "~/features/user";

interface StoredUser {
  id: string;
  nostrProfile: unknown;
  npub: string;
}

const NPUB = nip19.npubEncode(HEX);
const NOTE = nip19.noteEncode(HEX);
const NSEC = nip19.nsecEncode(new Uint8Array(32).fill(7));
const CREATED = new Date("2020-01-01T00:00:00.000Z");

const EMPTY_PROFILE = {
  followers_count: 0,
  following_count: 0,
  media: {},
  posts_count: 0,
  total_satszapped: 0,
  zaps_count: 0,
};

function makeUser(
  nostrProfile: unknown,
  id = "user-1"
): UserWithHashTagPresets {
  const user = {
    blastrRelayEnabled: true,
    broadcastSettings: null,
    createdAt: CREATED,
    customBlossomUrl: null,
    customNostrClientBaseUrl: null,
    dateFormat: "ddmmyyyy",
    defaultZapAmountSats: null,
    enableMirrorBlossom: false,
    encryptedNwc: null,
    engagementLastCheckedAt: null,
    filterMuted: false,
    giveawayBlackListed: [],
    hashTagPresets: [],
    hidePostsFromLowTrustUsers: false,
    id,
    isChild: false,
    isEnabled: true,
    lastRunwayLowNotificationAt: null,
    localeDefaultsAppliedAt: null,
    mirrorUploadUrls: [],
    mutedList: null,
    nostrProfile,
    npub: NPUB,
    nwcEnabled: false,
    nwcLastUsed: null,
    parentNpub: null,
    pendingParentRequests: [],
    preferredNostrClient: "PRIMAL",
    primarySignerProfile: null,
    pushNotificationsEnabled: true,
    pushNotifyIncludePreview: true,
    pushNotifyPublishFailure: true,
    pushNotifyPublishSuccess: true,
    pushNotifyRunwayLow: false,
    runwayNotifyBelowDays: null,
    scheduleInterval: [],
    showHashTagsinPosts: false,
    themePreference: null,
    timeFormat: "24h",
    timezone: "Etc/GMT",
    updatedAt: CREATED,
    uploadProvider: "S3",
    userRelays: [],
  };
  return user as UserWithHashTagPresets;
}

function profileEvent(profile: Record<string, unknown>): PrimalEvent {
  return ["EVENT", "sub", { content: JSON.stringify(profile), kind: 0 }];
}

function asEvents(items: unknown[]): PrimalEvent[] {
  return items as PrimalEvent[];
}

function loggedAt(index: number): { error: Error; fields: LogFields } {
  const call = logger.logError.mock.calls[index];
  if (!call) throw new Error(`missing log ${index}`);
  return { error: call[0], fields: call[1] };
}

describe("validateNpub", () => {
  it("accepts an npub and rejects other bech32 types and garbage", () => {
    expect(validateNpub(NPUB)).toBe(true);
    expect(validateNpub(NOTE)).toBe(false);
    expect(validateNpub(NSEC)).toBe(false);
    expect(validateNpub("npub1not-a-real-key")).toBe(false);
    expect(validateNpub("")).toBe(false);
  });
});

describe("fetchPrimalProfileData", () => {
  beforeEach(() => {
    vi.useRealTimers();
    adapter.decodeNpub.mockReset();
    adapter.decodeNpub.mockImplementation((npub: string) =>
      npub.startsWith("npub") ? HEX : npub
    );
    primal.connectToPrimalCache.mockReset();
    primal.connectToPrimalCache.mockResolvedValue([]);
    logger.logError.mockReset();
  });

  it("returns the cache payload for a decoded npub", async () => {
    const events = [profileEvent({ name: "Ada" })];
    primal.connectToPrimalCache.mockResolvedValue(events);
    await expect(fetchPrimalProfileData(NPUB)).resolves.toEqual(events);
    await expect(
      fetchPrimalProfileData(NPUB, { primalFetchBudgetMs: 0 })
    ).resolves.toEqual(events);
    await expect(
      fetchPrimalProfileData(NPUB, { primalFetchBudgetMs: -5 })
    ).resolves.toEqual(events);
    await expect(
      fetchPrimalProfileData(NPUB, { primalFetchBudgetMs: 50 })
    ).resolves.toEqual(events);
    expect(adapter.decodeNpub).toHaveBeenCalledWith(NPUB);
    expect(primal.connectToPrimalCache).toHaveBeenCalledWith("user_profile", {
      pubkey: HEX,
    });
    expect(logger.logError).not.toHaveBeenCalled();
  });

  it("passes a null decode through and still returns the payload", async () => {
    const events = [profileEvent({ name: "Ada" })];
    adapter.decodeNpub.mockReturnValueOnce(null);
    primal.connectToPrimalCache.mockResolvedValueOnce(events);
    await expect(fetchPrimalProfileData(NPUB)).resolves.toEqual(events);
    expect(primal.connectToPrimalCache).toHaveBeenCalledWith("user_profile", {
      pubkey: null,
    });
    expect(logger.logError).not.toHaveBeenCalled();
  });

  it("logs thrown decode and cache failures and returns an empty list", async () => {
    const decodeError = new Error("decode failed");
    adapter.decodeNpub.mockImplementationOnce(() => {
      raise(decodeError);
    });
    await expect(fetchPrimalProfileData(NPUB)).resolves.toEqual([]);
    expect(primal.connectToPrimalCache).not.toHaveBeenCalled();
    expect(loggedAt(0).error).toBe(decodeError);
    expect(loggedAt(0).fields).toEqual({
      message: "Failed to fetch profile data from Primal cache",
      npub: NPUB,
    });

    logger.logError.mockClear();
    adapter.decodeNpub.mockImplementationOnce(() => {
      raise("decode failed");
    });
    await expect(fetchPrimalProfileData(NPUB)).resolves.toEqual([]);
    expect(loggedAt(0).error.message).toBe("decode failed");
    expect(loggedAt(0).fields.npub).toBe(NPUB);

    const cacheError = new Error("cache down");
    primal.connectToPrimalCache.mockRejectedValueOnce(cacheError);
    await expect(fetchPrimalProfileData(NPUB)).resolves.toEqual([]);
    expect(loggedAt(1).error).toBe(cacheError);

    logger.logError.mockClear();
    primal.connectToPrimalCache.mockRejectedValueOnce("cache down");
    await expect(fetchPrimalProfileData(NPUB)).resolves.toEqual([]);
    expect(loggedAt(0).error.message).toBe("cache down");
    expect(loggedAt(0).fields).toEqual({
      message: "Failed to fetch profile data from Primal cache",
      npub: NPUB,
    });
  });

  it("returns an empty list when the budget expires first", async () => {
    vi.useFakeTimers();
    try {
      primal.connectToPrimalCache.mockImplementation(
        () => new Promise<unknown[]>(() => undefined)
      );
      let finished = false;
      const pending = fetchPrimalProfileData(NPUB, {
        primalFetchBudgetMs: 25,
      }).then((value) => {
        finished = true;
        return value;
      });
      await vi.advanceTimersByTimeAsync(24);
      expect(finished).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual([]);
      expect(finished).toBe(true);
      expect(logger.logError).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("processPrimalData", () => {
  it("returns zeros when no profile, stats, or media events are present", () => {
    expect(
      processPrimalData(
        asEvents([
          "nope",
          ["EOSE", "sub"],
          ["EVENT", "sub", { content: "{}", kind: 1 }],
        ])
      )
    ).toEqual({ profile: EMPTY_PROFILE });
  });

  it("keeps the first profile and maps stats and media", () => {
    const events = asEvents([
      [
        "EVENT",
        "sub",
        { content: JSON.stringify({ followers_count: 99 }), kind: 10000100 },
      ],
      profileEvent({
        about: "hi",
        display_name: "A",
        lud16: "ada@getalby.com",
        name: "Ada",
        picture: "https://cdn.example/a.png",
      }),
      profileEvent({ name: "Second" }),
      [
        "EVENT",
        "sub",
        {
          content: JSON.stringify({ followers_count: 3, note_count: 4 }),
          kind: 10000105,
        },
      ],
      [
        "EVENT",
        "sub",
        { content: JSON.stringify({ images: 2 }), kind: 10000119 },
      ],
    ]);
    expect(processPrimalData(events)).toEqual({
      profile: {
        about: "hi",
        display_name: "A",
        followers_count: 3,
        following_count: 0,
        lud16: "ada@getalby.com",
        media: { images: 2 },
        name: "Ada",
        picture: "https://cdn.example/a.png",
        posts_count: 4,
        total_satszapped: 0,
        zaps_count: 0,
      },
    });
  });

  it("throws on bad profile or stats json and keeps null media", () => {
    expect(() =>
      processPrimalData(asEvents([["EVENT", "sub", { content: "{", kind: 0 }]]))
    ).toThrow(SyntaxError);
    expect(() => processPrimalData(asEvents([["EVENT", "sub"]]))).toThrow(
      TypeError
    );
    expect(() =>
      processPrimalData(
        asEvents([
          ["EVENT", "sub", { content: "{}", kind: 0 }],
          ["EVENT", "sub", { content: "null", kind: 10000105 }],
        ])
      )
    ).toThrow(TypeError);
    expect(
      processPrimalData(
        asEvents([
          ["EVENT", "sub", { content: "{}", kind: 0 }],
          ["EVENT", "sub", { content: "null", kind: 10000119 }],
        ])
      )
    ).toEqual({
      profile: {
        followers_count: 0,
        following_count: 0,
        media: null,
        posts_count: 0,
        total_satszapped: 0,
        zaps_count: 0,
      },
    });
  });
});

describe("getCompleteProfile", () => {
  beforeEach(() => {
    vi.useRealTimers();
    adapter.decodeNpub.mockReset();
    adapter.decodeNpub.mockImplementation(() => HEX);
    primal.connectToPrimalCache.mockReset();
    primal.connectToPrimalCache.mockResolvedValue([]);
    logger.logError.mockReset();
  });

  it("returns an empty profile when primal has no rows", async () => {
    await expect(getCompleteProfile({ npub: NPUB })).resolves.toEqual({
      lud16: undefined,
      nostrProfile: EMPTY_PROFILE,
    });
  });

  it("returns the processed profile and lud16", async () => {
    const events = [profileEvent({ lud16: "ada@getalby.com", name: "Ada" })];
    primal.connectToPrimalCache.mockResolvedValueOnce(events);
    await expect(getCompleteProfile({ npub: NPUB })).resolves.toEqual({
      lud16: "ada@getalby.com",
      nostrProfile: processPrimalData(events).profile,
    });
  });

  it("propagates invalid profile json", async () => {
    primal.connectToPrimalCache.mockResolvedValueOnce(
      asEvents([["EVENT", "sub", { content: "{", kind: 0 }]])
    );
    await expect(getCompleteProfile({ npub: NPUB })).rejects.toThrow(
      SyntaxError
    );
  });

  it("returns an empty profile when the login budget expires", async () => {
    expect(LOGIN_FLOW_PRIMAL_FETCH_BUDGET_MS).toBe(5000);
    vi.useFakeTimers();
    try {
      primal.connectToPrimalCache.mockImplementation(
        () => new Promise<unknown[]>(() => undefined)
      );
      const pending = getCompleteProfile({
        npub: NPUB,
        primalFetchBudgetMs: LOGIN_FLOW_PRIMAL_FETCH_BUDGET_MS,
      });
      await vi.advanceTimersByTimeAsync(LOGIN_FLOW_PRIMAL_FETCH_BUDGET_MS);
      await expect(pending).resolves.toEqual({
        lud16: undefined,
        nostrProfile: EMPTY_PROFILE,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("refreshUserProfileIfEmpty", () => {
  beforeEach(() => {
    vi.useRealTimers();
    adapter.decodeNpub.mockReset();
    adapter.decodeNpub.mockImplementation((npub: string) =>
      npub.startsWith("npub") ? HEX : npub
    );
    primal.connectToPrimalCache.mockReset();
    primal.connectToPrimalCache.mockResolvedValue([]);
    users.createUser.mockReset();
    users.getUserById.mockReset();
    logger.logError.mockReset();
  });

  it("leaves a profile that already has a picture, name, or display name", async () => {
    const filled = [
      { picture: "https://cdn.example/a.png" },
      { name: "Ada" },
      { display_name: "Ada" },
      { display_name: "", name: " ", picture: "  x  " },
      JSON.stringify({ picture: "https://cdn.example/a.png" }),
    ];
    for (const nostrProfile of filled) {
      primal.connectToPrimalCache.mockClear();
      const current = makeUser(nostrProfile);
      await expect(refreshUserProfileIfEmpty(current)).resolves.toBe(current);
      expect(primal.connectToPrimalCache).not.toHaveBeenCalled();
    }
  });

  it("fetches when the stored profile has no visible identity", async () => {
    const emptyProfiles = [
      null,
      "{",
      "[]",
      "42",
      "true",
      [],
      0,
      false,
      { display_name: "\t", name: " ", picture: " " },
      JSON.stringify({ display_name: null, name: null, picture: null }),
      JSON.stringify({ name: "  " }),
    ];
    for (const nostrProfile of emptyProfiles) {
      primal.connectToPrimalCache.mockClear();
      const current = makeUser(nostrProfile);
      await expect(refreshUserProfileIfEmpty(current)).resolves.toBe(current);
      expect(primal.connectToPrimalCache).toHaveBeenCalledTimes(1);
      expect(primal.connectToPrimalCache).toHaveBeenCalledWith("user_profile", {
        pubkey: HEX,
      });
    }
    expect(users.createUser).not.toHaveBeenCalled();
  });

  it("throws when stored json is the null literal", async () => {
    await expect(refreshUserProfileIfEmpty(makeUser("null"))).rejects.toThrow(
      TypeError
    );
    expect(primal.connectToPrimalCache).not.toHaveBeenCalled();
  });

  it("stores a fetched identity and returns the reloaded user", async () => {
    const events = [
      profileEvent({ display_name: "B", name: "Bea", picture: "pic" }),
    ];
    primal.connectToPrimalCache.mockResolvedValueOnce(events);
    const current = makeUser(null);
    const updated = makeUser({ name: "Bea" }, "user-1");
    users.getUserById.mockResolvedValueOnce(updated);
    await expect(refreshUserProfileIfEmpty(current)).resolves.toBe(updated);
    expect(users.createUser).toHaveBeenCalledWith(
      NPUB,
      JSON.stringify(processPrimalData(events).profile)
    );
    expect(users.getUserById).toHaveBeenCalledWith("user-1");
  });

  it("does not write whitespace or non-string fetched fields", async () => {
    for (const profile of [
      { display_name: "\n", name: "  ", picture: " " },
      { display_name: false, name: 1, picture: null },
    ]) {
      users.createUser.mockClear();
      primal.connectToPrimalCache.mockResolvedValueOnce([
        profileEvent(profile),
      ]);
      const current = makeUser(null);
      await expect(refreshUserProfileIfEmpty(current)).resolves.toBe(current);
      expect(users.createUser).not.toHaveBeenCalled();
    }
  });

  it("returns the original user when the reload finds no row", async () => {
    const events = [profileEvent({ name: "Bea" })];
    primal.connectToPrimalCache.mockResolvedValueOnce(events);
    users.getUserById.mockResolvedValueOnce(null);
    const current = makeUser(null);
    await expect(refreshUserProfileIfEmpty(current)).resolves.toBe(current);
    expect(users.createUser).toHaveBeenCalledTimes(1);
  });

  it("returns the original user when the login budget expires", async () => {
    vi.useFakeTimers();
    try {
      primal.connectToPrimalCache.mockImplementation(
        () => new Promise<unknown[]>(() => undefined)
      );
      const current = makeUser(null);
      let finished = false;
      const pending = refreshUserProfileIfEmpty(current).then((value) => {
        finished = true;
        return value;
      });
      await vi.advanceTimersByTimeAsync(LOGIN_FLOW_PRIMAL_FETCH_BUDGET_MS - 1);
      expect(finished).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBe(current);
      expect(users.createUser).not.toHaveBeenCalled();
      expect(adapter.decodeNpub).toHaveBeenCalledWith(NPUB);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("refreshUserProfileIfChanged", () => {
  beforeEach(() => {
    vi.useRealTimers();
    adapter.decodeNpub.mockReset();
    adapter.decodeNpub.mockImplementation(() => HEX);
    primal.connectToPrimalCache.mockReset();
    primal.connectToPrimalCache.mockResolvedValue([]);
    users.createUser.mockReset();
    users.getUserById.mockReset();
    logger.logError.mockReset();
  });

  it("does not write when the fetch has no display fields", async () => {
    const current = makeUser({ name: "Ada" });
    await expect(refreshUserProfileIfChanged(current)).resolves.toBe(current);
    primal.connectToPrimalCache.mockResolvedValueOnce([
      profileEvent({ display_name: false, name: 1, picture: null }),
    ]);
    await expect(refreshUserProfileIfChanged(current)).resolves.toBe(current);
    expect(users.createUser).not.toHaveBeenCalled();
  });

  it("does not write when the visible fields are unchanged after trimming", async () => {
    const current = makeUser({
      about: "old",
      display_name: "A",
      name: "Ada",
      picture: "pic",
    });
    primal.connectToPrimalCache.mockResolvedValueOnce([
      profileEvent({
        about: "new",
        display_name: "A",
        name: "Ada",
        picture: "pic",
      }),
    ]);
    await expect(refreshUserProfileIfChanged(current)).resolves.toBe(current);

    const spaced = makeUser({ name: "Ada" });
    primal.connectToPrimalCache.mockResolvedValueOnce([
      profileEvent({ name: " Ada " }),
    ]);
    await expect(refreshUserProfileIfChanged(spaced)).resolves.toBe(spaced);
    expect(users.createUser).not.toHaveBeenCalled();
  });

  it("writes when the name, display name, or picture changes", async () => {
    const cases = [
      {
        fetched: { display_name: "A", name: "Bea", picture: "pic" },
        stored: { display_name: "A", name: "Ada", picture: "pic" },
      },
      {
        fetched: { display_name: "B", name: "Ada", picture: "pic" },
        stored: { display_name: "A", name: "Ada", picture: "pic" },
      },
      {
        fetched: { display_name: "A", name: "Ada", picture: "next" },
        stored: { display_name: "A", name: "Ada", picture: "pic" },
      },
    ];
    for (const item of cases) {
      const events = [profileEvent(item.fetched)];
      primal.connectToPrimalCache.mockResolvedValueOnce(events);
      const updated = makeUser(item.fetched, "user-2");
      users.getUserById.mockResolvedValueOnce(updated);
      const current = makeUser(item.stored);
      await expect(refreshUserProfileIfChanged(current)).resolves.toBe(updated);
      expect(users.createUser).toHaveBeenLastCalledWith(
        NPUB,
        JSON.stringify(processPrimalData(events).profile)
      );
      expect(users.getUserById).toHaveBeenLastCalledWith("user-1");
    }
  });

  it("writes when the stored profile has no comparable display fields", async () => {
    const events = [profileEvent({ name: "Ada" })];
    for (const stored of ["{", [], 0, false, { name: 1 }]) {
      primal.connectToPrimalCache.mockResolvedValueOnce(events);
      users.getUserById.mockResolvedValueOnce(
        makeUser({ name: "Ada" }, "user-2")
      );
      await refreshUserProfileIfChanged(makeUser(stored));
    }
    expect(users.createUser).toHaveBeenCalledTimes(5);
  });

  it("returns the original user when the reload finds no row", async () => {
    const events = [profileEvent({ name: "Bea" })];
    primal.connectToPrimalCache.mockResolvedValueOnce(events);
    users.getUserById.mockResolvedValueOnce(null);
    const current = makeUser({ name: "Ada" });
    await expect(refreshUserProfileIfChanged(current)).resolves.toBe(current);
    expect(users.createUser).toHaveBeenCalledWith(
      NPUB,
      JSON.stringify(processPrimalData(events).profile)
    );
  });

  it("treats json null as empty display bits and stores the fetch", async () => {
    const events = [profileEvent({ name: "Ada" })];
    primal.connectToPrimalCache.mockResolvedValueOnce(events);
    const updated = makeUser({ name: "Ada" }, "user-2");
    users.getUserById.mockResolvedValueOnce(updated);
    await expect(refreshUserProfileIfChanged(makeUser("null"))).resolves.toBe(
      updated
    );
    expect(users.createUser).toHaveBeenCalledWith(
      NPUB,
      JSON.stringify(processPrimalData(events).profile)
    );
  });

  it("returns the stored user when a null json profile fetch is empty", async () => {
    const current = makeUser("null");
    await expect(refreshUserProfileIfChanged(current)).resolves.toBe(current);
    expect(users.createUser).not.toHaveBeenCalled();
  });
});
