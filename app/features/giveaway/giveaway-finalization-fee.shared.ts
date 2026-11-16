/**
 * Pure finalization fee math (client + server). UI: "Finalization fee".
 */

import { campaignFinalizationFeeRateBps } from "~/features/payments/plan-policy";
import type { PlanType } from "~/features/payments/types";

/** Rates live on the plan policy. Free is 10%, Creator is 5%, other known plans are 0%. */
export function getFinalizationFeeRateBps(planType: PlanType): number {
  return campaignFinalizationFeeRateBps(planType);
}

export function computeFinalizationFeeSats(
  plannedPayoutSats: number,
  feeRateBps: number
): { feeSats: number; waivedByPlan: boolean } {
  if (feeRateBps <= 0) {
    return {
      feeSats: 0,
      waivedByPlan: plannedPayoutSats > 0,
    };
  }
  if (plannedPayoutSats <= 0) {
    return { feeSats: 0, waivedByPlan: false };
  }
  let feeSats = Math.floor((plannedPayoutSats * feeRateBps) / 10000);
  if (feeSats === 0) {
    feeSats = 1;
  }
  return { feeSats, waivedByPlan: false };
}
