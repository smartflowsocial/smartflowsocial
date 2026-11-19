import { BroadcastAudienceType } from "@prisma/client";
import { nip19 } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

const graph = vi.hoisted(() => ({
  getFollowedPubkeysGraph: vi.fn(),
  getFollowerPubkeysGraph: vi.fn(),
  getMutualPubkeysGraph: vi.fn(),
}));

vi.mock("~/features/nostr/social-graph.server", () => graph);

import { normalizePubkeyInput as normalizeAudiencePubkey } from "~/features/broadcast/broadcast-audience.server";
import {
  applySuppressionAndSelf,
  normalizePubkeyInput,
  parseCustomNpubLines,
  resolveAudiencePubkeys,
} from "~/features/broadcast/broadcast-resolve.server";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);
const SENDER = "d".repeat(64);

describe("normalizePubkeyInput", () => {
  it("returns null for blank input", () => {
    expect(normalizePubkeyInput("")).toBeNull();
    expect(normalizePubkeyInput("   ")).toBeNull();
    expect(normalizeAudiencePubkey).toBe(normalizePubkeyInput);
  });

  it("lowercases a 64-character hex pubkey", () => {
    expect(normalizePubkeyInput(`  ${HEX_A.toUpperCase()}  `)).toBe(HEX_A);
  });

  it("decodes an npub to lowercase hex", () => {
    const npub = nip19.npubEncode(HEX_B);
    expect(normalizePubkeyInput(npub)).toBe(HEX_B);
  });

  it("returns null for invalid npub and non-hex text", () => {
    expect(normalizePubkeyInput("npub1invalid")).toBeNull();
    expect(normalizePubkeyInput("not-a-pubkey")).toBeNull();
  });
});

describe("parseCustomNpubLines", () => {
  it("returns an empty result for no lines", () => {
    expect(parseCustomNpubLines([])).toEqual({ valid: [], invalid: 0 });
  });

  it("counts invalid lines and skips blanks and duplicates", () => {
    expect(
      parseCustomNpubLines([
        "",
        "   ",
        "not-a-pubkey",
        HEX_A.toUpperCase(),
        ` ${HEX_A} `,
        HEX_B,
      ])
    ).toEqual({ valid: [HEX_A, HEX_B], invalid: 1 });
  });
});

describe("resolveAudiencePubkeys", () => {
  beforeEach(() => {
    graph.getFollowedPubkeysGraph.mockReset();
    graph.getFollowerPubkeysGraph.mockReset();
    graph.getMutualPubkeysGraph.mockReset();
  });

  it("returns no custom pubkeys when the follower graph fetch fails", async () => {
    graph.getFollowerPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_A],
      fetchFailed: true,
    });

    const result = await resolveAudiencePubkeys({
      audienceType: BroadcastAudienceType.CUSTOM,
      customLines: [HEX_A, "not-a-pubkey", ""],
      senderPubkeyHex: SENDER,
    });

    expect(result).toEqual({
      pubkeys: [],
      invalidCustom: 1,
      excludedNonFollowers: 1,
      graphFetchFailed: true,
    });
    expect(graph.getFollowerPubkeysGraph).toHaveBeenCalledWith(SENDER);
    expect(graph.getFollowedPubkeysGraph).not.toHaveBeenCalled();
  });

  it("keeps custom pubkeys that follow the sender and counts the rest", async () => {
    graph.getFollowerPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_A.toUpperCase(), HEX_C],
      fetchFailed: false,
    });

    const result = await resolveAudiencePubkeys({
      audienceType: BroadcastAudienceType.CUSTOM,
      customLines: [HEX_A, HEX_B, "not-a-pubkey", HEX_A.toUpperCase()],
      senderPubkeyHex: SENDER,
    });

    expect(result).toEqual({
      pubkeys: [HEX_A],
      invalidCustom: 2,
      excludedNonFollowers: 1,
      graphFetchFailed: false,
    });
  });

  it("returns followed pubkeys and the graph failure flag", async () => {
    graph.getFollowedPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_A],
      fetchFailed: false,
    });

    const ok = await resolveAudiencePubkeys({
      audienceType: BroadcastAudienceType.FOLLOWING,
      customLines: [],
      senderPubkeyHex: SENDER,
    });
    expect(ok).toEqual({
      pubkeys: [HEX_A],
      invalidCustom: 0,
      graphFetchFailed: false,
    });
    expect(graph.getFollowedPubkeysGraph).toHaveBeenCalledWith(SENDER);

    graph.getFollowedPubkeysGraph.mockResolvedValue({
      pubkeys: [],
      fetchFailed: true,
    });
    const failed = await resolveAudiencePubkeys({
      audienceType: BroadcastAudienceType.FOLLOWING,
      customLines: [],
      senderPubkeyHex: SENDER,
    });
    expect(failed).toEqual({
      pubkeys: [],
      invalidCustom: 0,
      graphFetchFailed: true,
    });
  });

  it("returns follower pubkeys for the followers audience", async () => {
    graph.getFollowerPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_B],
      fetchFailed: true,
    });

    const result = await resolveAudiencePubkeys({
      audienceType: BroadcastAudienceType.FOLLOWERS,
      customLines: [HEX_A],
      senderPubkeyHex: SENDER,
    });

    expect(result).toEqual({
      pubkeys: [HEX_B],
      invalidCustom: 0,
      graphFetchFailed: true,
    });
    expect(graph.getFollowerPubkeysGraph).toHaveBeenCalledWith(SENDER);
    expect(graph.getMutualPubkeysGraph).not.toHaveBeenCalled();
  });

  it("uses the mutual graph for the default audience", async () => {
    graph.getMutualPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_C],
      fetchFailed: false,
    });

    const ok = await resolveAudiencePubkeys({
      audienceType: BroadcastAudienceType.MUTUALS,
      customLines: [],
      senderPubkeyHex: SENDER,
    });
    expect(ok).toEqual({
      pubkeys: [HEX_C],
      invalidCustom: 0,
      graphFetchFailed: false,
    });
    expect(graph.getMutualPubkeysGraph).toHaveBeenCalledWith(SENDER);

    graph.getMutualPubkeysGraph.mockResolvedValue({
      pubkeys: [],
      fetchFailed: true,
    });
    const failed = await resolveAudiencePubkeys({
      audienceType: BroadcastAudienceType.MUTUALS,
      customLines: [],
      senderPubkeyHex: SENDER,
    });
    expect(failed.graphFetchFailed).toBe(true);
    expect(failed.pubkeys).toEqual([]);
  });
});

describe("applySuppressionAndSelf", () => {
  it("drops self and suppressed pubkeys and keeps the rest", () => {
    const result = applySuppressionAndSelf({
      pubkeys: [SENDER.toUpperCase(), HEX_A.toUpperCase(), HEX_B, HEX_B],
      selfPubkeyHex: SENDER,
      suppressed: new Set([HEX_A]),
    });

    expect(result).toEqual({
      included: [HEX_B, HEX_B],
      suppressedCount: 1,
      selfSkipped: true,
    });
  });

  it("keeps every pubkey when none are self or suppressed", () => {
    expect(
      applySuppressionAndSelf({
        pubkeys: [],
        selfPubkeyHex: SENDER,
        suppressed: new Set(),
      })
    ).toEqual({ included: [], suppressedCount: 0, selfSkipped: false });

    expect(
      applySuppressionAndSelf({
        pubkeys: [HEX_C],
        selfPubkeyHex: SENDER,
        suppressed: new Set([HEX_A]),
      })
    ).toEqual({ included: [HEX_C], suppressedCount: 0, selfSkipped: false });
  });
});
