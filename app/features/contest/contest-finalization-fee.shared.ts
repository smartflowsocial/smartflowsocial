import {
  computeCampaignFinalizationFeeSats,
  effectiveCampaignFinalizationFeeRateBps,
} from "~/features/payments/campaign-fee-policy";
import {
  HOSTED_DEPLOYMENT,
  type PublicDeployment,
} from "~/features/payments/entitlements/deployment-mode";
import type { PlanType } from "~/features/payments/types";

import type { ContestPrizeMode, ContestRankReward } from "./types";

export function stableSortRankRewards(
  rankRewards: ContestRankReward[]
): ContestRankReward[] {
  return [...rankRewards].sort((a, b) => a.rank - b.rank);
}

/** Planned prize pool (sats) from contest prize settings  -  shared by quotes and builder UI. */
export function computePlannedPayoutSats(input: {
  prizeMode: ContestPrizeMode;
  winnerCount: number;
  equalRewardSats?: number | null;
  rankRewards?: ContestRankReward[] | null;
}): number {
  if (input.prizeMode === "EQUAL") {
    return (
      Math.max(0, input.winnerCount) * Math.max(0, input.equalRewardSats ?? 0)
    );
  }
  const rewards = stableSortRankRewards(input.rankRewards ?? []);
  return rewards
    .slice(0, Math.max(0, input.winnerCount))
    .reduce((sum, row) => sum + Math.max(0, row.sats), 0);
}

export function getContestFinalizationFeeRateBps(
  planType: PlanType,
  deployment: PublicDeployment = HOSTED_DEPLOYMENT
): number {
  return effectiveCampaignFinalizationFeeRateBps(planType, deployment);
}

export function computeContestFinalizationFeeSats(
  plannedPayoutSats: number,
  feeRateBps: number
): { feeSats: number; waivedByPlan: boolean } {
  return computeCampaignFinalizationFeeSats(plannedPayoutSats, feeRateBps);
}
