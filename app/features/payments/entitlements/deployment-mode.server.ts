import {
  allowsMultipleAccounts,
  effectiveAccountLimit,
  readPublicDeployment,
  relayFanoutAllowed,
  resolveBroadcastLimits,
  resolveExecutionEntitlements,
  resolveGiveawayLimits,
  type PublicDeployment,
} from "~/features/payments/entitlements/deployment-mode";

/**
 * Deployment mode for this process. Read from the environment on each call
 * so tests can vary it. HTTP requests cannot set it. Changing it does not
 * rewrite subscription rows.
 */
export function currentDeployment(
  source: Record<string, string | undefined> = process.env
): PublicDeployment {
  return readPublicDeployment(source);
}

export function operatorBlastrConfigured(
  source: Record<string, string | undefined> = process.env
): boolean {
  return (
    (source["BLASTR_ADMIN_URL"]?.trim() ?? "") !== "" &&
    (source["BLASTR_ADMIN_API_TOKEN"]?.trim() ?? "") !== ""
  );
}

export function getEffectivePlanEntitlements(planType: string) {
  return resolveExecutionEntitlements(planType, currentDeployment());
}

export function getEffectiveBroadcastPlanLimits(planType: string) {
  return resolveBroadcastLimits(planType, currentDeployment());
}

export function getEffectiveGiveawayPlanLimits(planType: string) {
  return resolveGiveawayLimits(planType, currentDeployment());
}

export function multiAccountAccess(accountsIncluded: number): boolean {
  return allowsMultipleAccounts(accountsIncluded, currentDeployment());
}

export function accountLimitForDisplay(
  accountsIncluded: number
): number | null {
  return effectiveAccountLimit(accountsIncluded, currentDeployment());
}

export function relayFanoutForSubscription(input: {
  subscriptionActive: boolean;
  planEnablesRelayBlast: boolean;
}): boolean {
  return relayFanoutAllowed({
    deployment: currentDeployment(),
    operatorBlastrConfigured: operatorBlastrConfigured(),
    subscriptionActive: input.subscriptionActive,
    planEnablesRelayBlast: input.planEnablesRelayBlast,
  });
}
