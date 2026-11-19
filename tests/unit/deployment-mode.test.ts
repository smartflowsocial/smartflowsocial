import { describe, expect, it } from "vitest";

import { effectiveCampaignFinalizationFeeRateBps } from "~/features/payments/campaign-fee-policy";
import {
  allowsMultipleAccounts,
  DeploymentModeError,
  hostedBlossomStaysOnPlan,
  parseDeploymentMode,
  parseOperatorCap,
  readPublicDeployment,
  relayFanoutAllowed,
  resolveBroadcastLimits,
  resolveDeploymentMode,
  resolveExecutionEntitlements,
  resolveGiveawayLimits,
} from "~/features/payments/entitlements/deployment-mode";
import { getCanonicalPlanPolicy } from "~/features/payments/plan-policy";

const HOSTED = { SFS_DEPLOYMENT_MODE: "hosted" };

describe("deployment mode", () => {
  it("defaults a fresh install to self-hosted and keeps an explicit mode", () => {
    const fresh = resolveDeploymentMode({});
    const development = resolveDeploymentMode({ NODE_ENV: "development" });
    expect(fresh.ok && fresh.mode).toBe("self-hosted");
    expect(development.ok && development.source).toBe("default");
    const production = resolveDeploymentMode({ NODE_ENV: "production" });
    expect(production.ok && production.mode).toBe("self-hosted");
    expect(production.ok && production.source).toBe("default");
    expect(parseDeploymentMode("hosted")).toBe("hosted");
    expect(parseDeploymentMode(" self_hosted ")).toBe("self-hosted");
    expect(parseDeploymentMode("self-hosted")).toBe("self-hosted");
    expect(() => parseDeploymentMode(undefined)).toThrow(DeploymentModeError);
    expect(() => parseDeploymentMode("true")).toThrow(DeploymentModeError);
    expect(() => parseDeploymentMode("on")).toThrow(DeploymentModeError);
    const explicitSelfHosted = resolveDeploymentMode({
      SFS_DEPLOYMENT_MODE: "self_hosted",
    });
    const explicitHosted = resolveDeploymentMode(HOSTED);
    expect(explicitSelfHosted.ok && explicitSelfHosted.mode).toBe(
      "self-hosted"
    );
    expect(explicitSelfHosted.ok && explicitSelfHosted.source).toBe("explicit");
    expect(explicitHosted.ok && explicitHosted.mode).toBe("hosted");
  });

  it("refuses the old flag and self-hosted policy on the managed hosts", () => {
    const removed = resolveDeploymentMode({ SELF_HOSTED: "false" });
    expect(removed.ok).toBe(false);
    if (!removed.ok) {
      expect(removed.reason).toContain("SELF_HOSTED is no longer supported");
    }
    expect(
      resolveDeploymentMode({
        APP_URL: "https://staging.smartflow.social",
        NODE_ENV: "production",
      }).ok
    ).toBe(false);
    expect(
      resolveDeploymentMode({
        COOLIFY_URL: "https://app.smartflow.social",
        SFS_DEPLOYMENT_MODE: "self_hosted",
      }).ok
    ).toBe(false);
    const managed = resolveDeploymentMode({
      APP_URL: "https://app.smartflow.social",
      SFS_DEPLOYMENT_MODE: "hosted",
      cookie: "self-hosted",
    });
    expect(managed.ok && managed.mode).toBe("hosted");
    expect(resolveDeploymentMode({ SFS_DEPLOYMENT_MODE: "cloud" }).ok).toBe(
      false
    );
    expect(resolveDeploymentMode({ SELF_HOSTED: "on" }).ok).toBe(false);
    expect(() =>
      readPublicDeployment({
        APP_URL: "https://staging.smartflow.social",
      })
    ).toThrow(DeploymentModeError);
    expect(readPublicDeployment({ NODE_ENV: "production" }).mode).toBe(
      "self-hosted"
    );
  });

  it("charges no platform commission on a fresh install and keeps hosted rates", () => {
    const fresh = readPublicDeployment({});
    const hosted = readPublicDeployment({
      ...HOSTED,
      cookie: "self-hosted",
      "x-deployment-mode": "self-hosted",
    });
    expect(fresh.mode).toBe("self-hosted");
    expect(hosted.mode).toBe("hosted");
    for (const plan of [
      "free",
      "starter",
      "creator",
      "pro",
      "teams",
      "founder",
    ]) {
      expect(effectiveCampaignFinalizationFeeRateBps(plan, fresh)).toBe(0);
    }
    expect(effectiveCampaignFinalizationFeeRateBps("free", hosted)).toBe(1000);
    expect(effectiveCampaignFinalizationFeeRateBps("starter", hosted)).toBe(
      750
    );
    expect(effectiveCampaignFinalizationFeeRateBps("creator", hosted)).toBe(
      500
    );
    expect(effectiveCampaignFinalizationFeeRateBps("pro", hosted)).toBe(0);
    expect(effectiveCampaignFinalizationFeeRateBps("teams", hosted)).toBe(0);
    expect(effectiveCampaignFinalizationFeeRateBps("founder", hosted)).toBe(0);
  });

  it("keeps hosted free limits and ignores operator caps", () => {
    const deployment = readPublicDeployment({
      SFS_DEPLOYMENT_MODE: "hosted",
      SELF_HOSTED_MAX_FUTURE_SCHEDULED: "1000",
    });
    const entitlements = resolveExecutionEntitlements("free", deployment);
    expect(entitlements.maxFutureScheduledItems).toBe(10);
    expect(entitlements.canExecuteBulkActions).toBe(true);
    expect(entitlements.canSendBroadcast).toBe(false);
    expect(
      resolveBroadcastLimits("starter", deployment).maxRecipientsPerCampaign
    ).toBe(75);
  });

  it("keeps hosted paid limits", () => {
    const deployment = readPublicDeployment(HOSTED);
    const entitlements = resolveExecutionEntitlements("pro", deployment);
    expect(entitlements.maxFutureScheduledItems).toBe(1000);
    expect(entitlements.canExecuteBulkActions).toBe(true);
    expect(resolveGiveawayLimits("free", deployment).canUsePresets).toBe(false);
  });

  it("unlocks self-hosted software and still honors an operator cap", () => {
    const open = readPublicDeployment({ SFS_DEPLOYMENT_MODE: "self_hosted" });
    const entitlements = resolveExecutionEntitlements("free", open);
    expect(entitlements.maxFutureScheduledItems).toBeNull();
    expect(entitlements.maxDrafts).toBeNull();
    expect(entitlements.canExecuteBulkActions).toBe(true);
    expect(entitlements.canSendBroadcast).toBe(true);
    expect(
      resolveBroadcastLimits("free", open).maxRecipientsPerCampaign
    ).toBeNull();
    expect(resolveBroadcastLimits("free", open).allowSchedule).toBe(true);
    expect(resolveGiveawayLimits("free", open).canUseQueueScope).toBe(true);
    expect(allowsMultipleAccounts(1, open)).toBe(true);

    const capped = readPublicDeployment({
      SFS_DEPLOYMENT_MODE: "self_hosted",
      SELF_HOSTED_MAX_FUTURE_SCHEDULED: "3",
      SELF_HOSTED_MAX_ACCOUNTS: "1",
    });
    expect(
      resolveExecutionEntitlements("free", capped).maxFutureScheduledItems
    ).toBe(3);
    expect(allowsMultipleAccounts(5, capped)).toBe(false);
  });

  it("treats a bad operator cap as zero", () => {
    expect(parseOperatorCap(undefined)).toBeNull();
    expect(parseOperatorCap("")).toBeNull();
    expect(parseOperatorCap("12")).toBe(12);
    expect(parseOperatorCap("lots")).toBe(0);
  });

  it("does not grant hosted Blossom or hosted Blastr", () => {
    const selfHosted = readPublicDeployment({
      SFS_DEPLOYMENT_MODE: "self_hosted",
    });
    const freeMedia =
      getCanonicalPlanPolicy("free").media.canUseSfsBlossomStorage;
    expect(hostedBlossomStaysOnPlan(freeMedia, selfHosted)).toBe(false);
    expect(
      relayFanoutAllowed({
        deployment: selfHosted,
        subscriptionActive: true,
        planEnablesRelayBlast: false,
        operatorBlastrConfigured: false,
      })
    ).toBe(false);
    expect(
      relayFanoutAllowed({
        deployment: selfHosted,
        subscriptionActive: false,
        planEnablesRelayBlast: false,
        operatorBlastrConfigured: true,
      })
    ).toBe(true);
    expect(
      relayFanoutAllowed({
        deployment: readPublicDeployment(HOSTED),
        subscriptionActive: true,
        planEnablesRelayBlast: false,
        operatorBlastrConfigured: true,
      })
    ).toBe(false);
  });
});
