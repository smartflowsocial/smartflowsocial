import { nip19 } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  broadcastSavedAudience: {
    findFirst: vi.fn(),
  },
}));

const graph = vi.hoisted(() => ({
  getFollowedPubkeysGraph: vi.fn(),
  getFollowerPubkeysGraph: vi.fn(),
  getMutualPubkeysGraph: vi.fn(),
}));

const users = vi.hoisted(() => ({
  getUserById: vi.fn(),
}));

const cache = vi.hoisted(() => ({
  connectToPrimalCache: vi.fn(),
}));

const logs = vi.hoisted(() => ({
  logError: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));
vi.mock("~/features/nostr/social-graph.server", () => graph);
vi.mock("~/features/user", () => users);
vi.mock("~/features/cache/primalCache.server", () => cache);
vi.mock("~/lib/error-logger.server", () => logs);

import {
  expandSavedAudienceEligiblePubkeys,
  fetchBroadcastRecipientProfiles,
  getBroadcastEligiblePoolPubkeys,
} from "~/features/broadcast/broadcast-recipient-picker.server";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);

function pubkey(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function defaultName(hex: string): string {
  return `${hex.slice(0, 8)}…`;
}

describe("getBroadcastEligiblePoolPubkeys", () => {
  beforeEach(() => {
    users.getUserById.mockReset();
    graph.getFollowerPubkeysGraph.mockReset();
    graph.getMutualPubkeysGraph.mockReset();
  });

  it("fails closed when the user has no usable pubkey", async () => {
    users.getUserById.mockResolvedValueOnce(null);
    await expect(
      getBroadcastEligiblePoolPubkeys("user-1", "followers")
    ).resolves.toEqual({ pubkeys: [], fetchFailed: true });

    users.getUserById.mockResolvedValueOnce({ id: "user-1", npub: "" });
    await expect(
      getBroadcastEligiblePoolPubkeys("user-1", "mutuals")
    ).resolves.toEqual({ pubkeys: [], fetchFailed: true });

    users.getUserById.mockResolvedValueOnce({
      id: "user-1",
      npub: "npub1invalid",
    });
    await expect(
      getBroadcastEligiblePoolPubkeys("user-1", "followers")
    ).resolves.toEqual({ pubkeys: [], fetchFailed: true });
    expect(graph.getFollowerPubkeysGraph).not.toHaveBeenCalled();
  });

  it("loads followers from a hex npub and mutuals from a bech32 npub", async () => {
    users.getUserById.mockResolvedValueOnce({ id: "user-1", npub: HEX_A });
    graph.getFollowerPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_B],
      fetchFailed: false,
    });

    await expect(
      getBroadcastEligiblePoolPubkeys("user-1", "followers")
    ).resolves.toEqual({ pubkeys: [HEX_B], fetchFailed: false });
    expect(graph.getFollowerPubkeysGraph).toHaveBeenCalledWith(HEX_A);

    const npub = nip19.npubEncode(HEX_B);
    users.getUserById.mockResolvedValueOnce({ id: "user-1", npub });
    graph.getMutualPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_A],
      fetchFailed: true,
    });
    await expect(
      getBroadcastEligiblePoolPubkeys("user-1", "mutuals")
    ).resolves.toEqual({ pubkeys: [HEX_A], fetchFailed: true });
    expect(graph.getMutualPubkeysGraph).toHaveBeenCalledWith(HEX_B);
  });
});

describe("fetchBroadcastRecipientProfiles", () => {
  beforeEach(() => {
    cache.connectToPrimalCache.mockReset();
    logs.logError.mockReset();
  });

  it("returns an empty list without calling the cache", async () => {
    await expect(fetchBroadcastRecipientProfiles([])).resolves.toEqual([]);
    expect(cache.connectToPrimalCache).not.toHaveBeenCalled();
  });

  it("parses kind 0 metadata and fills defaults for the rest", async () => {
    const keys = [pubkey(1), pubkey(2), pubkey(3), pubkey(4), pubkey(5)];
    cache.connectToPrimalCache.mockResolvedValue([
      "nope",
      ["EOSE", "sub"],
      ["EVENT", "sub"],
      ["EVENT", "sub", { kind: 1, pubkey: pubkey(1), content: "{}" }],
      ["EVENT", "sub", { kind: 0, pubkey: 12, content: "{}" }],
      [
        "EVENT",
        "sub",
        { kind: 0, pubkey: pubkey(9), content: JSON.stringify({ name: "No" }) },
      ],
      [
        "EVENT",
        "sub",
        {
          kind: 0,
          pubkey: pubkey(1).toUpperCase(),
          content: JSON.stringify({
            name: "  ",
            display_name: "Bee",
            picture: "   ",
            nip05: "",
          }),
        },
      ],
      ["EVENT", "sub", { kind: 0, pubkey: pubkey(2), content: "{bad" }],
      [
        "EVENT",
        "sub",
        {
          kind: 0,
          pubkey: pubkey(3),
          content: JSON.stringify({
            name: "Ada",
            display_name: "Ignored",
            picture: " https://pic.example/a.png ",
            nip05: " ada@example.com ",
          }),
        },
      ],
      ["EVENT", "sub", { kind: 0, pubkey: pubkey(4), content: 5 }],
      [
        "EVENT",
        "sub",
        {
          kind: 0,
          pubkey: pubkey(5),
          content: JSON.stringify({ picture: 1, nip05: 2 }),
        },
      ],
    ]);

    await expect(fetchBroadcastRecipientProfiles(keys)).resolves.toEqual([
      {
        pubkey: pubkey(1),
        name: "Bee",
        picture: null,
        nip05: null,
      },
      {
        pubkey: pubkey(2),
        name: defaultName(pubkey(2)),
        picture: null,
        nip05: null,
      },
      {
        pubkey: pubkey(3),
        name: "Ada",
        picture: "https://pic.example/a.png",
        nip05: "ada@example.com",
      },
      {
        pubkey: pubkey(4),
        name: defaultName(pubkey(4)),
        picture: null,
        nip05: null,
      },
      {
        pubkey: pubkey(5),
        name: defaultName(pubkey(5)),
        picture: null,
        nip05: null,
      },
    ]);
    expect(cache.connectToPrimalCache).toHaveBeenCalledWith("user_infos", {
      pubkeys: keys,
    });
  });

  it("drops invalid keys and still returns defaults when the cache payload is not a list", async () => {
    cache.connectToPrimalCache.mockResolvedValue({ ok: false });
    await expect(
      fetchBroadcastRecipientProfiles([
        ` ${pubkey(1).toUpperCase()} `,
        "zz",
        pubkey(1),
      ])
    ).resolves.toEqual([
      {
        pubkey: pubkey(1),
        name: defaultName(pubkey(1)),
        picture: null,
        nip05: null,
      },
    ]);
  });

  it("logs a batch failure and continues with placeholder profiles", async () => {
    cache.connectToPrimalCache.mockRejectedValueOnce(new Error("batch failed"));
    await expect(fetchBroadcastRecipientProfiles([pubkey(1)])).resolves.toEqual(
      [
        {
          pubkey: pubkey(1),
          name: defaultName(pubkey(1)),
          picture: null,
          nip05: null,
        },
      ]
    );
    expect(logs.logError).toHaveBeenCalledWith(expect.any(Error), {
      message: "broadcast recipient profiles batch failed",
      chunkSize: 1,
    });

    cache.connectToPrimalCache.mockRejectedValueOnce("cache down");
    await fetchBroadcastRecipientProfiles([pubkey(2)]);
    expect(logs.logError).toHaveBeenLastCalledWith(expect.any(Error), {
      message: "broadcast recipient profiles batch failed",
      chunkSize: 1,
    });
  });

  it("requests profiles in chunks of 80", async () => {
    const pubkeys = Array.from({ length: 81 }, (_, index) => pubkey(index));
    cache.connectToPrimalCache.mockImplementation(
      async (_name: string, body: { pubkeys: string[] }) => {
        const first = body.pubkeys[0];
        if (body.pubkeys.length === 1 || !first) {
          throw new Error("second chunk");
        }
        return [
          [
            "EVENT",
            "sub",
            {
              kind: 0,
              pubkey: first,
              content: JSON.stringify({ name: "First" }),
            },
          ],
        ];
      }
    );

    const profiles = await fetchBroadcastRecipientProfiles(pubkeys);
    expect(profiles).toHaveLength(81);
    expect(profiles[0]).toEqual({
      pubkey: pubkey(0),
      name: "First",
      picture: null,
      nip05: null,
    });
    expect(profiles[80]).toEqual({
      pubkey: pubkey(80),
      name: defaultName(pubkey(80)),
      picture: null,
      nip05: null,
    });
    expect(cache.connectToPrimalCache).toHaveBeenNthCalledWith(
      1,
      "user_infos",
      { pubkeys: pubkeys.slice(0, 80) }
    );
    expect(cache.connectToPrimalCache).toHaveBeenNthCalledWith(
      2,
      "user_infos",
      { pubkeys: [pubkey(80)] }
    );
    expect(logs.logError).toHaveBeenCalledWith(expect.any(Error), {
      message: "broadcast recipient profiles batch failed",
      chunkSize: 1,
    });
  });
});

describe("expandSavedAudienceEligiblePubkeys", () => {
  beforeEach(() => {
    prismaMock.broadcastSavedAudience.findFirst.mockReset();
    users.getUserById.mockReset();
    graph.getFollowerPubkeysGraph.mockReset();
    graph.getMutualPubkeysGraph.mockReset();
    graph.getFollowedPubkeysGraph.mockReset();
  });

  it("returns not found without loading the user", async () => {
    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValue(null);
    await expect(
      expandSavedAudienceEligiblePubkeys("user-1", "aud-1")
    ).resolves.toEqual({ pubkeys: [], fetchFailed: false, notFound: true });
    expect(users.getUserById).not.toHaveBeenCalled();
    expect(prismaMock.broadcastSavedAudience.findFirst).toHaveBeenCalledWith({
      where: { id: "aud-1", userId: "user-1" },
    });
  });

  it("fails when the account pubkey is missing or invalid", async () => {
    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValue({
      id: "aud-1",
      audienceType: "CUSTOM",
      customNpubLines: [HEX_A],
    });
    users.getUserById.mockResolvedValueOnce(null);
    await expect(
      expandSavedAudienceEligiblePubkeys("user-1", "aud-1")
    ).resolves.toEqual({ pubkeys: [], fetchFailed: true });

    users.getUserById.mockResolvedValueOnce({
      id: "user-1",
      npub: "not-a-pubkey",
    });
    await expect(
      expandSavedAudienceEligiblePubkeys("user-1", "aud-1")
    ).resolves.toEqual({ pubkeys: [], fetchFailed: true });
    expect(graph.getFollowerPubkeysGraph).not.toHaveBeenCalled();
  });

  it("expands custom and mutual audiences and ignores removed types", async () => {
    users.getUserById.mockResolvedValue({ id: "user-1", npub: HEX_A });
    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValueOnce({
      id: "aud-1",
      audienceType: "CUSTOM",
      customNpubLines: [HEX_B, "nope"],
    });
    graph.getFollowerPubkeysGraph.mockResolvedValueOnce({
      pubkeys: [HEX_B],
      fetchFailed: false,
    });

    await expect(
      expandSavedAudienceEligiblePubkeys("user-1", "aud-1")
    ).resolves.toEqual({ pubkeys: [HEX_B], fetchFailed: false });
    expect(graph.getFollowerPubkeysGraph).toHaveBeenCalledWith(HEX_A);

    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValueOnce({
      id: "aud-1",
      audienceType: "CUSTOM",
      customNpubLines: [HEX_B],
    });
    graph.getFollowerPubkeysGraph.mockResolvedValueOnce({
      pubkeys: [],
      fetchFailed: true,
    });
    await expect(
      expandSavedAudienceEligiblePubkeys("user-1", "aud-1")
    ).resolves.toEqual({ pubkeys: [], fetchFailed: true });

    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValueOnce({
      id: "aud-1",
      audienceType: "MUTUALS",
      customNpubLines: [],
    });
    graph.getMutualPubkeysGraph.mockResolvedValueOnce({
      pubkeys: [HEX_B],
      fetchFailed: false,
    });
    await expect(
      expandSavedAudienceEligiblePubkeys("user-1", "aud-1")
    ).resolves.toEqual({ pubkeys: [HEX_B], fetchFailed: false });
    expect(graph.getMutualPubkeysGraph).toHaveBeenCalledWith(HEX_A);

    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValueOnce({
      id: "aud-1",
      audienceType: "FOLLOWING",
      customNpubLines: [],
    });
    await expect(
      expandSavedAudienceEligiblePubkeys("user-1", "aud-1")
    ).resolves.toEqual({ pubkeys: [], fetchFailed: false });
    expect(graph.getFollowedPubkeysGraph).not.toHaveBeenCalled();
  });
});
