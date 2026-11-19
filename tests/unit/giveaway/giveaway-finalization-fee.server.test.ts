import { describe, expect, it } from "vitest";

import {
  buildLockConfigHash,
  canonicalWinnerRowsForLockHash,
  quoteGiveawayFinalization,
} from "~/features/giveaway/giveaway-finalization-fee.server";
import type { GiveawayWinnerEntry } from "~/features/giveaway/types";
import { HOSTED_DEPLOYMENT } from "~/features/payments/entitlements/deployment-mode";

function winner(pubkey: string, satsPerWinner?: number): GiveawayWinnerEntry {
  return {
    pubkey,
    npub: "npub1",
    qualifyingActions: [],
    ...(satsPerWinner === undefined ? {} : { satsPerWinner }),
  };
}

function lockInput(
  overrides: Partial<Parameters<typeof buildLockConfigHash>[0]> = {}
): Parameters<typeof buildLockConfigHash>[0] {
  const base: Parameters<typeof buildLockConfigHash>[0] = {
    winnerSnapshot: [winner("b", 2), winner("a")],
    engagementConfig: { b: 1, a: { d: true, c: [1, { z: "q", y: null }] } },
    winnerCount: 2,
    selectionMode: "UNIQUE_USER",
    scopeType: "PERIOD",
    scopeReference: { z: 1, a: "days" },
    engagementTypes: ["ZAP", "REACTION"],
    filters: { b: 1, a: 2 },
    engagementWeights: { REPOST: 2, COMMENT: 1.5 },
  };
  return { ...base, ...overrides };
}

describe("giveaway-finalization-fee.server", () => {
  it("canonicalizes winner rows by pubkey and treats missing sats as zero", () => {
    expect(
      canonicalWinnerRowsForLockHash([winner("b", 5), winner("a")])
    ).toEqual([
      { pubkey: "a", satsPerWinner: 0 },
      { pubkey: "b", satsPerWinner: 5 },
    ]);
    expect(canonicalWinnerRowsForLockHash([])).toEqual([]);
  });

  it("hashes equivalent configs the same way regardless of key order", () => {
    const first = buildLockConfigHash(lockInput());
    const second = buildLockConfigHash({
      engagementWeights: { COMMENT: 1.5, REPOST: 2 },
      filters: { a: 2, b: 1 },
      engagementTypes: ["REACTION", "ZAP"],
      scopeReference: { a: "days", z: 1 },
      engagementConfig: { a: { c: [1, { y: null, z: "q" }], d: true }, b: 1 },
      winnerSnapshot: [winner("a"), winner("b", 2)],
      winnerCount: 2,
      selectionMode: "UNIQUE_USER",
      scopeType: "PERIOD",
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(buildLockConfigHash(lockInput({ winnerCount: 3 }))).not.toBe(first);
  });

  it("treats non-array engagement types and null filters as distinct", () => {
    const listed = buildLockConfigHash(
      lockInput({ engagementTypes: ["REACTION"], filters: null })
    );
    const asString = buildLockConfigHash(
      lockInput({ engagementTypes: "REACTION", filters: null })
    );
    const asNull = buildLockConfigHash(
      lockInput({ engagementTypes: null, winnerSnapshot: null, filters: null })
    );
    expect(asString).not.toBe(listed);
    expect(asNull).not.toBe(listed);
    expect(
      buildLockConfigHash(lockInput({ filters: null, engagementTypes: null }))
    ).toBe(
      buildLockConfigHash(
        lockInput({
          filters: null,
          engagementTypes: null,
          scopeReference: { a: "days", z: 1 },
        })
      )
    );
  });

  it("quotes every commercial plan and an explicit self-hosted deployment", () => {
    const giveaway = {
      winnerSnapshot: [winner("a", 10000)],
      engagementConfig: null,
      winnerCount: 1,
      plannedPayoutSats: 1,
      selectionMode: "UNIQUE_USER",
      scopeType: "PERIOD",
      scopeReference: { days: 7 },
      engagementTypes: ["REACTION"],
      filters: null,
      engagementWeights: null,
    };
    const free = quoteGiveawayFinalization({
      giveaway,
      planType: "free",
      deployment: HOSTED_DEPLOYMENT,
    });
    expect(free.plannedPayoutSats).toBe(10000);
    expect(free.feeRateBps).toBe(1000);
    expect(free.feeSats).toBe(1000);
    expect(free.dueNowSats).toBe(1000);
    expect(free.waivedByPlan).toBe(false);
    expect(free.lockConfigHash).toMatch(/^[a-f0-9]{64}$/);

    expect(
      quoteGiveawayFinalization({
        giveaway,
        planType: "starter",
        deployment: HOSTED_DEPLOYMENT,
      }).feeSats
    ).toBe(750);
    expect(
      quoteGiveawayFinalization({
        giveaway,
        planType: "creator",
        deployment: HOSTED_DEPLOYMENT,
      }).feeRateBps
    ).toBe(500);

    for (const planType of ["pro", "teams", "founder"] as const) {
      const quote = quoteGiveawayFinalization({
        giveaway,
        planType,
        deployment: HOSTED_DEPLOYMENT,
      });
      expect(quote.feeRateBps).toBe(0);
      expect(quote.feeSats).toBe(0);
      expect(quote.waivedByPlan).toBe(true);
    }

    const selfHosted = quoteGiveawayFinalization({
      giveaway,
      planType: "free",
      deployment: {
        mode: "self-hosted",
        operatorLimits: HOSTED_DEPLOYMENT.operatorLimits,
      },
    });
    expect(selfHosted.feeRateBps).toBe(0);
    expect(selfHosted.feeSats).toBe(0);
    expect(selfHosted.waivedByPlan).toBe(true);
    expect(selfHosted.lockConfigHash).toBe(free.lockConfigHash);

    const empty = quoteGiveawayFinalization({
      giveaway: {
        ...giveaway,
        winnerSnapshot: [],
        plannedPayoutSats: 0,
      },
      planType: "free",
      deployment: HOSTED_DEPLOYMENT,
    });
    expect(empty.plannedPayoutSats).toBe(0);
    expect(empty.feeSats).toBe(0);
    expect(empty.waivedByPlan).toBe(false);
    expect(empty.feeRateBps).toBe(1000);

    const implicit = quoteGiveawayFinalization({
      giveaway,
      planType: "free",
    });
    expect([free.feeRateBps, selfHosted.feeRateBps]).toContain(
      implicit.feeRateBps
    );
    expect(implicit.lockConfigHash).toBe(free.lockConfigHash);
  });
});
