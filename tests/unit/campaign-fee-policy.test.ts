import { describe, expect, it } from "vitest";

import {
  campaignCommissionCallout,
  computeCampaignFinalizationFeeSats,
  effectiveCampaignFinalizationFeeRateBps,
  formatCampaignCommissionPercent,
  MAX_CAMPAIGN_PAYOUT_SATS,
} from "~/features/payments/campaign-fee-policy";
import {
  HOSTED_DEPLOYMENT,
  readPublicDeployment,
} from "~/features/payments/entitlements/deployment-mode";
import { campaignFinalizationFeeRateBps } from "~/features/payments/plan-policy";

const PLANS = [
  "free",
  "starter",
  "creator",
  "pro",
  "teams",
  "founder",
] as const;
const HOSTED_BPS: Record<(typeof PLANS)[number], number> = {
  free: 1000,
  starter: 750,
  creator: 500,
  pro: 0,
  teams: 0,
  founder: 0,
};

describe("campaign finalization commission", () => {
  it("charges the published hosted rates in basis points", () => {
    for (const plan of PLANS) {
      expect(campaignFinalizationFeeRateBps(plan)).toBe(HOSTED_BPS[plan]);
      expect(
        effectiveCampaignFinalizationFeeRateBps(plan, HOSTED_DEPLOYMENT)
      ).toBe(HOSTED_BPS[plan]);
    }
    expect(formatCampaignCommissionPercent(750)).toBe("7.5%");
    expect(formatCampaignCommissionPercent(1000)).toBe("10%");
    expect(campaignCommissionCallout(1000, "free")).toBe(
      "10% fee on Lightning campaign prize pools"
    );
    expect(campaignCommissionCallout(750, "starter")).toBe(
      "7.5% campaign commission"
    );
  });

  it("charges every self-hosted plan zero and ignores client-shaped fields", () => {
    const selfHosted = readPublicDeployment({
      SFS_DEPLOYMENT_MODE: "self_hosted",
      "x-self-hosted": "false",
    });
    const hostedDespiteHeader = readPublicDeployment({
      SFS_DEPLOYMENT_MODE: "hosted",
      cookie: "self-hosted",
      "x-deployment-mode": "self-hosted",
    });
    expect(hostedDespiteHeader.mode).toBe("hosted");
    for (const plan of PLANS) {
      expect(effectiveCampaignFinalizationFeeRateBps(plan, selfHosted)).toBe(0);
      expect(
        effectiveCampaignFinalizationFeeRateBps(plan, hostedDespiteHeader)
      ).toBe(HOSTED_BPS[plan]);
    }
    expect(campaignFinalizationFeeRateBps("not-a-plan")).toBe(0);
  });

  it("rounds prize pools with integer math, including the 1 sat minimum", () => {
    expect(computeCampaignFinalizationFeeSats(0, 1000)).toEqual({
      feeSats: 0,
      waivedByPlan: false,
    });
    expect(computeCampaignFinalizationFeeSats(10_000, 0)).toEqual({
      feeSats: 0,
      waivedByPlan: true,
    });
    expect(computeCampaignFinalizationFeeSats(1, 750)).toEqual({
      feeSats: 1,
      waivedByPlan: false,
    });
    expect(computeCampaignFinalizationFeeSats(10_000, 750)).toEqual({
      feeSats: 750,
      waivedByPlan: false,
    });
    expect(computeCampaignFinalizationFeeSats(11, 500)).toEqual({
      feeSats: 1,
      waivedByPlan: false,
    });
    expect(
      computeCampaignFinalizationFeeSats(MAX_CAMPAIGN_PAYOUT_SATS, 1000).feeSats
    ).toBe(214_748_364);
  });

  it("rejects amounts the campaign tables cannot store", () => {
    expect(() =>
      computeCampaignFinalizationFeeSats(MAX_CAMPAIGN_PAYOUT_SATS + 1, 1000)
    ).toThrow(RangeError);
    expect(() => computeCampaignFinalizationFeeSats(1.5, 1000)).toThrow(
      RangeError
    );
    expect(() => computeCampaignFinalizationFeeSats(-1, 1000)).toThrow(
      RangeError
    );
  });
});
