import { beforeEach, describe, expect, it, vi } from "vitest";

const deploymentServer = vi.hoisted(() => ({
  currentDeployment: vi.fn(),
}));

vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => deploymentServer
);

import { quoteContestFinalization } from "~/features/contest/contest-finalization-fee.server";
import {
  HOSTED_DEPLOYMENT,
  readPublicDeployment,
} from "~/features/payments/entitlements/deployment-mode";
import { currentDeployment } from "~/features/payments/entitlements/deployment-mode.server";

const END = new Date("2026-03-25T12:00:00.000Z");
const SELF_HOSTED = readPublicDeployment({ SELF_HOSTED: "true" });

describe("quoteContestFinalization", () => {
  beforeEach(() => {
    vi.mocked(currentDeployment).mockReset();
    vi.mocked(currentDeployment).mockReturnValue(HOSTED_DEPLOYMENT);
  });

  it("quotes a hosted free equal pool without reading the process deployment", () => {
    const quote = quoteContestFinalization({
      contest: {
        sourceNoteId: "note123",
        rankingMetric: "ZAPS",
        contestEndAt: END,
        prizeMode: "EQUAL",
        winnerCount: 3,
        equalRewardSats: 1000,
      },
      planType: "free",
      deployment: HOSTED_DEPLOYMENT,
    });

    expect(quote.plannedPayoutSats).toBe(3000);
    expect(quote.feeRateBps).toBe(1000);
    expect(quote.feeSats).toBe(300);
    expect(quote.waivedByPlan).toBe(false);
    expect(quote.lockConfigHash).toMatch(/^[a-f0-9]{64}$/);
    expect(currentDeployment).not.toHaveBeenCalled();
  });

  it("uses the injected deployment when the caller omits one", () => {
    const quote = quoteContestFinalization({
      contest: {
        sourceNoteId: "note123",
        rankingMetric: "ZAPS",
        contestEndAt: END,
        prizeMode: "EQUAL",
        winnerCount: 1,
        equalRewardSats: 1000,
      },
      planType: "starter",
    });

    expect(currentDeployment).toHaveBeenCalledTimes(1);
    expect(quote.feeRateBps).toBe(750);
    expect(quote.feeSats).toBe(75);
    expect(quote.waivedByPlan).toBe(false);
  });

  it("waives a positive hosted pro pool and a self-hosted free pool", () => {
    const hosted = quoteContestFinalization({
      contest: {
        sourceNoteId: "note123",
        rankingMetric: "ZAPS",
        contestEndAt: END,
        prizeMode: "EQUAL",
        winnerCount: 1,
        equalRewardSats: 1000,
      },
      planType: "pro",
      deployment: HOSTED_DEPLOYMENT,
    });
    const selfHosted = quoteContestFinalization({
      contest: {
        sourceNoteId: "note123",
        rankingMetric: "ZAPS",
        contestEndAt: END,
        prizeMode: "EQUAL",
        winnerCount: 1,
        equalRewardSats: 1000,
      },
      planType: "free",
      deployment: SELF_HOSTED,
    });

    expect(hosted.feeSats).toBe(0);
    expect(hosted.waivedByPlan).toBe(true);
    expect(selfHosted.feeRateBps).toBe(0);
    expect(selfHosted.feeSats).toBe(0);
    expect(selfHosted.waivedByPlan).toBe(true);
    expect(currentDeployment).not.toHaveBeenCalled();
  });

  it("clamps a negative equal reward to a zero pool that is not a waiver", () => {
    const quote = quoteContestFinalization({
      contest: {
        sourceNoteId: "note123",
        rankingMetric: "REACTIONS",
        contestEndAt: END,
        prizeMode: "EQUAL",
        winnerCount: 4,
        equalRewardSats: -20,
      },
      planType: "free",
      deployment: HOSTED_DEPLOYMENT,
    });

    expect(quote.plannedPayoutSats).toBe(0);
    expect(quote.feeSats).toBe(0);
    expect(quote.waivedByPlan).toBe(false);
  });

  it("sums only the winner-count slice of ranked rewards", () => {
    const quote = quoteContestFinalization({
      contest: {
        sourceNoteId: "note123",
        rankingMetric: "ZAPS",
        contestEndAt: END,
        prizeMode: "RANKED",
        winnerCount: 2,
        rankRewards: [
          { rank: 3, sats: 999 },
          { rank: 1, sats: 500 },
          { rank: 2, sats: 100 },
        ],
      },
      planType: "teams",
      deployment: HOSTED_DEPLOYMENT,
    });

    expect(quote.plannedPayoutSats).toBe(600);
    expect(quote.feeRateBps).toBe(0);
    expect(quote.feeSats).toBe(0);
    expect(quote.waivedByPlan).toBe(true);
  });

  it("hashes omitted optional fields the same as explicit nulls and sorted rewards", () => {
    const omitted = quoteContestFinalization({
      contest: {
        sourceNoteId: "note123",
        rankingMetric: "ZAPS",
        contestEndAt: END,
        prizeMode: "RANKED",
        winnerCount: 2,
        rankRewards: [
          { rank: 2, sats: 10 },
          { rank: 1, sats: 20 },
        ],
      },
      planType: "pro",
      deployment: HOSTED_DEPLOYMENT,
    });
    const explicit = quoteContestFinalization({
      contest: {
        sourceNoteId: "note123",
        rankingMetric: "ZAPS",
        contestEndAt: END,
        prizeMode: "RANKED",
        winnerCount: 2,
        equalRewardSats: null,
        rankRewards: [
          { rank: 1, sats: 20 },
          { rank: 2, sats: 10 },
        ],
        fairnessConfig: null,
        tieBreakRule: null,
        snapshotId: null,
      },
      planType: "creator",
      deployment: SELF_HOSTED,
    });
    const changed = quoteContestFinalization({
      contest: {
        sourceNoteId: "other-note",
        rankingMetric: "ZAPS",
        contestEndAt: END,
        prizeMode: "RANKED",
        winnerCount: 2,
        rankRewards: [
          { rank: 1, sats: 20 },
          { rank: 2, sats: 10 },
        ],
      },
      planType: "pro",
      deployment: HOSTED_DEPLOYMENT,
    });

    expect(omitted.lockConfigHash).toBe(explicit.lockConfigHash);
    expect(changed.lockConfigHash).not.toBe(omitted.lockConfigHash);
  });

  it("throws when the planned pool is outside the storable sat range", () => {
    expect(() =>
      quoteContestFinalization({
        contest: {
          sourceNoteId: "note123",
          rankingMetric: "ZAPS",
          contestEndAt: END,
          prizeMode: "EQUAL",
          winnerCount: 3,
          equalRewardSats: 1_000_000_000,
        },
        planType: "free",
        deployment: HOSTED_DEPLOYMENT,
      })
    ).toThrow(RangeError);
  });
});
