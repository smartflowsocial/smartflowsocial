import {
  allowsMultipleAccounts,
  readPublicDeployment,
  type PublicDeployment,
} from "~/features/payments/entitlements/deployment-mode";
import { parseCommercialPlanType } from "~/features/payments/plan-mapping";
import { getCanonicalPlanPolicy } from "~/features/payments/plan-policy";

export const LINKED_CHILD_BILLING_ERROR =
  "This account uses its parent account's plan. Switch to the parent account to manage billing.";

interface ParentSubscriptionForChild {
  status: string;
  planId: string | null;
  currentPeriodEnd: Date | null;
  Plan?: {
    name?: string | null;
    enableLifetimeAccess?: boolean;
  } | null;
}

/**
 * A linked child uses the parent's plan while that plan is paid, in period,
 * and includes more than one account. The child's own subscription row is
 * ignored in that case.
 */
export function parentSubscriptionCoversLinkedChild(
  subscription: ParentSubscriptionForChild | null,
  options?: { now?: Date; deployment?: PublicDeployment }
): boolean {
  if (!subscription?.planId || subscription.status !== "ACTIVE") {
    return false;
  }

  const commercial = parseCommercialPlanType(subscription.planId);
  if (!commercial || commercial === "free") return false;

  const deployment = options?.deployment ?? readPublicDeployment({});
  const accountsIncluded = getCanonicalPlanPolicy(commercial).accountsIncluded;
  if (!allowsMultipleAccounts(accountsIncluded, deployment)) return false;

  if (subscription.Plan?.enableLifetimeAccess) return true;
  if (!subscription.currentPeriodEnd) return true;

  const now = options?.now ?? new Date();
  return subscription.currentPeriodEnd.getTime() >= now.getTime();
}
