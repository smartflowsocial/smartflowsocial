import { beforeEach, describe, expect, it, vi } from "vitest";

const nwc = vi.hoisted(() => ({
  payInvoice: vi.fn(async () => undefined),
  close: vi.fn(() => undefined),
}));
const payments = vi.hoisted(() => ({
  createPlanInvoice: vi.fn(),
  getPlanById: vi.fn(),
  getPlanPriceUsd: vi.fn(),
  getUserSubscription: vi.fn(),
  manuallyVerifyPayment: vi.fn(),
  updateUserSubscription: vi.fn(
    async (userId: string, planId: string, paymentKey: string) => ({
      userId,
      planId,
      paymentKey,
    })
  ),
}));
const rows = vi.hoisted(() => ({
  updateSubscriptionCancelAtPeriodEnd: vi.fn(async () => undefined),
  updateSubscriptionCancelAtPeriodEndAndMetadata: vi.fn(
    async (
      _userId: string,
      _input: { cancelAtPeriodEnd: boolean; metadata: Record<string, unknown> }
    ) => undefined
  ),
}));
const users = vi.hoisted(() => ({
  getDecryptedUserNWC: vi.fn(async () => "nostr+walletconnect://wallet"),
  getUserBasicInfo: vi.fn(async () => ({ isChild: false })),
}));
const logs = vi.hoisted(() => ({
  logError: vi.fn(),
}));

vi.mock("@getalby/sdk", () => ({
  NWCClient: class {
    payInvoice = nwc.payInvoice;
    close = nwc.close;
  },
}));
vi.mock("~/features/payments/data", () => payments);
vi.mock(
  "~/features/settings/repositories/subscription-actions-data.server",
  () => rows
);
vi.mock("~/features/user", () => users);
vi.mock("~/lib/error-logger.server", () => logs);

import { handleSubscriptionAction } from "~/features/settings/actions/subscription-actions.server";
import { ExternalServiceError } from "~/lib/errors";

interface ActionBody {
  status: number;
  error?: string;
  success?: boolean;
  paid?: boolean;
  invoice?: string;
  message?: string;
  planName?: string;
  planId?: string;
  billingPaymentMethod?: string;
  expiresAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pick(payload: Record<string, unknown>): Omit<ActionBody, "status"> {
  return {
    error: typeof payload.error === "string" ? payload.error : undefined,
    success: typeof payload.success === "boolean" ? payload.success : undefined,
    paid: typeof payload.paid === "boolean" ? payload.paid : undefined,
    invoice: typeof payload.invoice === "string" ? payload.invoice : undefined,
    message: typeof payload.message === "string" ? payload.message : undefined,
    planName:
      typeof payload.planName === "string" ? payload.planName : undefined,
    planId: typeof payload.planId === "string" ? payload.planId : undefined,
    billingPaymentMethod:
      typeof payload.billingPaymentMethod === "string"
        ? payload.billingPaymentMethod
        : undefined,
    expiresAt:
      typeof payload.expiresAt === "string" ? payload.expiresAt : undefined,
  };
}

async function readAction(result: unknown): Promise<ActionBody> {
  if (result instanceof Response) {
    const payload: unknown = await result.json();
    return {
      status: result.status,
      ...(isRecord(payload) ? pick(payload) : {}),
    };
  }
  if (isRecord(result) && "data" in result) {
    const init = isRecord(result.init) ? result.init : {};
    const status = typeof init.status === "number" ? init.status : 200;
    return {
      status,
      ...(isRecord(result.data) ? pick(result.data) : {}),
    };
  }
  if (isRecord(result)) return { status: 200, ...pick(result) };
  return { status: 0 };
}

function brokenForm(): FormData {
  const body = new FormData();
  Object.defineProperty(body, "keys", {
    value: () => {
      throw new Error("unreadable form");
    },
  });
  return body;
}

function form(entries: Record<string, string> = {}): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(entries)) body.set(key, value);
  return body;
}

const periodEnd = new Date("2026-12-01T00:00:00.000Z");

function paidSubscription(overrides: Record<string, unknown> = {}) {
  return {
    planId: "creator",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: periodEnd,
    metadata: {},
    Plan: { name: "Creator", price: "9", enableLifetimeAccess: false },
    ...overrides,
  };
}

describe("handleSubscriptionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    users.getUserBasicInfo.mockResolvedValue({ isChild: false });
    users.getDecryptedUserNWC.mockResolvedValue("nostr+walletconnect://wallet");
    payments.getUserSubscription.mockResolvedValue(paidSubscription());
    payments.getPlanById.mockResolvedValue({
      id: "starter",
      name: "Starter",
      price: "0",
      isActive: true,
    });
    payments.getPlanPriceUsd.mockResolvedValue(12);
    payments.createPlanInvoice.mockResolvedValue({
      invoice: "lnbc1",
      paymentHash: "hash",
      amount: 1000,
      amountUsd: 12,
      paymentId: "pay-1",
      expiresAt: new Date("2026-12-02T00:00:00.000Z"),
      planName: "Starter",
      planId: "starter",
    });
    payments.manuallyVerifyPayment.mockResolvedValue({
      success: true,
      paid: true,
    });
    nwc.payInvoice.mockResolvedValue(undefined);
    nwc.close.mockImplementation(() => undefined);
  });

  it("returns null for an unknown action", async () => {
    await expect(
      handleSubscriptionAction("user-1", "pause", form())
    ).resolves.toBeNull();
  });

  it("rejects linked child accounts before any billing change", async () => {
    users.getUserBasicInfo.mockResolvedValue({ isChild: true });
    for (const action of [
      "cancel_at_period_end",
      "schedule_downgrade",
      "switch_to_free_plan",
      "top_up_subscription",
    ]) {
      const result = await readAction(
        await handleSubscriptionAction("child", action, form())
      );
      expect(result.status).toBe(400);
      expect(result.error).toContain("parent account");
    }
  });

  it("cancels at period end only for a paid, non-lifetime subscription", async () => {
    const broken = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "cancel_at_period_end",
        brokenForm()
      )
    );
    expect(broken.status).toBe(400);

    payments.getUserSubscription.mockResolvedValueOnce(null);
    const missing = await readAction(
      await handleSubscriptionAction("user-1", "cancel_at_period_end", form())
    );
    expect(missing.error).toBe("No active subscription found");

    payments.getUserSubscription.mockResolvedValueOnce(
      paidSubscription({ Plan: null })
    );
    const noPlan = await readAction(
      await handleSubscriptionAction("user-1", "cancel_at_period_end", form())
    );
    expect(noPlan.error).toBe("Subscription plan not found");

    payments.getUserSubscription.mockResolvedValueOnce(
      paidSubscription({ Plan: { price: "0", enableLifetimeAccess: false } })
    );
    const free = await readAction(
      await handleSubscriptionAction("user-1", "cancel_at_period_end", form())
    );
    expect(free.error).toContain("Free plan");

    payments.getUserSubscription.mockResolvedValueOnce(
      paidSubscription({
        Plan: { price: "9", enableLifetimeAccess: true },
      })
    );
    const lifetime = await readAction(
      await handleSubscriptionAction("user-1", "cancel_at_period_end", form())
    );
    expect(lifetime.error).toContain("Lifetime");

    payments.getUserSubscription.mockResolvedValueOnce(
      paidSubscription({ cancelAtPeriodEnd: true })
    );
    const already = await readAction(
      await handleSubscriptionAction("user-1", "cancel_at_period_end", form())
    );
    expect(already.error).toContain("already set to cancel");

    const ok = await readAction(
      await handleSubscriptionAction("user-1", "cancel_at_period_end", form())
    );
    expect(ok.success).toBe(true);
    expect(rows.updateSubscriptionCancelAtPeriodEnd).toHaveBeenCalledWith(
      "user-1",
      true
    );
  });

  it("schedules a downgrade and rejects the blocked states", async () => {
    const invalid = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "schedule_downgrade",
        form({ planId: "nope" })
      )
    );
    expect(invalid.status).toBe(400);

    payments.getPlanById.mockResolvedValueOnce(null);
    const missingPlan = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "schedule_downgrade",
        form({ planId: "starter" })
      )
    );
    expect(missingPlan.error).toBe("Plan not found");

    payments.getUserSubscription.mockResolvedValueOnce(null);
    const missingSub = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "schedule_downgrade",
        form({ planId: "starter" })
      )
    );
    expect(missingSub.error).toBe("No active subscription found");

    payments.getUserSubscription.mockResolvedValueOnce(
      paidSubscription({ Plan: null })
    );
    const noPlan = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "schedule_downgrade",
        form({ planId: "starter" })
      )
    );
    expect(noPlan.error).toBe("Subscription plan not found");

    payments.getUserSubscription.mockResolvedValueOnce(
      paidSubscription({ Plan: { price: "0", enableLifetimeAccess: false } })
    );
    const free = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "schedule_downgrade",
        form({ planId: "starter" })
      )
    );
    expect(free.error).toContain("already on the free plan");

    payments.getUserSubscription.mockResolvedValueOnce(
      paidSubscription({
        Plan: { price: "9", enableLifetimeAccess: true },
      })
    );
    const lifetime = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "schedule_downgrade",
        form({ planId: "starter" })
      )
    );
    expect(lifetime.error).toContain("cannot be downgraded");

    payments.getUserSubscription.mockResolvedValueOnce(
      paidSubscription({ planId: "starter" })
    );
    const same = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "schedule_downgrade",
        form({ planId: "starter" })
      )
    );
    expect(same.error).toContain("already on this plan");

    payments.getUserSubscription.mockResolvedValueOnce(
      paidSubscription({
        cancelAtPeriodEnd: true,
        metadata: { scheduledPlanId: "pro" },
      })
    );
    const queued = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "schedule_downgrade",
        form({ planId: "starter" })
      )
    );
    expect(queued.error).toContain("already scheduled");

    const ok = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "schedule_downgrade",
        form({ planId: "starter" })
      )
    );
    expect(ok.success).toBe(true);
    expect(ok.message).toContain("Starter");
    const saved =
      rows.updateSubscriptionCancelAtPeriodEndAndMetadata.mock.calls[0]?.[1];
    expect(saved?.metadata.scheduledPlanId).toBe("starter");

    payments.getUserSubscription.mockResolvedValueOnce(
      paidSubscription({ currentPeriodEnd: null, metadata: null })
    );
    const openEnded = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "schedule_downgrade",
        form({ planId: "starter" })
      )
    );
    expect(openEnded.message).toContain("period end");
  });

  it("switches only onto a free plan", async () => {
    const invalid = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "switch_to_free_plan",
        form({ planId: "nope" })
      )
    );
    expect(invalid.status).toBe(400);

    payments.getPlanById.mockResolvedValueOnce(null);
    const missing = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "switch_to_free_plan",
        form({ planId: "free" })
      )
    );
    expect(missing.error).toBe("Plan not found");

    payments.getPlanById.mockResolvedValueOnce({
      id: "creator",
      name: "Creator",
      price: "9",
      isActive: true,
    });
    const paid = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "switch_to_free_plan",
        form({ planId: "creator" })
      )
    );
    expect(paid.error).toContain("only allowed for free plans");

    const ok = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "switch_to_free_plan",
        form({ planId: "free" })
      )
    );
    expect(ok.success).toBe(true);
    const saved = payments.updateUserSubscription.mock.calls[0];
    expect(saved?.[0]).toBe("user-1");
    expect(saved?.[1]).toBe("free");
    expect(saved?.[2].startsWith("free_")).toBe(true);
  });

  it("rejects top-ups that are invalid, unavailable, or free", async () => {
    const invalid = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "lightning_one_time",
          billingCadence: "yearly",
          accessDurationMonths: "1",
        })
      )
    );
    expect(invalid.status).toBe(400);

    payments.getUserSubscription.mockResolvedValueOnce(null);
    const missingSub = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "lightning_one_time",
          accessDurationMonths: "1",
        })
      )
    );
    expect(missingSub.error).toBe("No active subscription found");

    payments.getUserSubscription.mockResolvedValueOnce(
      paidSubscription({ Plan: null })
    );
    const noPlan = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "lightning_one_time",
          accessDurationMonths: "1",
        })
      )
    );
    expect(noPlan.error).toBe("Subscription plan not found");

    payments.getUserSubscription.mockResolvedValueOnce(
      paidSubscription({
        Plan: { price: "9", enableLifetimeAccess: true },
      })
    );
    const lifetime = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "lightning_one_time",
          accessDurationMonths: "1",
        })
      )
    );
    expect(lifetime.error).toContain("cannot be topped up");

    payments.getPlanById.mockResolvedValueOnce(null);
    const missingPlan = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "lightning_one_time",
          accessDurationMonths: "1",
        })
      )
    );
    expect(missingPlan.error).toBe("Plan not found");

    payments.getPlanById.mockResolvedValueOnce({
      id: "starter",
      name: "Starter",
      price: "5",
      isActive: false,
    });
    const inactive = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "lightning_one_time",
          accessDurationMonths: "1",
        })
      )
    );
    expect(inactive.error).toBe("Plan is not available");

    payments.getPlanPriceUsd.mockResolvedValueOnce(null);
    const unpriced = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "lightning_one_time",
          accessDurationMonths: "3",
        })
      )
    );
    expect(unpriced.error).toContain("not available");

    payments.createPlanInvoice.mockResolvedValueOnce({
      invoice: "free_plan",
      paymentHash: "hash",
      amount: 0,
      amountUsd: 0,
      paymentId: "pay-free",
      expiresAt: "2026-12-02T00:00:00.000Z",
    });
    const freeInvoice = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "lightning_one_time",
          accessDurationMonths: "6",
        })
      )
    );
    expect(freeInvoice.error).toContain("Free plan cannot be topped up");
  });

  it("returns a lightning invoice and fills missing plan labels", async () => {
    payments.createPlanInvoice.mockResolvedValueOnce({
      invoice: "lnbc1",
      paymentHash: "hash",
      amount: 1000,
      amountUsd: 12,
      paymentId: "pay-1",
      expiresAt: "2026-12-02T00:00:00.000Z",
      planName: null,
      planId: null,
    });
    const result = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "lightning_one_time",
          accessDurationMonths: "1",
        })
      )
    );
    expect(result.success).toBe(true);
    expect(result.invoice).toBe("lnbc1");
    expect(result.planName).toBe("Starter");
    expect(result.planId).toBe("starter");
    expect(result.expiresAt).toBe("2026-12-02T00:00:00.000Z");
    expect(result.billingPaymentMethod).toBe("lightning_one_time");
  });

  it("pays an NWC top-up, falls back to the invoice, and maps thrown errors", async () => {
    const paid = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "nwc_auto_renew",
          accessDurationMonths: "1",
        })
      )
    );
    expect(paid.paid).toBe(true);
    expect(nwc.close).toHaveBeenCalled();

    nwc.close.mockImplementationOnce(() => {
      throw new Error("close");
    });
    const closed = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "nwc_auto_renew",
          accessDurationMonths: "1",
        })
      )
    );
    expect(closed.paid).toBe(true);

    users.getDecryptedUserNWC.mockResolvedValueOnce(null);
    const disconnected = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "nwc_auto_renew",
          accessDurationMonths: "1",
        })
      )
    );
    expect(disconnected.status).toBe(400);
    expect(disconnected.error).toContain("Nostr Wallet Connect");

    nwc.payInvoice.mockRejectedValueOnce("wallet down");
    const manual = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "nwc_auto_renew",
          accessDurationMonths: "1",
        })
      )
    );
    expect(manual.invoice).toBe("lnbc1");
    expect(logs.logError).toHaveBeenCalled();

    payments.getPlanPriceUsd.mockRejectedValueOnce(
      new ExternalServiceError("btc down", 503)
    );
    const upstream = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "lightning_one_time",
          accessDurationMonths: "1",
        })
      )
    );
    expect(upstream.status).toBe(503);
    expect(upstream.error).toBe("btc down");

    payments.createPlanInvoice.mockRejectedValueOnce(new Error("invoice"));
    const failed = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "lightning_one_time",
          accessDurationMonths: "1",
        })
      )
    );
    expect(failed.status).toBe(502);

    payments.createPlanInvoice.mockRejectedValueOnce("boom");
    const text = await readAction(
      await handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "lightning_one_time",
          accessDurationMonths: "1",
        })
      )
    );
    expect(text.status).toBe(502);
  });

  it("returns the invoice when wallet confirmation never arrives", async () => {
    vi.useFakeTimers();
    try {
      payments.manuallyVerifyPayment.mockResolvedValue({
        success: false,
        paid: false,
      });
      const pending = handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "nwc_auto_renew",
          accessDurationMonths: "1",
        })
      );
      await vi.runAllTimersAsync();
      const result = await readAction(await pending);
      expect(result.invoice).toBe("lnbc1");
      expect(payments.manuallyVerifyPayment).toHaveBeenCalledTimes(3);

      nwc.payInvoice.mockImplementationOnce(() => new Promise(() => undefined));
      const timed = handleSubscriptionAction(
        "user-1",
        "top_up_subscription",
        form({
          targetPlanId: "starter",
          paymentLane: "nwc_auto_renew",
          accessDurationMonths: "1",
        })
      );
      await vi.runAllTimersAsync();
      const timedResult = await readAction(await timed);
      expect(timedResult.invoice).toBe("lnbc1");
    } finally {
      vi.useRealTimers();
    }
  });
});
