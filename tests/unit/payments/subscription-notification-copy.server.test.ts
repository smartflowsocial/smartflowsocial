import { format } from "date-fns";
import { describe, expect, it } from "vitest";

import { buildSubscriptionNotificationMessage } from "~/features/payments/services/subscription-notification-copy.server";
import type { SubscriptionNotificationEventType } from "~/features/payments/services/subscription-notification-types";
import type { BillingNotificationCommMode } from "~/features/payments/types/subscription-billing.types";
import { BRAND_NAME } from "~/lib/brand";

const PERIOD_END = new Date("2099-06-15T12:00:00.000Z");
const GRACE_END = new Date("2099-06-20T12:00:00.000Z");
const END_LABEL = format(PERIOD_END, "dd MMM yyyy");
const GRACE_LABEL = format(GRACE_END, "dd MMM yyyy");

function message(params: {
  eventType: SubscriptionNotificationEventType;
  commMode: BillingNotificationCommMode;
  currentPeriodEnd: Date | null;
  gracePeriodEndsAt: Date | null;
  failureDetail?: string;
}): string {
  return buildSubscriptionNotificationMessage(params);
}

describe("manual subscription notification copy", () => {
  it("writes the seven-day top-up reminder without the period date", () => {
    expect(
      message({
        eventType: "topup_reminder_7d",
        commMode: "MANUAL_TOP_UP",
        currentPeriodEnd: PERIOD_END,
        gracePeriodEndsAt: GRACE_END,
      })
    ).toBe(
      [
        `Your ${BRAND_NAME} paid period ends in 7 days.`,
        "Auto-renew is not enabled on this account. Top up your subscription now if you want uninterrupted access.",
        "",
        "This account uses manual top-ups, not auto-renew. If you want uninterrupted access, extend your subscription before it ends.",
      ].join("\n")
    );
  });

  it("uses the formatted period end for the three-day reminder and soon when it is missing", () => {
    expect(
      message({
        eventType: "topup_reminder_3d",
        commMode: "MANUAL_TOP_UP",
        currentPeriodEnd: PERIOD_END,
        gracePeriodEndsAt: null,
      })
    ).toBe(
      `Your ${BRAND_NAME} paid period ends in 3 days.\nTo keep your plan active without interruption, top up before ${END_LABEL}.`
    );
    expect(
      message({
        eventType: "topup_reminder_3d",
        commMode: "MANUAL_TOP_UP",
        currentPeriodEnd: null,
        gracePeriodEndsAt: null,
      })
    ).toBe(
      `Your ${BRAND_NAME} paid period ends in 3 days.\nTo keep your plan active without interruption, top up before soon.`
    );
  });

  it("writes the one-day, expired, downgraded, and renewal messages", () => {
    expect(
      message({
        eventType: "topup_reminder_24h",
        commMode: "MANUAL_TOP_UP",
        currentPeriodEnd: null,
        gracePeriodEndsAt: GRACE_END,
      })
    ).toBe(
      `Your ${BRAND_NAME} paid period ends in about 24 hours.\nTop up now to avoid downgrade to Free.`
    );
    expect(
      message({
        eventType: "subscription_expired",
        commMode: "MANUAL_TOP_UP",
        currentPeriodEnd: PERIOD_END,
        gracePeriodEndsAt: null,
      })
    ).toBe(
      `Your ${BRAND_NAME} paid period has ended.\nYour account will remain on Free unless you top up your subscription.`
    );
    expect(
      message({
        eventType: "subscription_downgraded_to_free",
        commMode: "MANUAL_TOP_UP",
        currentPeriodEnd: null,
        gracePeriodEndsAt: null,
      })
    ).toBe(
      `Your ${BRAND_NAME} account is now on the Free plan.\nTop up any time to restore paid features.`
    );
    expect(
      message({
        eventType: "renewal_success",
        commMode: "MANUAL_TOP_UP",
        currentPeriodEnd: PERIOD_END,
        gracePeriodEndsAt: GRACE_END,
      })
    ).toBe(`Your ${BRAND_NAME} plan is active until ${END_LABEL}.`);
  });

  it("falls back for auto-renew events that manual mode does not send", () => {
    const events: SubscriptionNotificationEventType[] = [
      "grace_period_started",
      "grace_period_ending_24h",
      "renewal_failed",
      "renewal_upcoming_3d",
      "renewal_upcoming_24h",
      "nwc_action_required",
    ];
    for (const eventType of events) {
      expect(
        message({
          eventType,
          commMode: "MANUAL_TOP_UP",
          currentPeriodEnd: PERIOD_END,
          gracePeriodEndsAt: GRACE_END,
          failureDetail: "ignored for manual copy",
        })
      ).toBe(
        `${BRAND_NAME} billing update (${eventType}). Paid period context: ${END_LABEL}. Grace: ${GRACE_LABEL}.`
      );
    }
    expect(
      message({
        eventType: "renewal_failed",
        commMode: "MANUAL_TOP_UP",
        currentPeriodEnd: null,
        gracePeriodEndsAt: null,
      })
    ).toBe(
      `${BRAND_NAME} billing update (renewal_failed). Paid period context: soon. Grace: soon.`
    );
  });
});

describe("NWC subscription notification copy", () => {
  it("writes the upcoming renewal reminders", () => {
    expect(
      message({
        eventType: "renewal_upcoming_3d",
        commMode: "AUTO_RENEW_NWC",
        currentPeriodEnd: null,
        gracePeriodEndsAt: null,
      })
    ).toBe(
      [
        `Your ${BRAND_NAME} subscription renews in 3 days.`,
        "Auto-renew is enabled via NWC. Make sure your wallet connection and balance are ready so your plan continues without interruption.",
      ].join("\n")
    );
    expect(
      message({
        eventType: "renewal_upcoming_24h",
        commMode: "AUTO_RENEW_NWC",
        currentPeriodEnd: PERIOD_END,
        gracePeriodEndsAt: GRACE_END,
      })
    ).toBe(
      [
        `Your ${BRAND_NAME} subscription renews in about 24 hours.`,
        "Auto-renew will be attempted via NWC. Check that your wallet is connected and has enough balance.",
      ].join("\n")
    );
  });

  it("includes a failure detail when a renewal charge failed and omits a blank detail", () => {
    expect(
      message({
        eventType: "renewal_failed",
        commMode: "AUTO_RENEW_NWC",
        currentPeriodEnd: PERIOD_END,
        gracePeriodEndsAt: GRACE_END,
        failureDetail: "Wallet said no.",
      })
    ).toBe(
      [
        `We could not renew your ${BRAND_NAME} subscription via NWC.`,
        "Wallet said no. Your plan has entered a grace period. Top up manually if you want to keep paid features.",
      ].join("\n")
    );
    expect(
      message({
        eventType: "renewal_failed",
        commMode: "AUTO_RENEW_NWC",
        currentPeriodEnd: null,
        gracePeriodEndsAt: null,
        failureDetail: "",
      })
    ).toBe(
      [
        `We could not renew your ${BRAND_NAME} subscription via NWC.`,
        "Your plan has entered grace period. Reconnect your wallet or top up manually to avoid downgrade.",
      ].join("\n")
    );
  });

  it("writes grace, downgrade, wallet, expiry, and success copy", () => {
    expect(
      message({
        eventType: "renewal_success",
        commMode: "AUTO_RENEW_NWC",
        currentPeriodEnd: PERIOD_END,
        gracePeriodEndsAt: null,
      })
    ).toBe(
      `Subscription renewed successfully.\nYour ${BRAND_NAME} plan is active until ${END_LABEL}.`
    );
    expect(
      message({
        eventType: "grace_period_started",
        commMode: "AUTO_RENEW_NWC",
        currentPeriodEnd: PERIOD_END,
        gracePeriodEndsAt: GRACE_END,
      })
    ).toBe(
      `Your subscription is now in grace period.\nFix NWC or top up manually before ${GRACE_LABEL} to keep paid features active.`
    );
    expect(
      message({
        eventType: "grace_period_started",
        commMode: "AUTO_RENEW_NWC",
        currentPeriodEnd: null,
        gracePeriodEndsAt: null,
      })
    ).toBe(
      "Your subscription is now in grace period.\nFix NWC or top up manually before soon to keep paid features active."
    );
    expect(
      message({
        eventType: "grace_period_ending_24h",
        commMode: "AUTO_RENEW_NWC",
        currentPeriodEnd: PERIOD_END,
        gracePeriodEndsAt: GRACE_END,
      })
    ).toBe(
      "Your grace period ends in about 24 hours.\nReconnect NWC or top up now to avoid downgrade to Free."
    );
    expect(
      message({
        eventType: "subscription_downgraded_to_free",
        commMode: "AUTO_RENEW_NWC",
        currentPeriodEnd: null,
        gracePeriodEndsAt: null,
      })
    ).toBe(
      `Your ${BRAND_NAME} subscription has been downgraded to Free.\nTop up any time to restore paid features.`
    );
    expect(
      message({
        eventType: "nwc_action_required",
        commMode: "AUTO_RENEW_NWC",
        currentPeriodEnd: PERIOD_END,
        gracePeriodEndsAt: null,
      })
    ).toBe(
      [
        `Action needed: your ${BRAND_NAME} subscription is set to auto-renew via NWC, but your wallet connection is missing or invalid.`,
        "Reconnect NWC under Billing settings so renewal can run.",
      ].join("\n")
    );
    expect(
      message({
        eventType: "subscription_expired",
        commMode: "AUTO_RENEW_NWC",
        currentPeriodEnd: PERIOD_END,
        gracePeriodEndsAt: GRACE_END,
      })
    ).toBe(
      `Your ${BRAND_NAME} subscription period has ended.\nReconnect NWC or top up to restore paid access.`
    );
  });

  it("uses the renewal fallback for manual top-up event types", () => {
    const events: SubscriptionNotificationEventType[] = [
      "topup_reminder_7d",
      "topup_reminder_3d",
      "topup_reminder_24h",
    ];
    for (const eventType of events) {
      expect(
        message({
          eventType,
          commMode: "AUTO_RENEW_NWC",
          currentPeriodEnd: PERIOD_END,
          gracePeriodEndsAt: GRACE_END,
        })
      ).toBe(
        `${BRAND_NAME} billing update (${eventType}). Renewal context: ${END_LABEL}.`
      );
    }
    expect(
      message({
        eventType: "topup_reminder_7d",
        commMode: "AUTO_RENEW_NWC",
        currentPeriodEnd: null,
        gracePeriodEndsAt: null,
      })
    ).toBe(
      `${BRAND_NAME} billing update (topup_reminder_7d). Renewal context: soon.`
    );
  });
});
