import { FREE_PLAN_ID } from "~/features/payments/plan-ids";

export interface PlansPricingSubscription {
  planId: string | null;
  isExpired: boolean;
}

/**
 * Free is not purchasable. After a paid plan lapses, access is already Free,
 * so that card is the current plan instead of a disabled "Start free" button.
 * The lapsed paid tier stays renewable.
 */
export function pricingCardPlanState(params: {
  planId: string;
  subscription: PlansPricingSubscription | null;
  isSignedIn: boolean;
}): { isCurrentPlan: boolean; isCurrentPlanExpired: boolean } {
  const { planId, subscription, isSignedIn } = params;
  const storedPlanId = subscription?.planId ?? null;
  const subscriptionLapsed = subscription?.isExpired === true;
  const effectivelyOnFree =
    isSignedIn &&
    (subscription == null ||
      subscriptionLapsed ||
      storedPlanId == null ||
      storedPlanId === FREE_PLAN_ID);

  if (planId === FREE_PLAN_ID) {
    return {
      isCurrentPlan: effectivelyOnFree,
      isCurrentPlanExpired: false,
    };
  }

  const isStoredPlan = storedPlanId === planId;
  return {
    isCurrentPlan: isStoredPlan,
    isCurrentPlanExpired: isStoredPlan && subscriptionLapsed,
  };
}
