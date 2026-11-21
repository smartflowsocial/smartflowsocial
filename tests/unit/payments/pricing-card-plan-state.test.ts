import { describe, expect, it } from "vitest";

import { pricingCardPlanState } from "~/features/payments/pricing-card-plan-state";

describe("pricingCardPlanState", () => {
  it("keeps an active paid plan current and leaves Free as start-free", () => {
    const subscription = { planId: "creator", isExpired: false };

    expect(
      pricingCardPlanState({
        planId: "creator",
        subscription,
        isSignedIn: true,
      })
    ).toEqual({ isCurrentPlan: true, isCurrentPlanExpired: false });
    expect(
      pricingCardPlanState({
        planId: "free",
        subscription,
        isSignedIn: true,
      })
    ).toEqual({ isCurrentPlan: false, isCurrentPlanExpired: false });
  });

  it("treats Free as the current plan after a paid subscription lapses", () => {
    const subscription = { planId: "creator", isExpired: true };

    expect(
      pricingCardPlanState({
        planId: "free",
        subscription,
        isSignedIn: true,
      })
    ).toEqual({ isCurrentPlan: true, isCurrentPlanExpired: false });
    expect(
      pricingCardPlanState({
        planId: "creator",
        subscription,
        isSignedIn: true,
      })
    ).toEqual({ isCurrentPlan: true, isCurrentPlanExpired: true });
  });

  it("treats an assigned Free subscription as current, even if the row is lapsed", () => {
    expect(
      pricingCardPlanState({
        planId: "free",
        subscription: { planId: "free", isExpired: true },
        isSignedIn: true,
      })
    ).toEqual({ isCurrentPlan: true, isCurrentPlanExpired: false });
  });

  it("does not mark Free as current for a signed-out visitor", () => {
    expect(
      pricingCardPlanState({
        planId: "free",
        subscription: null,
        isSignedIn: false,
      })
    ).toEqual({ isCurrentPlan: false, isCurrentPlanExpired: false });
  });
});
