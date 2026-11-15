import { describe, expect, it } from "vitest";

import {
  allowsMultipleAccounts,
  hostedBlossomStaysOnPlan,
  parseDeploymentMode,
  parseOperatorCap,
  readPublicDeployment,
  relayFanoutAllowed,
  resolveBroadcastLimits,
  resolveExecutionEntitlements,
  resolveGiveawayLimits,
} from "~/features/payments/entitlements/deployment-mode";
import { getCanonicalPlanPolicy } from "~/features/payments/plan-policy";

describe("deployment mode", () => {
  it("stays hosted unless the process flag is explicit", () => {
    expect(parseDeploymentMode(undefined)).toBe("hosted");
    expect(parseDeploymentMode("")).toBe("hosted");
    expect(parseDeploymentMode("false")).toBe("hosted");
    expect(parseDeploymentMode("on")).toBe("hosted");
    expect(parseDeploymentMode("true")).toBe("self-hosted");
    expect(parseDeploymentMode(" YES ")).toBe("self-hosted");
  });

  it("keeps hosted free limits and ignores operator caps", () => {
    const deployment = readPublicDeployment({
      SELF_HOSTED: "false",
      SELF_HOSTED_MAX_FUTURE_SCHEDULED: "1000",
    });
    const entitlements = resolveExecutionEntitlements("free", deployment);
    expect(entitlements.maxFutureScheduledItems).toBe(10);
    expect(entitlements.canExecuteBulkActions).toBe(false);
    expect(entitlements.canSendBroadcast).toBe(false);
    expect(
      resolveBroadcastLimits("starter", deployment).maxRecipientsPerCampaign
    ).toBe(75);
  });

  it("keeps hosted paid limits", () => {
    const deployment = readPublicDeployment({});
    const entitlements = resolveExecutionEntitlements("pro", deployment);
    expect(entitlements.maxFutureScheduledItems).toBe(1000);
    expect(entitlements.canExecuteBulkActions).toBe(true);
    expect(resolveGiveawayLimits("free", deployment).canUsePresets).toBe(false);
  });

  it("unlocks self-hosted software and still honors an operator cap", () => {
    const open = readPublicDeployment({ SELF_HOSTED: "true" });
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
      SELF_HOSTED: "true",
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
    const selfHosted = readPublicDeployment({ SELF_HOSTED: "true" });
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
        deployment: readPublicDeployment({}),
        subscriptionActive: true,
        planEnablesRelayBlast: false,
        operatorBlastrConfigured: true,
      })
    ).toBe(false);
  });
});
