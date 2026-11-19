import { describe, expect, it } from "vitest";

import {
  computeDueNotificationIntents,
  singleEventIntent,
} from "~/features/payments/services/subscription-notification-policy.server";
import type { NotificationIntent } from "~/features/payments/services/subscription-notification-types";
import type { SubscriptionBillingPaymentMethod } from "~/features/payments/types/subscription-billing.types";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const PERIOD_END = new Date("2099-08-15T12:00:00.000Z");
const PERIOD_START = new Date("2099-07-15T12:00:00.000Z");

interface PolicyUser {
  nwcEnabled: boolean;
  encryptedNwc: string | null;
}

interface PolicyPlan {
  name: string;
  id: string;
  enableLifetimeAccess?: boolean;
}

interface PolicySubscription {
  id: string;
  planId: string | null;
  status: string;
  paymentMethod: SubscriptionBillingPaymentMethod;
  renewalMode: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  gracePeriodEndsAt: Date | null;
  Plan: PolicyPlan | null;
}

const manualUser: PolicyUser = { nwcEnabled: false, encryptedNwc: null };
const walletUser: PolicyUser = { nwcEnabled: true, encryptedNwc: "nwc-secret" };

function subscription(
  overrides: Partial<PolicySubscription> = {}
): PolicySubscription {
  return {
    id: "sub_1",
    planId: "pro",
    status: "ACTIVE",
    paymentMethod: "lightning_one_time",
    renewalMode: "manual",
    cancelAtPeriodEnd: false,
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    gracePeriodEndsAt: null,
    Plan: { name: "Pro", id: "pro", enableLifetimeAccess: false },
    ...overrides,
  };
}

function autoSubscription(
  overrides: Partial<PolicySubscription> = {}
): PolicySubscription {
  return subscription({
    paymentMethod: "nwc_auto_renew",
    renewalMode: "auto_renew",
    ...overrides,
  });
}

function due(
  now: Date,
  sub: PolicySubscription,
  billingUser: PolicyUser = manualUser
): NotificationIntent[] {
  return computeDueNotificationIntents({
    now,
    user: billingUser,
    subscription: sub,
  });
}

function periodKey(eventType: string, periodEnd: Date = PERIOD_END): string {
  return `${eventType}:sub_1:${periodEnd.toISOString()}`;
}

function graceKey(eventType: string, graceEnd: Date): string {
  return `${eventType}:sub_1:grace:${graceEnd.toISOString()}`;
}

describe("computeDueNotificationIntents", () => {
  it("returns nothing when the subscription is not a billable paid period", () => {
    const now = new Date(PERIOD_END.getTime() - DAY);
    expect(due(now, subscription({ planId: null })).length).toBe(0);
    expect(due(now, subscription({ Plan: null })).length).toBe(0);
    expect(
      due(
        now,
        subscription({
          Plan: { name: "Pro", id: "pro", enableLifetimeAccess: true },
        })
      ).length
    ).toBe(0);
    expect(due(now, subscription({ status: "CANCELED" })).length).toBe(0);
    expect(
      due(
        now,
        subscription({
          planId: "custom",
          Plan: { name: "Custom", id: "custom" },
        })
      ).length
    ).toBe(0);
    expect(due(now, subscription({ currentPeriodEnd: null })).length).toBe(0);
    expect(
      due(
        new Date("2020-02-01T00:00:00.000Z"),
        subscription({
          currentPeriodEnd: new Date("2020-01-01T00:00:00.000Z"),
          currentPeriodStart: new Date("2019-12-01T00:00:00.000Z"),
        })
      ).length
    ).toBe(0);
  });

  it("emits manual top-up reminders on the seven-day, three-day, and 24-hour boundaries", () => {
    expect(
      due(new Date(PERIOD_END.getTime() - 7 * DAY), subscription())
    ).toEqual([
      {
        eventType: "topup_reminder_7d",
        dedupeKey: periodKey("topup_reminder_7d"),
        commMode: "MANUAL_TOP_UP",
      },
    ]);
    expect(
      due(new Date(PERIOD_END.getTime() - 7 * DAY - 1000), subscription())
    ).toEqual([]);
    expect(
      due(new Date(PERIOD_END.getTime() - 3 * DAY), subscription())
    ).toEqual([
      {
        eventType: "topup_reminder_3d",
        dedupeKey: periodKey("topup_reminder_3d"),
        commMode: "MANUAL_TOP_UP",
      },
    ]);
    expect(
      due(new Date(PERIOD_END.getTime() - 24 * HOUR), subscription())
    ).toEqual([
      {
        eventType: "topup_reminder_24h",
        dedupeKey: periodKey("topup_reminder_24h"),
        commMode: "MANUAL_TOP_UP",
      },
    ]);
    expect(due(new Date(PERIOD_END.getTime() - 1), subscription())).toEqual([
      {
        eventType: "topup_reminder_24h",
        dedupeKey: periodKey("topup_reminder_24h"),
        commMode: "MANUAL_TOP_UP",
      },
    ]);
  });

  it("allows the seven-day reminder when the period start is missing and skips it for a short period", () => {
    const fiveDaysOut = new Date(PERIOD_END.getTime() - 5 * DAY);
    expect(
      due(fiveDaysOut, subscription({ currentPeriodStart: null }))
    ).toEqual([
      {
        eventType: "topup_reminder_7d",
        dedupeKey: periodKey("topup_reminder_7d"),
        commMode: "MANUAL_TOP_UP",
      },
    ]);
    const shortStart = new Date(PERIOD_END.getTime() - 3 * DAY);
    expect(
      due(fiveDaysOut, subscription({ currentPeriodStart: shortStart }))
    ).toEqual([]);
    expect(
      due(
        new Date(PERIOD_END.getTime() - 2 * DAY),
        subscription({ currentPeriodStart: shortStart })
      )
    ).toEqual([
      {
        eventType: "topup_reminder_3d",
        dedupeKey: periodKey("topup_reminder_3d"),
        commMode: "MANUAL_TOP_UP",
      },
    ]);
  });

  it("emits NWC renewal reminders only inside the auto-renew windows", () => {
    const sub = autoSubscription();
    expect(
      due(new Date(PERIOD_END.getTime() - 2 * DAY), sub, walletUser)
    ).toEqual([
      {
        eventType: "renewal_upcoming_3d",
        dedupeKey: periodKey("renewal_upcoming_3d"),
        commMode: "AUTO_RENEW_NWC",
      },
    ]);
    expect(
      due(new Date(PERIOD_END.getTime() - 3 * DAY), sub, walletUser)
    ).toEqual([
      {
        eventType: "renewal_upcoming_3d",
        dedupeKey: periodKey("renewal_upcoming_3d"),
        commMode: "AUTO_RENEW_NWC",
      },
    ]);
    expect(
      due(new Date(PERIOD_END.getTime() - 12 * HOUR), sub, walletUser)
    ).toEqual([
      {
        eventType: "renewal_upcoming_24h",
        dedupeKey: periodKey("renewal_upcoming_24h"),
        commMode: "AUTO_RENEW_NWC",
      },
    ]);
    expect(
      due(new Date(PERIOD_END.getTime() - 4 * DAY), sub, walletUser)
    ).toEqual([]);
  });

  it("asks for a wallet and a manual top-up when auto-renew has no connection", () => {
    expect(
      due(
        new Date(PERIOD_END.getTime() - 12 * HOUR),
        autoSubscription(),
        manualUser
      )
    ).toEqual([
      {
        eventType: "nwc_action_required",
        dedupeKey: periodKey("nwc_action_required"),
        commMode: "AUTO_RENEW_NWC",
      },
      {
        eventType: "topup_reminder_24h",
        dedupeKey: periodKey("topup_reminder_24h"),
        commMode: "MANUAL_TOP_UP",
      },
    ]);
    expect(
      due(
        new Date(PERIOD_END.getTime() - 2 * DAY),
        autoSubscription({ cancelAtPeriodEnd: true }),
        walletUser
      )
    ).toEqual([
      {
        eventType: "topup_reminder_3d",
        dedupeKey: periodKey("topup_reminder_3d"),
        commMode: "MANUAL_TOP_UP",
      },
    ]);
    expect(
      due(
        new Date(PERIOD_END.getTime() - 2 * DAY),
        autoSubscription({ cancelAtPeriodEnd: true }),
        manualUser
      ).map((item) => item.eventType)
    ).toEqual(["nwc_action_required", "topup_reminder_3d"]);
  });

  it("emits grace events for auto-renew and the expiry notice for manual top-up", () => {
    const periodEnd = new Date("2099-06-01T12:00:00.000Z");
    const started = new Date("2099-06-03T12:00:00.000Z");
    const longGrace = new Date("2099-06-10T12:00:00.000Z");
    const shortGrace = new Date(started.getTime() + 12 * HOUR);
    const sub = autoSubscription({
      currentPeriodStart: new Date("2099-05-01T12:00:00.000Z"),
      currentPeriodEnd: periodEnd,
      gracePeriodEndsAt: longGrace,
    });
    expect(due(started, sub, walletUser)).toEqual([
      {
        eventType: "grace_period_started",
        dedupeKey: graceKey("grace_period_started", longGrace),
        commMode: "AUTO_RENEW_NWC",
      },
    ]);
    expect(
      due(
        started,
        autoSubscription({
          currentPeriodStart: sub.currentPeriodStart,
          currentPeriodEnd: periodEnd,
          gracePeriodEndsAt: shortGrace,
        }),
        walletUser
      ).map((item) => item.eventType)
    ).toEqual(["grace_period_started", "grace_period_ending_24h"]);
    expect(
      due(
        started,
        subscription({
          currentPeriodEnd: periodEnd,
          gracePeriodEndsAt: shortGrace,
        })
      )
    ).toEqual([
      {
        eventType: "subscription_expired",
        dedupeKey: periodKey("subscription_expired", periodEnd),
        commMode: "MANUAL_TOP_UP",
      },
    ]);
  });

  it("keeps the expiry notice inside the three days after the period ends", () => {
    const periodEnd = new Date("2099-06-01T12:00:00.000Z");
    const sub = subscription({
      currentPeriodStart: new Date("2099-05-01T12:00:00.000Z"),
      currentPeriodEnd: periodEnd,
    });
    expect(due(periodEnd, sub)).toEqual([
      {
        eventType: "subscription_expired",
        dedupeKey: periodKey("subscription_expired", periodEnd),
        commMode: "MANUAL_TOP_UP",
      },
    ]);
    expect(due(new Date(periodEnd.getTime() + 3 * DAY - 1), sub).length).toBe(
      1
    );
    expect(due(new Date(periodEnd.getTime() + 3 * DAY), sub)).toEqual([]);
    expect(
      due(
        new Date(periodEnd.getTime() + DAY),
        autoSubscription({
          currentPeriodEnd: periodEnd,
          gracePeriodEndsAt: null,
        }),
        walletUser
      )
    ).toEqual([]);
    expect(
      due(
        new Date(periodEnd.getTime() + 4 * DAY),
        subscription({
          currentPeriodEnd: periodEnd,
          gracePeriodEndsAt: new Date(periodEnd.getTime() + 10 * DAY),
        })
      )
    ).toEqual([]);
  });
});

describe("singleEventIntent", () => {
  it("builds a dedupe key from the event, subscription, and period anchor", () => {
    const anchor = new Date("2099-09-01T00:00:00.000Z");
    expect(
      singleEventIntent("renewal_success", {
        subscriptionId: "sub_9",
        periodAnchor: anchor,
        commMode: "AUTO_RENEW_NWC",
      })
    ).toEqual({
      eventType: "renewal_success",
      dedupeKey: `renewal_success:sub_9:${anchor.toISOString()}`,
      commMode: "AUTO_RENEW_NWC",
    });
    expect(
      singleEventIntent("subscription_downgraded_to_free", {
        subscriptionId: "sub_2",
        periodAnchor: anchor,
        commMode: "MANUAL_TOP_UP",
      }).commMode
    ).toBe("MANUAL_TOP_UP");
  });
});
