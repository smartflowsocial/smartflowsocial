import { describe, expect, it } from "vitest";

import {
  deriveBillingCommMode,
  deriveBillingContext,
  needsNwcActionRequired,
} from "~/features/payments/services/subscription-status.server";
import type {
  BillingContext,
  SubscriptionBillingPaymentMethod,
} from "~/features/payments/types/subscription-billing.types";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const PERIOD_END = new Date("2099-08-01T12:00:00.000Z");

interface BillingUser {
  id: string;
  isEnabled: boolean;
  npub: string;
  nwcEnabled: boolean;
  encryptedNwc: string | null;
}

interface BillingPlan {
  name: string;
  id: string;
  enableLifetimeAccess?: boolean;
  price?: unknown;
}

interface BillingSubscription {
  planId: string | null;
  status: string;
  paymentMethod: SubscriptionBillingPaymentMethod;
  renewalMode: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  gracePeriodEndsAt: Date | null;
  Plan: BillingPlan | null;
}

function user(overrides: Partial<BillingUser> = {}): BillingUser {
  return {
    id: "user-1",
    isEnabled: true,
    npub: "ab".repeat(32),
    nwcEnabled: false,
    encryptedNwc: null,
    ...overrides,
  };
}

function plan(overrides: Partial<BillingPlan> = {}): BillingPlan {
  return { name: "Pro", id: "pro", enableLifetimeAccess: false, ...overrides };
}

function subscription(
  overrides: Partial<BillingSubscription> = {}
): BillingSubscription {
  return {
    planId: "pro",
    status: "ACTIVE",
    paymentMethod: "lightning_one_time",
    renewalMode: "manual",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: PERIOD_END,
    gracePeriodEndsAt: null,
    Plan: plan(),
    ...overrides,
  };
}

function autoUser(): BillingUser {
  return user({ nwcEnabled: true, encryptedNwc: "nwc-secret" });
}

function autoSubscription(
  overrides: Partial<BillingSubscription> = {}
): BillingSubscription {
  return subscription({
    paymentMethod: "nwc_auto_renew",
    renewalMode: "auto_renew",
    ...overrides,
  });
}

function context(params: {
  billingUser?: BillingUser;
  billingSubscription?: BillingSubscription | null;
  now?: Date;
}): BillingContext {
  return deriveBillingContext({
    user: params.billingUser ?? user(),
    subscription:
      params.billingSubscription === undefined
        ? subscription()
        : params.billingSubscription,
    now: params.now,
  });
}

describe("deriveBillingCommMode", () => {
  it("stays manual for lifetime, missing plans, and scheduled cancellation", () => {
    const paid = subscription();
    expect(
      deriveBillingCommMode(autoUser(), {
        ...paid,
        Plan: plan({ enableLifetimeAccess: true }),
      })
    ).toBe("MANUAL_TOP_UP");
    expect(
      deriveBillingCommMode(autoUser(), { ...paid, planId: null, Plan: null })
    ).toBe("MANUAL_TOP_UP");
    expect(deriveBillingCommMode(autoUser(), { ...paid, Plan: null })).toBe(
      "MANUAL_TOP_UP"
    );
    expect(
      deriveBillingCommMode(autoUser(), {
        ...paid,
        Plan: plan({ enableLifetimeAccess: false }),
        cancelAtPeriodEnd: true,
      })
    ).toBe("MANUAL_TOP_UP");
  });

  it("selects auto-renew only when the wallet and renewal settings all agree", () => {
    const ready = autoSubscription();
    expect(deriveBillingCommMode(autoUser(), ready)).toBe("AUTO_RENEW_NWC");
    expect(
      deriveBillingCommMode(
        user({ nwcEnabled: true, encryptedNwc: " " }),
        ready
      )
    ).toBe("AUTO_RENEW_NWC");
    expect(
      deriveBillingCommMode(
        user({ nwcEnabled: false, encryptedNwc: "secret" }),
        ready
      )
    ).toBe("MANUAL_TOP_UP");
    expect(
      deriveBillingCommMode(user({ nwcEnabled: true, encryptedNwc: "" }), ready)
    ).toBe("MANUAL_TOP_UP");
    expect(
      deriveBillingCommMode(
        user({ nwcEnabled: true, encryptedNwc: null }),
        ready
      )
    ).toBe("MANUAL_TOP_UP");
    expect(
      deriveBillingCommMode(autoUser(), {
        ...ready,
        paymentMethod: "lightning_one_time",
      })
    ).toBe("MANUAL_TOP_UP");
    expect(
      deriveBillingCommMode(autoUser(), {
        ...ready,
        paymentMethod: "btc_btcpay_onchain",
      })
    ).toBe("MANUAL_TOP_UP");
    expect(
      deriveBillingCommMode(autoUser(), { ...ready, renewalMode: "manual" })
    ).toBe("MANUAL_TOP_UP");
  });
});

describe("needsNwcActionRequired", () => {
  const ready = autoSubscription();

  it("is false for lifetime access and for plans that are not set to auto-renew", () => {
    expect(
      needsNwcActionRequired({
        user: user(),
        subscription: {
          ...ready,
          Plan: plan({ enableLifetimeAccess: true }),
        },
      })
    ).toBe(false);
    expect(
      needsNwcActionRequired({
        user: user(),
        subscription: { ...ready, Plan: null },
      })
    ).toBe(true);
    expect(
      needsNwcActionRequired({
        user: user(),
        subscription: { ...ready, paymentMethod: "lightning_one_time" },
      })
    ).toBe(false);
    expect(
      needsNwcActionRequired({
        user: user(),
        subscription: { ...ready, renewalMode: "manual" },
      })
    ).toBe(false);
    expect(
      needsNwcActionRequired({
        user: autoUser(),
        subscription: ready,
      })
    ).toBe(false);
  });

  it("is true when auto-renew is configured without a usable wallet", () => {
    expect(
      needsNwcActionRequired({
        user: user({ nwcEnabled: false, encryptedNwc: "secret" }),
        subscription: ready,
      })
    ).toBe(true);
    expect(
      needsNwcActionRequired({
        user: user({ nwcEnabled: true, encryptedNwc: null }),
        subscription: ready,
      })
    ).toBe(true);
    expect(
      needsNwcActionRequired({
        user: user({ nwcEnabled: true, encryptedNwc: "" }),
        subscription: ready,
      })
    ).toBe(true);
  });
});

describe("deriveBillingContext", () => {
  it("downgrades a disabled account before reading the subscription", () => {
    expect(
      context({
        billingUser: user({ isEnabled: false }),
        billingSubscription: autoSubscription(),
        now: new Date(PERIOD_END.getTime() - 10 * DAY),
      })
    ).toEqual({
      commMode: "MANUAL_TOP_UP",
      uiStatus: "DOWNGRADED_FREE",
      isPaidLifecycle: false,
      paidUntil: null,
      graceEndsAt: null,
      bannerVariant: "manual_downgraded",
      primaryCta: "view_plans",
    });
  });

  it("returns the free screen when there is no purchasable plan", () => {
    const freeScreen: BillingContext = {
      commMode: "MANUAL_TOP_UP",
      uiStatus: "FREE",
      isPaidLifecycle: false,
      paidUntil: null,
      graceEndsAt: null,
      bannerVariant: "none",
      primaryCta: "view_plans",
    };
    expect(context({ billingSubscription: null })).toEqual(freeScreen);
    expect(
      context({ billingSubscription: subscription({ planId: null }) })
    ).toEqual(freeScreen);
    expect(
      context({ billingSubscription: subscription({ Plan: null }) })
    ).toEqual(freeScreen);
  });

  it("treats lifetime access as active manual even when the status is not active", () => {
    expect(
      context({
        billingUser: autoUser(),
        billingSubscription: subscription({
          status: "PAST_DUE",
          Plan: plan({ enableLifetimeAccess: true }),
        }),
      })
    ).toEqual({
      commMode: "MANUAL_TOP_UP",
      uiStatus: "ACTIVE_MANUAL",
      isPaidLifecycle: true,
      paidUntil: null,
      graceEndsAt: null,
      bannerVariant: "none",
      primaryCta: "view_plans",
    });
  });

  it("keeps stored dates when the plan type is free", () => {
    const graceEnd = new Date("2099-09-01T12:00:00.000Z");
    expect(
      context({
        billingUser: autoUser(),
        billingSubscription: autoSubscription({
          status: "PAST_DUE",
          gracePeriodEndsAt: graceEnd,
        }),
        now: new Date(PERIOD_END.getTime() - DAY),
      })
    ).toEqual({
      commMode: "AUTO_RENEW_NWC",
      uiStatus: "FREE",
      isPaidLifecycle: false,
      paidUntil: PERIOD_END,
      graceEndsAt: graceEnd,
      bannerVariant: "none",
      primaryCta: "view_plans",
    });
    expect(
      context({
        billingSubscription: subscription({
          planId: "custom",
          status: "UNPAID",
          Plan: plan({ id: "custom", name: "Custom" }),
        }),
      })
    ).toMatchObject({ uiStatus: "FREE", commMode: "MANUAL_TOP_UP" });
    expect(
      context({
        billingSubscription: subscription({ status: "CANCELED" }),
      }).uiStatus
    ).toBe("FREE");
  });

  it("shows grace banners from the caller clock while the real period is still open", () => {
    const periodEnd = new Date("2099-06-01T12:00:00.000Z");
    const now = new Date("2099-06-10T12:00:00.000Z");
    const ending = new Date(now.getTime() + 12 * HOUR);
    const ongoing = new Date(now.getTime() + 2 * DAY);
    expect(
      context({
        billingUser: autoUser(),
        billingSubscription: autoSubscription({
          currentPeriodEnd: periodEnd,
          gracePeriodEndsAt: ending,
        }),
        now,
      })
    ).toEqual({
      commMode: "AUTO_RENEW_NWC",
      uiStatus: "GRACE_PERIOD",
      isPaidLifecycle: true,
      paidUntil: periodEnd,
      graceEndsAt: ending,
      bannerVariant: "nwc_grace_ending",
      primaryCta: "manage_nwc",
    });
    expect(
      context({
        billingUser: autoUser(),
        billingSubscription: autoSubscription({
          currentPeriodEnd: periodEnd,
          gracePeriodEndsAt: ongoing,
        }),
        now,
      }).bannerVariant
    ).toBe("nwc_renewal_failed_grace");
    expect(
      context({
        billingSubscription: subscription({
          currentPeriodEnd: periodEnd,
          gracePeriodEndsAt: ending,
        }),
        now,
      })
    ).toEqual({
      commMode: "MANUAL_TOP_UP",
      uiStatus: "GRACE_PERIOD",
      isPaidLifecycle: true,
      paidUntil: periodEnd,
      graceEndsAt: ending,
      bannerVariant: "manual_period_ending",
      primaryCta: "top_up_subscription",
    });
  });

  it("expires an active paid period after the caller clock passes it", () => {
    const periodEnd = new Date("2099-06-01T12:00:00.000Z");
    const now = new Date("2099-06-20T12:00:00.000Z");
    const endedGrace = new Date("2099-06-05T12:00:00.000Z");
    expect(
      context({
        billingSubscription: subscription({
          currentPeriodEnd: periodEnd,
          gracePeriodEndsAt: endedGrace,
        }),
        now,
      })
    ).toEqual({
      commMode: "MANUAL_TOP_UP",
      uiStatus: "EXPIRED",
      isPaidLifecycle: false,
      paidUntil: periodEnd,
      graceEndsAt: null,
      bannerVariant: "manual_expired",
      primaryCta: "top_up_subscription",
    });
    expect(
      context({
        billingUser: autoUser(),
        billingSubscription: autoSubscription({
          currentPeriodEnd: periodEnd,
          gracePeriodEndsAt: null,
        }),
        now,
      })
    ).toMatchObject({
      uiStatus: "EXPIRED",
      bannerVariant: "nwc_downgraded",
      primaryCta: "manage_nwc",
    });
  });

  it("keeps an open-ended paid plan active and points the action at the wallet mode", () => {
    expect(
      context({
        billingSubscription: subscription({ currentPeriodEnd: null }),
      })
    ).toEqual({
      commMode: "MANUAL_TOP_UP",
      uiStatus: "ACTIVE_MANUAL",
      isPaidLifecycle: true,
      paidUntil: null,
      graceEndsAt: null,
      bannerVariant: "none",
      primaryCta: "top_up_subscription",
    });
    expect(
      context({
        billingUser: autoUser(),
        billingSubscription: autoSubscription({ currentPeriodEnd: null }),
      }).primaryCta
    ).toBe("manage_nwc");
  });

  it("switches auto-renew banners across the three-day and 24-hour windows", () => {
    const soon = new Date(PERIOD_END.getTime() - 2 * DAY);
    const day = new Date(PERIOD_END.getTime() - 24 * HOUR);
    const later = new Date(PERIOD_END.getTime() - 10 * DAY);
    expect(
      context({
        billingUser: autoUser(),
        billingSubscription: autoSubscription(),
        now: soon,
      })
    ).toMatchObject({
      uiStatus: "RENEWAL_UPCOMING",
      bannerVariant: "nwc_renewal_soon",
      primaryCta: "manage_nwc",
      paidUntil: PERIOD_END,
    });
    expect(
      context({
        billingUser: autoUser(),
        billingSubscription: autoSubscription(),
        now: day,
      })
    ).toMatchObject({
      uiStatus: "RENEWAL_UPCOMING",
      bannerVariant: "nwc_renewal_24h",
      primaryCta: "manage_nwc",
    });
    expect(
      context({
        billingUser: autoUser(),
        billingSubscription: autoSubscription(),
        now: later,
      })
    ).toMatchObject({
      uiStatus: "ACTIVE_AUTO_RENEW",
      bannerVariant: "none",
      primaryCta: "manage_nwc",
    });
    expect(
      context({
        billingUser: autoUser(),
        billingSubscription: autoSubscription(),
        now: PERIOD_END,
      })
    ).toMatchObject({ uiStatus: "ACTIVE_AUTO_RENEW", bannerVariant: "none" });
  });

  it("switches manual banners across the same windows", () => {
    expect(
      context({ now: new Date(PERIOD_END.getTime() - 2 * DAY) })
    ).toMatchObject({
      uiStatus: "TOPUP_REQUIRED_SOON",
      bannerVariant: "manual_period_ending",
      primaryCta: "top_up_subscription",
    });
    expect(
      context({ now: new Date(PERIOD_END.getTime() - 12 * HOUR) })
    ).toMatchObject({
      uiStatus: "TOPUP_REQUIRED_SOON",
      bannerVariant: "manual_ends_tomorrow",
    });
    expect(
      context({ now: new Date(PERIOD_END.getTime() - 24 * HOUR) })
    ).toMatchObject({ bannerVariant: "manual_ends_tomorrow" });
    expect(
      context({ now: new Date(PERIOD_END.getTime() - 10 * DAY) })
    ).toMatchObject({ uiStatus: "ACTIVE_MANUAL", bannerVariant: "none" });
    expect(context({ now: PERIOD_END })).toMatchObject({
      uiStatus: "ACTIVE_MANUAL",
      bannerVariant: "none",
    });
  });
});
