import type { PublicDeployment } from "~/features/payments/entitlements/deployment-mode";
import { campaignFinalizationFeeRateBps } from "~/features/payments/plan-policy";

/** Largest prize pool the campaign tables can store, in whole sats. */
export const MAX_CAMPAIGN_PAYOUT_SATS = 2_147_483_647;

/**
 * Commission actually charged for a campaign finalization.
 * Hosted mode uses the plan table. A self-hosted process charges nothing.
 * The deployment value has to come from the server environment. A header,
 * cookie, query parameter, or account field is not a deployment.
 */
export function effectiveCampaignFinalizationFeeRateBps(
  planType: string,
  deployment: PublicDeployment
): number {
  if (deployment.mode === "self-hosted") return 0;
  return campaignFinalizationFeeRateBps(planType);
}

/** 1000 -> "10%", 750 -> "7.5%", 500 -> "5%", 0 -> "0%". */
export function formatCampaignCommissionPercent(bps: number): string {
  if (!Number.isSafeInteger(bps) || bps <= 0) return "0%";
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return `${whole}%`;
  if (fraction % 10 === 0) return `${whole}.${fraction / 10}%`;
  return `${whole}.${String(fraction).padStart(2, "0")}%`;
}

export function campaignCommissionCallout(bps: number, planId: string): string {
  const label = formatCampaignCommissionPercent(bps);
  if (planId === "free" && bps > 0) {
    return `${label} fee on Lightning campaign prize pools`;
  }
  return `${label} campaign commission`;
}

export function isStorablePlannedPayoutSats(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_CAMPAIGN_PAYOUT_SATS
  );
}

/**
 * Integer fee in sats. `floor(pool * bps / 10000)`. A positive pool with a
 * positive rate and a floor of zero costs 1 sat. A zero rate charges nothing.
 */
export function computeCampaignFinalizationFeeSats(
  plannedPayoutSats: number,
  feeRateBps: number
): { feeSats: number; waivedByPlan: boolean } {
  if (!isStorablePlannedPayoutSats(plannedPayoutSats)) {
    throw new RangeError(
      "Planned payout is outside the supported whole-sat range"
    );
  }
  if (
    !Number.isSafeInteger(feeRateBps) ||
    feeRateBps < 0 ||
    feeRateBps > 10_000
  ) {
    throw new RangeError(
      "Campaign commission rate is not a supported basis-point value"
    );
  }
  if (feeRateBps === 0) {
    return { feeSats: 0, waivedByPlan: plannedPayoutSats > 0 };
  }
  if (plannedPayoutSats === 0) {
    return { feeSats: 0, waivedByPlan: false };
  }
  let feeSats = Number(
    (BigInt(plannedPayoutSats) * BigInt(feeRateBps)) / 10_000n
  );
  if (feeSats <= 0) feeSats = 1;
  return { feeSats, waivedByPlan: false };
}
