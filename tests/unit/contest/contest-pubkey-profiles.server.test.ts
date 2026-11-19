import { beforeEach, describe, expect, it, vi } from "vitest";

const primal = vi.hoisted(() => ({
  connectToPrimalCache: vi.fn(),
}));

const nostr = vi.hoisted(() => ({
  nostrAdapter: {
    encodeNpub: vi.fn(),
  },
}));

vi.mock("~/features/cache/primalCache.server", () => primal);
vi.mock("~/lib/nostr-adapter.server", () => nostr);

import { connectToPrimalCache } from "~/features/cache/primalCache.server";
import { fetchContestPubkeyProfiles } from "~/features/contest/contest-pubkey-profiles.server";
import { nostrAdapter } from "~/lib/nostr-adapter.server";

const PK_A = "a".repeat(64);
const PK_B = "b".repeat(64);
const PK_C = "c".repeat(64);

function kind0(pubkey: string, content: string) {
  return ["EVENT", "sub", { kind: 0, pubkey, content }];
}

describe("fetchContestPubkeyProfiles", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(nostrAdapter.encodeNpub).mockImplementation(
      (pubkey: string) => `npub-${pubkey.slice(0, 4)}`
    );
    vi.mocked(connectToPrimalCache).mockResolvedValue([]);
  });

  it("returns an empty map for blank input", async () => {
    await expect(fetchContestPubkeyProfiles(["", ""])).resolves.toEqual({});
    expect(connectToPrimalCache).not.toHaveBeenCalled();
  });

  it("dedupes pubkeys, caps the batch, and keeps fallbacks when cache is unusable", async () => {
    const extra = Array.from({ length: 3 }, (_, index) =>
      `${index}`.repeat(64)
    );
    vi.mocked(nostrAdapter.encodeNpub).mockImplementation((pubkey: string) =>
      pubkey === PK_B ? null : `npub-${pubkey.slice(0, 4)}`
    );
    vi.mocked(connectToPrimalCache).mockResolvedValueOnce("nope");

    const profiles = await fetchContestPubkeyProfiles(
      ["", PK_A, PK_A, PK_B, extra[0] ?? "", extra[1] ?? "", extra[2] ?? ""],
      2
    );

    expect(Object.keys(profiles)).toEqual([PK_A, PK_B]);
    expect(profiles[PK_A]).toMatchObject({
      npub: "npub-aaaa",
      displayName: `${PK_A.slice(0, 8)}…`,
      picture: null,
    });
    expect(profiles[PK_B]?.npub).toBe("");
    expect(connectToPrimalCache).toHaveBeenCalledWith("user_infos", {
      pubkeys: [PK_A, PK_B],
    });
  });

  it("fills names and http pictures and skips malformed cache events", async () => {
    vi.mocked(connectToPrimalCache).mockResolvedValueOnce([
      "EOSE",
      ["EVENT", "sub", undefined],
      ["EVENT", "sub", { kind: 1, pubkey: PK_A, content: "{}" }],
      ["EVENT", "sub", { kind: 0, content: "{}" }],
      kind0(PK_A, "{"),
      kind0(
        PK_B,
        JSON.stringify({
          display_name: "  Ada  ",
          picture: " https://cdn.example/a.png ",
        })
      ),
      kind0(
        PK_C,
        JSON.stringify({
          display_name: "   ",
          name: "  Bea ",
          picture: "ftp://cdn.example/a.png",
        })
      ),
    ]);

    const profiles = await fetchContestPubkeyProfiles([PK_A, PK_B, PK_C]);

    expect(profiles[PK_A]?.displayName).toBe(`${PK_A.slice(0, 8)}…`);
    expect(profiles[PK_B]).toMatchObject({
      displayName: "Ada",
      picture: "https://cdn.example/a.png",
    });
    expect(profiles[PK_C]).toMatchObject({
      displayName: "Bea",
      picture: null,
    });
  });

  it("uses the name, then the pubkey, when display name is missing", async () => {
    vi.mocked(connectToPrimalCache).mockResolvedValueOnce([
      kind0(
        PK_A,
        JSON.stringify({ name: "Nova", picture: "http://img.test/a" })
      ),
      kind0(PK_B, JSON.stringify({ name: "   ", picture: "  not-a-url" })),
    ]);

    const profiles = await fetchContestPubkeyProfiles([PK_A, PK_B]);
    expect(profiles[PK_A]).toMatchObject({
      displayName: "Nova",
      picture: "http://img.test/a",
    });
    expect(profiles[PK_B]?.displayName).toBe(`${PK_B.slice(0, 8)}…`);
    expect(profiles[PK_B]?.picture).toBeNull();
  });

  it("keeps fallbacks when the cache throws", async () => {
    vi.mocked(connectToPrimalCache).mockRejectedValueOnce(new Error("offline"));
    const profiles = await fetchContestPubkeyProfiles([PK_A]);
    expect(profiles[PK_A]?.displayName).toBe(`${PK_A.slice(0, 8)}…`);
  });
});
