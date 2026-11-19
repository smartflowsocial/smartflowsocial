import { describe, expect, it } from "vitest";

import { quoteContestFinalization } from "~/features/contest/contest-finalization-fee.server";
import { readPublicDeployment } from "~/features/payments/entitlements/deployment-mode";

describe("quoteContestFinalization", () => {
  it("calculates equal-mode payout and fee for free plan", () => {
    const quote = quoteContestFinalization({
      contest: {
        sourceNoteId: "note123",
        rankingMetric: "ZAPS",
        contestEndAt: new Date("2026-03-25T12:00:00.000Z"),
        prizeMode: "EQUAL",
        winnerCount: 3,
        equalRewardSats: 1000,
      },
      planType: "free",
    });

    expect(quote.plannedPayoutSats).toBe(3000);
    expect(quote.feeRateBps).toBe(1000);
    expect(quote.feeSats).toBe(300);
  });

  it("calculates ranked-mode payout and waived fee for pro plan", () => {
    const quote = quoteContestFinalization({
      contest: {
        sourceNoteId: "note123",
        rankingMetric: "SATS_ZAPPED",
        contestEndAt: new Date("2026-03-25T12:00:00.000Z"),
        prizeMode: "RANKED",
        winnerCount: 3,
        rankRewards: [
          { rank: 1, sats: 5000 },
          { rank: 2, sats: 2000 },
          { rank: 3, sats: 1000 },
        ],
      },
      planType: "pro",
    });

    expect(quote.plannedPayoutSats).toBe(8000);
    expect(quote.feeRateBps).toBe(0);
    expect(quote.feeSats).toBe(0);
    expect(quote.waivedByPlan).toBe(true);
  });

  it("charges hosted Starter 7.5% and does not charge Teams", () => {
    const contest = {
      sourceNoteId: "note123",
      rankingMetric: "ZAPS" as const,
      contestEndAt: new Date("2026-03-25T12:00:00.000Z"),
      prizeMode: "EQUAL" as const,
      winnerCount: 1,
      equalRewardSats: 1000,
    };
    const starter = quoteContestFinalization({
      contest,
      planType: "starter",
    });
    const teams = quoteContestFinalization({ contest, planType: "teams" });
    expect(starter.feeRateBps).toBe(750);
    expect(starter.feeSats).toBe(75);
    expect(teams.feeRateBps).toBe(0);
    expect(teams.feeSats).toBe(0);
  });

  it("charges a self-hosted contest nothing, including Free", () => {
    const selfHosted = readPublicDeployment({
      SFS_DEPLOYMENT_MODE: "self_hosted",
    });
    const quote = quoteContestFinalization({
      contest: {
        sourceNoteId: "note123",
        rankingMetric: "ZAPS",
        contestEndAt: new Date("2026-03-25T12:00:00.000Z"),
        prizeMode: "EQUAL",
        winnerCount: 3,
        equalRewardSats: 1000,
      },
      planType: "free",
      deployment: selfHosted,
    });
    expect(quote.feeRateBps).toBe(0);
    expect(quote.feeSats).toBe(0);
    expect(quote.waivedByPlan).toBe(true);
  });
});
