import { getPlanEntitlements } from "~/features/payments/entitlements/plan-entitlements";
import type { PlanEntitlements } from "~/features/payments/entitlements/plan-entitlements";
import { mapLegacyPlanIdToCommercialPlanType } from "~/features/payments/plan-mapping";
import {
  getCanonicalPlanPolicy,
  toBroadcastLimits,
  toGiveawayLimits,
} from "~/features/payments/plan-policy";
import type { BroadcastAudienceGate } from "~/features/payments/types";
import {
  DeploymentModeError,
  parseDeploymentMode,
  resolveDeploymentMode,
  type DeploymentMode,
} from "~/lib/deployment-mode";

export { DeploymentModeError, parseDeploymentMode, resolveDeploymentMode };
export type {
  DeploymentMode,
  DeploymentModeDecision,
} from "~/lib/deployment-mode";

/**
 * How this process applies commercial plans.
 *
 * `self-hosted` is the install default. It unlocks software the operator runs
 * and charges no platform commission. It does not unlock SmartFlowSocial
 * hosted Blossom or hosted Blastr. `hosted` is the managed service and keeps
 * Free, Starter, Creator, Pro, and Founder limits. Production, and the
 * managed app hosts, must opt into `hosted` explicitly.
 *
 * The mode comes from the server process environment. A cookie, header, or
 * account field cannot change it.
 */
const SELF_HOSTED_MODE = "self-hosted" as const;

export interface OperatorSoftwareLimits {
  /** null means the operator did not set a cap. */
  maxFutureScheduledItems: number | null;
  maxQueues: number | null;
  maxDrafts: number | null;
  maxTemplates: number | null;
  maxAccounts: number | null;
  maxBroadcastRecipients: number | null;
  maxConcurrentBroadcasts: number | null;
  maxDailyBroadcastRecipients: number | null;
  maxGiveawayWinners: number | null;
}

export interface PublicDeployment {
  mode: DeploymentMode;
  operatorLimits: OperatorSoftwareLimits;
}

export interface ResolvedBroadcastLimits {
  maxRecipientsPerCampaign: number | null;
  maxConcurrentActiveCampaigns: number | null;
  maxDailyBroadcastRecipients: number | null;
  allowedAudienceTypes: BroadcastAudienceGate[];
  allowAdvancedDelivery: boolean;
  allowSchedule: boolean;
  allowStaggered: boolean;
}

const EMPTY_LIMITS: OperatorSoftwareLimits = {
  maxFutureScheduledItems: null,
  maxQueues: null,
  maxDrafts: null,
  maxTemplates: null,
  maxAccounts: null,
  maxBroadcastRecipients: null,
  maxConcurrentBroadcasts: null,
  maxDailyBroadcastRecipients: null,
  maxGiveawayWinners: null,
};

export const HOSTED_DEPLOYMENT: PublicDeployment = {
  mode: "hosted",
  operatorLimits: EMPTY_LIMITS,
};

/** Winner counts at or above this are an install with no commercial cap. */
export const OPEN_WINNER_CAP = 1_000_000;

/**
 * Blank means no operator cap. A non-numeric value is 0 so a typo cannot
 * remove the cap.
 */
export function parseOperatorCap(value: string | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return 0;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) return 0;
  return parsed;
}

export function readPublicDeployment(
  source: Record<string, string | undefined>
): PublicDeployment {
  const decision = resolveDeploymentMode(source);
  if (!decision.ok) {
    throw new DeploymentModeError(decision.reason);
  }
  return {
    mode: decision.mode,
    operatorLimits: {
      maxFutureScheduledItems: parseOperatorCap(
        source["SELF_HOSTED_MAX_FUTURE_SCHEDULED"]
      ),
      maxQueues: parseOperatorCap(source["SELF_HOSTED_MAX_QUEUES"]),
      maxDrafts: parseOperatorCap(source["SELF_HOSTED_MAX_DRAFTS"]),
      maxTemplates: parseOperatorCap(source["SELF_HOSTED_MAX_TEMPLATES"]),
      maxAccounts: parseOperatorCap(source["SELF_HOSTED_MAX_ACCOUNTS"]),
      maxBroadcastRecipients: parseOperatorCap(
        source["SELF_HOSTED_MAX_BROADCAST_RECIPIENTS"]
      ),
      maxConcurrentBroadcasts: parseOperatorCap(
        source["SELF_HOSTED_MAX_CONCURRENT_BROADCASTS"]
      ),
      maxDailyBroadcastRecipients: parseOperatorCap(
        source["SELF_HOSTED_MAX_DAILY_BROADCAST_RECIPIENTS"]
      ),
      maxGiveawayWinners: parseOperatorCap(
        source["SELF_HOSTED_MAX_GIVEAWAY_WINNERS"]
      ),
    },
  };
}

export function resolveExecutionEntitlements(
  planType: string,
  deployment: PublicDeployment
): PlanEntitlements {
  const commercial = getPlanEntitlements(planType);
  if (deployment.mode !== SELF_HOSTED_MODE) return commercial;
  return {
    maxFutureScheduledItems: deployment.operatorLimits.maxFutureScheduledItems,
    maxQueues: deployment.operatorLimits.maxQueues,
    maxDrafts: deployment.operatorLimits.maxDrafts,
    maxTemplates: deployment.operatorLimits.maxTemplates,
    canSendBroadcast: true,
    canExecuteBulkActions: true,
  };
}

export function resolveBroadcastLimits(
  planType: string,
  deployment: PublicDeployment
): ResolvedBroadcastLimits {
  const commercial = toBroadcastLimits(
    getCanonicalPlanPolicy(mapLegacyPlanIdToCommercialPlanType(planType))
  );
  if (deployment.mode !== SELF_HOSTED_MODE) return commercial;
  return {
    maxRecipientsPerCampaign: deployment.operatorLimits.maxBroadcastRecipients,
    maxConcurrentActiveCampaigns:
      deployment.operatorLimits.maxConcurrentBroadcasts,
    maxDailyBroadcastRecipients:
      deployment.operatorLimits.maxDailyBroadcastRecipients,
    allowedAudienceTypes: ["CUSTOM", "MUTUALS"],
    allowAdvancedDelivery: true,
    allowSchedule: true,
    allowStaggered: true,
  };
}

export function resolveGiveawayLimits(
  planType: string,
  deployment: PublicDeployment
): {
  maxWinnerCount: number;
  canUseQueueScope: boolean;
  canUsePresets: boolean;
} {
  const commercial = toGiveawayLimits(
    getCanonicalPlanPolicy(mapLegacyPlanIdToCommercialPlanType(planType))
  );
  if (deployment.mode !== SELF_HOSTED_MODE) return commercial;
  return {
    maxWinnerCount:
      deployment.operatorLimits.maxGiveawayWinners ?? Number.MAX_SAFE_INTEGER,
    canUseQueueScope: true,
    canUsePresets: true,
  };
}

export function allowsMultipleAccounts(
  accountsIncluded: number,
  deployment: PublicDeployment
): boolean {
  if (deployment.mode !== SELF_HOSTED_MODE) return accountsIncluded > 1;
  const cap = deployment.operatorLimits.maxAccounts;
  return cap == null || cap > 1;
}

export function effectiveAccountLimit(
  accountsIncluded: number,
  deployment: PublicDeployment
): number | null {
  if (deployment.mode !== SELF_HOSTED_MODE) return accountsIncluded;
  return deployment.operatorLimits.maxAccounts;
}

/**
 * Hosted Blossom storage stays on the commercial plan in every mode.
 * Self-hosting does not make SmartFlowSocial's media service free.
 */
export function hostedBlossomStaysOnPlan(
  canUseSfsBlossomStorage: boolean,
  _deployment: PublicDeployment
): boolean {
  return canUseSfsBlossomStorage;
}

/**
 * Relay fan-out against a Blastr the operator configured themselves.
 * Hosted mode still requires the paid plan flag. A self-hosted install
 * without Blastr credentials does not gain SmartFlowSocial hosted Blastr.
 */
export function relayFanoutAllowed(input: {
  deployment: PublicDeployment;
  subscriptionActive: boolean;
  planEnablesRelayBlast: boolean;
  operatorBlastrConfigured: boolean;
}): boolean {
  if (input.deployment.mode === SELF_HOSTED_MODE) {
    return input.operatorBlastrConfigured;
  }
  return input.subscriptionActive && input.planEnablesRelayBlast;
}

export function exceedsCap(count: number, cap: number | null): boolean {
  return cap != null && count > cap;
}

export function atOrOverCap(count: number, cap: number | null): boolean {
  return cap != null && count >= cap;
}

export function capMessage(
  hostedMessage: string,
  installMessage: string,
  deployment: PublicDeployment
): string {
  return deployment.mode === SELF_HOSTED_MODE ? installMessage : hostedMessage;
}
