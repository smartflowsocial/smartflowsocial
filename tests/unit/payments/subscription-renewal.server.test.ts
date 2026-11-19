import { beforeEach, describe, expect, it, vi } from "vitest";

const payments = vi.hoisted(() => ({
  createRenewalPayment: vi.fn(),
  updateUserSubscription: vi.fn(),
  getUserSubscription: vi.fn(),
}));
const renewalData = vi.hoisted(() => ({
  claimSubscriptionRenewalAttempt: vi.fn(),
  findPlanById: vi.fn(),
  updateSubscriptionCancelAtPeriodEndAndMetadata: vi.fn(),
  updateSubscriptionDunningState: vi.fn(),
  updateSubscriptionToCanceled: vi.fn(),
}));
const notify = vi.hoisted(() => ({
  buildSubscriptionDedupeKey: vi.fn(() => "dedupe"),
  deliverSubscriptionNotificationDm: vi.fn(
    async (_args: { eventType?: string; failureDetail?: string }) => undefined
  ),
  runSubscriptionNotifications: vi.fn(),
  deriveBillingCommMode: vi.fn(() => "MANUAL_TOP_UP"),
}));
const users = vi.hoisted(() => ({
  disableUserAccount: vi.fn(),
  getEnabledUsersWithSubscriptions: vi.fn(),
}));
const infra = vi.hoisted(() => ({
  afterSubscriptionUpdated: vi.fn(),
  decrypt: vi.fn(() => "nostr+walletconnect://secret"),
  logError: vi.fn(),
  normalizeError: vi.fn((error: unknown) => error),
  createErrorResponse: vi.fn(() => [{ error: "renewal crashed" }, 500]),
  trackProductEvent: vi.fn(),
  ensureServerWebSocket: vi.fn(),
  chargeAutoRenewSubscription: vi.fn(),
}));

vi.mock("~/features/payments/data", () => ({
  createRenewalPayment: payments.createRenewalPayment,
  updateUserSubscription: payments.updateUserSubscription,
}));
vi.mock("~/features/payments/data/payment.queries.server", () => ({
  getUserSubscription: payments.getUserSubscription,
}));
vi.mock(
  "~/features/payments/repositories/subscription-notification.repository.server",
  () => ({ buildSubscriptionDedupeKey: notify.buildSubscriptionDedupeKey })
);
vi.mock(
  "~/features/payments/services/subscription-notification-delivery.server",
  () => ({
    deliverSubscriptionNotificationDm: notify.deliverSubscriptionNotificationDm,
  })
);
vi.mock(
  "~/features/payments/services/subscription-notification-runner.server",
  () => ({ runSubscriptionNotifications: notify.runSubscriptionNotifications })
);
vi.mock("~/features/payments/services/subscription-status.server", () => ({
  deriveBillingCommMode: notify.deriveBillingCommMode,
}));
vi.mock(
  "~/features/payments/repositories/subscription-renewal-data.server",
  () => renewalData
);
vi.mock(
  "~/features/payments/services/subscription-renewal-charge.server",
  () => ({ chargeAutoRenewSubscription: infra.chargeAutoRenewSubscription })
);
vi.mock("~/features/user", () => users);
vi.mock("~/infra/blastr/entitlement-sync.server", () => ({
  afterSubscriptionUpdated: infra.afterSubscriptionUpdated,
}));
vi.mock("~/lib/encryption.server", () => ({ decrypt: infra.decrypt }));
vi.mock("~/lib/error-handler.server", () => ({
  createErrorResponse: infra.createErrorResponse,
}));
vi.mock("~/lib/error-logger.server", () => ({ logError: infra.logError }));
vi.mock("~/lib/errors", () => ({ normalizeError: infra.normalizeError }));
vi.mock("~/lib/product-events.server", () => ({
  trackProductEvent: infra.trackProductEvent,
}));
vi.mock("~/lib/websocket-polyfill.server", () => ({
  ensureServerWebSocket: infra.ensureServerWebSocket,
}));

import { NwcChargeError } from "~/features/payments/services/nwc-user-pay.server";
import { checkAndRenewSubscriptions } from "~/features/payments/services/subscription-renewal.server";

const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

function subscription(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "sub-1",
    planId: "creator",
    plan: "creator",
    currentPeriodEnd: past,
    cancelAtPeriodEnd: false,
    paymentMethod: "manual",
    renewalMode: "manual",
    renewalFailureCount: 0,
    gracePeriodEndsAt: future,
    Plan: { name: "Creator", price: "5", enableLifetimeAccess: false },
    ...overrides,
  };
}

function account(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    npub: `npub-${id}`,
    isChild: false,
    nwcEnabled: false,
    encryptedNwc: null,
    Subscription: subscription(),
    ...overrides,
  };
}

describe("checkAndRenewSubscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notify.runSubscriptionNotifications.mockResolvedValue({
      sent: 1,
      failed: 0,
      skipped: 2,
      intentsProcessed: 3,
      errors: ["notice"],
    });
    renewalData.claimSubscriptionRenewalAttempt.mockResolvedValue(true);
    payments.getUserSubscription.mockResolvedValue(null);
  });

  it("skips rows that are not ready to renew and applies a scheduled downgrade", async () => {
    users.getEnabledUsersWithSubscriptions.mockResolvedValue([
      account("none", { Subscription: null }),
      account("child", { isChild: true }),
      account("life", {
        Subscription: subscription({
          Plan: { name: "Founder", price: "0", enableLifetimeAccess: true },
        }),
      }),
      account("current", {
        Subscription: subscription({ currentPeriodEnd: future }),
      }),
      account("open", {
        Subscription: subscription({ currentPeriodEnd: null }),
      }),
      account("downgrade", {
        Subscription: subscription({
          cancelAtPeriodEnd: true,
          metadata: { scheduledPlanId: "starter" },
        }),
      }),
      account("bad-meta", {
        Subscription: subscription({
          cancelAtPeriodEnd: true,
          metadata: ["starter"],
        }),
      }),
    ]);
    renewalData.findPlanById.mockResolvedValueOnce({ isActive: true });

    const result = await checkAndRenewSubscriptions();

    expect(result.success).toBe(true);
    expect(result.checked).toBe(7);
    expect(result.expired).toBe(2);
    expect(result.notificationSent).toBe(1);
    expect(result.errors).toContain("notice");
    expect(payments.updateUserSubscription).toHaveBeenCalledWith(
      "downgrade",
      "starter",
      expect.stringContaining("downgrade_")
    );
    expect(renewalData.updateSubscriptionToCanceled).toHaveBeenCalledWith(
      "bad-meta",
      expect.objectContaining({ status: "CANCELED" })
    );
    expect(users.disableUserAccount).toHaveBeenCalledWith("bad-meta");
    expect(infra.ensureServerWebSocket).toHaveBeenCalled();
  });

  it("cancels when the scheduled plan is missing or inactive", async () => {
    users.getEnabledUsersWithSubscriptions.mockResolvedValue([
      account("inactive", {
        Subscription: subscription({
          cancelAtPeriodEnd: true,
          metadata: { scheduledPlanId: "starter" },
        }),
      }),
      account("blank", {
        Subscription: subscription({
          cancelAtPeriodEnd: true,
          metadata: { scheduledPlanId: "" },
        }),
      }),
    ]);
    renewalData.findPlanById.mockResolvedValueOnce({ isActive: false });

    const result = await checkAndRenewSubscriptions();

    expect(result.disabled).toBe(2);
    expect(renewalData.updateSubscriptionToCanceled).toHaveBeenCalledTimes(2);
    expect(renewalData.findPlanById).toHaveBeenCalledTimes(1);
  });

  it("renews a free plan and a paid wallet plan", async () => {
    users.getEnabledUsersWithSubscriptions.mockResolvedValue([
      account("free", {
        nwcEnabled: true,
        encryptedNwc: "enc-free",
        Subscription: subscription({
          planId: "free",
          Plan: { name: "Free", price: "0", enableLifetimeAccess: false },
        }),
      }),
      account("paid", {
        nwcEnabled: true,
        encryptedNwc: "enc-paid",
        Subscription: subscription({
          paymentMethod: "nwc_auto_renew",
          renewalMode: "auto_renew",
          billingCadence: "yearly",
        }),
      }),
      account("paid-gone", {
        nwcEnabled: true,
        encryptedNwc: "enc-paid",
        Subscription: subscription({
          id: "sub-gone",
          paymentMethod: "nwc_auto_renew",
          renewalMode: "auto_renew",
          Plan: { enableLifetimeAccess: false },
        }),
      }),
    ]);
    payments.getUserSubscription
      .mockResolvedValueOnce({
        id: "sub-free",
        planId: "free",
        currentPeriodEnd: future,
        gracePeriodEndsAt: null,
      })
      .mockResolvedValueOnce({
        id: "sub-1",
        planId: "creator",
        currentPeriodEnd: future,
        gracePeriodEndsAt: null,
        paymentMethod: "nwc_auto_renew",
        renewalMode: "auto_renew",
        cancelAtPeriodEnd: false,
        Plan: { enableLifetimeAccess: false },
      })
      .mockResolvedValueOnce(null);

    const result = await checkAndRenewSubscriptions();

    expect(result.renewalSuccess).toBe(2);
    expect(payments.createRenewalPayment).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "free", amount: 0 })
    );
    expect(infra.chargeAutoRenewSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "paid",
        billingCadence: "yearly",
        planPriceUsd: 5,
      })
    );
    expect(renewalData.claimSubscriptionRenewalAttempt).toHaveBeenCalledTimes(
      2
    );
  });

  it("records dunning, skips a future retry, and disables after grace", async () => {
    users.getEnabledUsersWithSubscriptions.mockResolvedValue([
      account("later", {
        nwcEnabled: true,
        encryptedNwc: "enc",
        Subscription: subscription({
          paymentMethod: "nwc_auto_renew",
          renewalMode: "auto_renew",
          nextRenewalAttemptAt: future,
        }),
      }),
      account("unclaimed", {
        nwcEnabled: true,
        encryptedNwc: "enc",
        Subscription: subscription({
          paymentMethod: "nwc_auto_renew",
          renewalMode: "auto_renew",
        }),
      }),
      account("recovered", {
        nwcEnabled: true,
        encryptedNwc: "enc",
        Subscription: subscription({
          paymentMethod: "nwc_auto_renew",
          renewalMode: "auto_renew",
        }),
      }),
      account("dunning", {
        nwcEnabled: true,
        encryptedNwc: "enc",
        Subscription: subscription({
          paymentMethod: "nwc_auto_renew",
          renewalMode: "auto_renew",
          renewalFailureCount: 9,
          gracePeriodEndsAt: future,
        }),
      }),
      account("lapsed", {
        nwcEnabled: true,
        encryptedNwc: "enc",
        Subscription: subscription({
          paymentMethod: "nwc_auto_renew",
          renewalMode: "auto_renew",
          gracePeriodEndsAt: past,
        }),
      }),
      account("manual", {
        Subscription: subscription({ gracePeriodEndsAt: future }),
      }),
      account("manual-lapsed", {
        Subscription: subscription({ gracePeriodEndsAt: past }),
      }),
    ]);
    renewalData.claimSubscriptionRenewalAttempt
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    infra.chargeAutoRenewSubscription
      .mockRejectedValueOnce(new Error("invoice failed"))
      .mockRejectedValueOnce(new NwcChargeError("wallet_rejected", "no funds"))
      .mockRejectedValueOnce("wallet down");
    payments.getUserSubscription.mockResolvedValue({
      id: "sub-1",
      planId: "creator",
      currentPeriodEnd: past,
      gracePeriodEndsAt: past,
    });

    const result = await checkAndRenewSubscriptions();

    expect(result.renewalFailed).toBe(3);
    expect(result.disabled).toBe(2);
    expect(result.errors.some((error) => error.includes("dunning"))).toBe(true);
    expect(renewalData.updateSubscriptionDunningState).toHaveBeenCalled();
    const failureDetails =
      notify.deliverSubscriptionNotificationDm.mock.calls.map(
        (call) => call[0].failureDetail
      );
    expect(failureDetails.some((detail) => detail?.includes("wallet"))).toBe(
      true
    );
  });

  it("keeps a failure as success when the period was extended", async () => {
    users.getEnabledUsersWithSubscriptions.mockResolvedValue([
      account("extended", {
        nwcEnabled: true,
        encryptedNwc: "enc",
        Subscription: subscription({
          paymentMethod: "nwc_auto_renew",
          renewalMode: "auto_renew",
        }),
      }),
    ]);
    infra.chargeAutoRenewSubscription.mockRejectedValueOnce(
      new Error("late webhook")
    );
    payments.getUserSubscription.mockResolvedValue({
      currentPeriodEnd: future,
    });

    const result = await checkAndRenewSubscriptions();

    expect(result.renewalSuccess).toBe(1);
    expect(result.renewalFailed).toBe(0);
    expect(renewalData.updateSubscriptionDunningState).not.toHaveBeenCalled();
  });

  it("records per-user failures and a top-level crash", async () => {
    users.getEnabledUsersWithSubscriptions.mockResolvedValueOnce([
      account("boom", {
        Subscription: subscription({
          cancelAtPeriodEnd: true,
          metadata: null,
        }),
      }),
    ]);
    users.disableUserAccount.mockRejectedValueOnce("db down");

    const failedUser = await checkAndRenewSubscriptions();
    expect(failedUser.success).toBe(true);
    expect(failedUser.errors.some((error) => error.includes("db down"))).toBe(
      true
    );

    notify.runSubscriptionNotifications.mockRejectedValueOnce({
      message: "runner down",
    });
    infra.createErrorResponse.mockReturnValueOnce([
      { error: { message: "runner down" } },
      500,
    ]);
    const crashed = await checkAndRenewSubscriptions();
    expect(crashed.success).toBe(false);
    expect(crashed.errors).toContain("runner down");
  });

  it("rejects a paid renewal that has no plan id or plan row", async () => {
    users.getEnabledUsersWithSubscriptions.mockResolvedValue([
      account("no-plan-id", {
        nwcEnabled: true,
        encryptedNwc: "enc",
        Subscription: subscription({
          planId: null,
          plan: null,
          paymentMethod: "nwc_auto_renew",
          renewalMode: "auto_renew",
        }),
      }),
      account("no-plan", {
        nwcEnabled: true,
        encryptedNwc: "enc",
        Subscription: subscription({
          Plan: null,
          paymentMethod: "nwc_auto_renew",
          renewalMode: "auto_renew",
        }),
      }),
    ]);

    const result = await checkAndRenewSubscriptions();

    expect(result.expired).toBe(2);
    expect(result.renewalFailed).toBe(2);
    expect(result.errors.some((error) => error.includes("No plan ID"))).toBe(
      true
    );
    expect(result.errors.some((error) => error.includes("not found"))).toBe(
      true
    );
  });
});
