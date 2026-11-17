/**
 * Pure finalization fee math (client + server). UI: "Finalization fee".
 * Pass the server deployment. The default is hosted, which is the rate a
 * page shows when the root loader did not include a deployment.
 */

import {
  computeCampaignFinalizationFeeSats,
  effectiveCampaignFinalizationFeeRateBps,
} from "~/features/payments/campaign-fee-policy";
import {
  HOSTED_DEPLOYMENT,
  type PublicDeployment,
} from "~/features/payments/entitlements/deployment-mode";
import type { PlanType } from "~/features/payments/types";

export function getFinalizationFeeRateBps(
  planType: PlanType,
  deployment: PublicDeployment = HOSTED_DEPLOYMENT
): number {
  return effectiveCampaignFinalizationFeeRateBps(planType, deployment);
}

export function computeFinalizationFeeSats(
  plannedPayoutSats: number,
  feeRateBps: number
): { feeSats: number; waivedByPlan: boolean } {
  return computeCampaignFinalizationFeeSats(plannedPayoutSats, feeRateBps);
}
