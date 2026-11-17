import { createHash } from "crypto";

import type { PublicDeployment } from "~/features/payments/entitlements/deployment-mode";
import { currentDeployment } from "~/features/payments/entitlements/deployment-mode.server";
import type { PlanType } from "~/features/payments/types";

import {
  computeContestFinalizationFeeSats,
  computePlannedPayoutSats,
  getContestFinalizationFeeRateBps,
  stableSortRankRewards,
} from "./contest-finalization-fee.shared";
import type { ContestPrizeMode, ContestRankReward } from "./types";

function buildContestLockConfigHash(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(payload);
  return createHash("sha256").update(canonical).digest("hex");
}

export function quoteContestFinalization(input: {
  contest: {
    sourceNoteId: string;
    rankingMetric: string;
    contestEndAt: Date;
    prizeMode: ContestPrizeMode;
    winnerCount: number;
    equalRewardSats?: number | null;
    rankRewards?: ContestRankReward[] | null;
    fairnessConfig?: unknown;
    tieBreakRule?: string | null;
    snapshotId?: string | null;
  };
  planType: PlanType;
  /** Server deployment. Callers omit this so the process environment is used. */
  deployment?: PublicDeployment;
}) {
  const plannedPayoutSats = computePlannedPayoutSats(input.contest);
  const feeRateBps = getContestFinalizationFeeRateBps(
    input.planType,
    input.deployment ?? currentDeployment()
  );
  const { feeSats, waivedByPlan } = computeContestFinalizationFeeSats(
    plannedPayoutSats,
    feeRateBps
  );

  const lockConfigHash = buildContestLockConfigHash({
    sourceNoteId: input.contest.sourceNoteId,
    rankingMetric: input.contest.rankingMetric,
    contestEndAt: input.contest.contestEndAt.toISOString(),
    prizeMode: input.contest.prizeMode,
    winnerCount: input.contest.winnerCount,
    equalRewardSats: input.contest.equalRewardSats ?? null,
    rankRewards: stableSortRankRewards(input.contest.rankRewards ?? []),
    fairnessConfig: input.contest.fairnessConfig ?? null,
    tieBreakRule: input.contest.tieBreakRule ?? null,
    snapshotId: input.contest.snapshotId ?? null,
  });

  return {
    plannedPayoutSats,
    feeRateBps,
    feeSats,
    waivedByPlan,
    lockConfigHash,
  };
}
