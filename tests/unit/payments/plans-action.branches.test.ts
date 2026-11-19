import { beforeEach, describe, expect, it, vi } from "vitest";

interface SessionUser {
  id: string;
  isChild: boolean;
}

interface PlanRow {
  id: string;
  isActive: boolean;
  purchasable: boolean;
  planBillingModel: "free" | "recurring" | "lifetime" | "disabled";
  founderSeatCap: number | null;
  price: number;
}

interface InvoiceParams {
  planId: string;
  userId: string;
  description: string;
  amountUsdOverride: number;
  billingCadence: "monthly" | "yearly";
  accessDurationMonths: number;
  billingPaymentMethod:
    "nwc_auto_renew" | "lightning_one_time" | "btc_btcpay_onchain";
}

interface InvoiceResult {
  invoice: string;
  paymentHash: string;
  amount: number;
  amountUsd: number;
  paymentId: string;
  expiresAt: Date;
  planName: string;
  planId: string;
  checkoutKind?: "lightning" | "btcpay";
}

interface PaymentStatus {
  paid: boolean;
  status: string;
  paidAt?: Date;
}

interface PriceParams {
  planId: string;
  billingCadence: "monthly" | "yearly";
  accessDurationMonths: number;
  paymentMethod: "nwc_auto_renew" | "lightning_one_time" | "btc_btcpay_onchain";
}

interface VerifyResult {
  success: boolean;
  paid: boolean;
}

const EXPIRES = new Date("2099-03-01T00:00:00.000Z");

const auth = vi.hoisted(() => ({
  requireUser: vi.fn(async (_request: Request): Promise<SessionUser> => ({
    id: "user-1",
    isChild: false,
  })),
}));

const btcpay = vi.hoisted(() => ({
  isBtcpayConfigured: vi.fn((): boolean => true),
}));

const payments = vi.hoisted(() => ({
  checkPaymentStatus: vi.fn(
    async (_paymentId: string): Promise<PaymentStatus> => ({
      paid: false,
      status: "PENDING",
    })
  ),
  countActiveSubscriptionsForPlan: vi.fn(
    async (_planId: string): Promise<number> => 0
  ),
  createPlanInvoice: vi.fn(
    async (_params: InvoiceParams): Promise<InvoiceResult> => {
      throw new Error("createPlanInvoice mock was not armed");
    }
  ),
  getPlanById: vi.fn(async (_planId: string): Promise<PlanRow | null> => null),
  getPlanPriceUsd: vi.fn(
    async (_params: PriceParams): Promise<number | null> => null
  ),
  getUserSubscription: vi.fn(
    async (
      _userId: string
    ): Promise<{ planId: string | null; status: string } | null> => null
  ),
  manuallyVerifyPayment: vi.fn(
    async (_paymentId: string): Promise<VerifyResult> => ({
      success: true,
      paid: true,
    })
  ),
}));

const nwc = vi.hoisted(() => {
  class NwcChargeError extends Error {
    readonly kind: string;

    constructor(kind: string, message: string) {
      super(message);
      this.name = "NwcChargeError";
      this.kind = kind;
    }
  }

  return {
    NwcChargeError,
    nwcChargeFailureNotice: vi.fn(
      (kind: string): string => `Wallet notice: ${kind}`
    ),
    payBolt11WithUserNwc: vi.fn(
      async (_connection: string, _invoice: string): Promise<void> => undefined
    ),
  };
});

const users = vi.hoisted(() => ({
  getDecryptedUserNWC: vi.fn(
    async (_userId: string): Promise<string | null> => "stored-nwc"
  ),
  touchUserNwcLastUsed: vi.fn(
    async (_userId: string): Promise<void> => undefined
  ),
  updateUserNWC: vi.fn(
    async (
      _userId: string,
      _connection: string,
      _enabled: boolean
    ): Promise<void> => undefined
  ),
}));

const logger = vi.hoisted(() => ({
  logError: vi.fn(
    (_error: unknown, _context?: Record<string, unknown>): void => undefined
  ),
}));

const events = vi.hoisted(() => ({
  trackProductEvent: vi.fn(
    (_name: string, _props?: Record<string, unknown>): void => undefined
  ),
}));

const actionErrors = vi.hoisted(() => ({
  handleActionError: vi.fn((_error: unknown): Response | null =>
    Response.json({ message: "checked failed" })
  ),
}));

vi.mock("~/features/auth/session.server", () => ({
  requireUser: auth.requireUser,
}));
vi.mock("~/features/payments/btcpay.server", () => ({
  isBtcpayConfigured: btcpay.isBtcpayConfigured,
}));
vi.mock("~/features/payments/data", () => ({
  PlanBillingModel: {
    free: "free",
    recurring: "recurring",
    lifetime: "lifetime",
    disabled: "disabled",
  },
  checkPaymentStatus: payments.checkPaymentStatus,
  countActiveSubscriptionsForPlan: payments.countActiveSubscriptionsForPlan,
  createPlanInvoice: payments.createPlanInvoice,
  getPlanById: payments.getPlanById,
  getPlanPriceUsd: payments.getPlanPriceUsd,
  getUserSubscription: payments.getUserSubscription,
  manuallyVerifyPayment: payments.manuallyVerifyPayment,
}));
vi.mock("~/features/payments/services/nwc-user-pay.server", () => ({
  NwcChargeError: nwc.NwcChargeError,
  nwcChargeFailureNotice: nwc.nwcChargeFailureNotice,
  payBolt11WithUserNwc: nwc.payBolt11WithUserNwc,
}));
vi.mock("~/features/user", () => ({
  getDecryptedUserNWC: users.getDecryptedUserNWC,
  touchUserNwcLastUsed: users.touchUserNwcLastUsed,
  updateUserNWC: users.updateUserNWC,
}));
vi.mock("~/lib/error-handler.server", () => ({
  handleActionError: actionErrors.handleActionError,
}));
vi.mock("~/lib/error-logger.server", () => logger);
vi.mock("~/lib/product-events.server", () => events);

import { LINKED_CHILD_BILLING_ERROR } from "~/features/payments/linked-account-subscription";
import { handlePlansAction } from "~/features/payments/services/plans-action.server";
import { planSubscriptionDescription } from "~/lib/brand";
import { ExternalServiceError } from "~/lib/errors";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

function postRequest(): Request {
  return new Request("https://app.example/plans", { method: "POST" });
}

function planRow(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: "pro",
    isActive: true,
    purchasable: true,
    planBillingModel: "recurring",
    founderSeatCap: null,
    price: 20,
    ...overrides,
  };
}

function invoiceResult(overrides: Partial<InvoiceResult> = {}): InvoiceResult {
  return {
    invoice: "lnbc1invoice",
    paymentHash: "hash",
    amount: 1000,
    amountUsd: 20,
    paymentId: "pay_1",
    expiresAt: EXPIRES,
    planName: "Pro",
    planId: "pro",
    checkoutKind: "lightning",
    ...overrides,
  };
}

function invoiceWithoutKind(): InvoiceResult {
  return {
    invoice: "lnbc1invoice",
    paymentHash: "hash",
    amount: 1000,
    amountUsd: 20,
    paymentId: "pay_1",
    expiresAt: EXPIRES,
    planName: "Pro",
    planId: "pro",
  };
}

function checkoutPayload(paymentMode: string, checkoutKind: string) {
  return {
    success: true,
    paymentMode,
    invoice: "lnbc1invoice",
    paymentHash: "hash",
    amount: 1000,
    amountUsd: 20,
    paymentId: "pay_1",
    expiresAt: EXPIRES.toISOString(),
    planName: "Pro",
    planId: "pro",
    checkoutKind,
  };
}

async function select(entries: Record<string, string> = {}) {
  return handlePlansAction(
    form({ intent: "select_plan", planId: "pro", ...entries }),
    postRequest()
  );
}

function invoiceCall(): InvoiceParams {
  const params = payments.createPlanInvoice.mock.calls[0]?.[0];
  if (!params) throw new Error("createPlanInvoice was not called");
  return params;
}

describe("handlePlansAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auth.requireUser.mockResolvedValue({ id: "user-1", isChild: false });
    btcpay.isBtcpayConfigured.mockReturnValue(true);
    payments.getPlanById.mockResolvedValue(planRow());
    payments.getPlanPriceUsd.mockResolvedValue(20);
    payments.createPlanInvoice.mockResolvedValue(invoiceResult());
    payments.getUserSubscription.mockResolvedValue(null);
    payments.countActiveSubscriptionsForPlan.mockResolvedValue(0);
    payments.manuallyVerifyPayment.mockResolvedValue({
      success: true,
      paid: true,
    });
    payments.checkPaymentStatus.mockResolvedValue({
      paid: false,
      status: "PENDING",
    });
    users.getDecryptedUserNWC.mockResolvedValue("stored-nwc");
    nwc.nwcChargeFailureNotice.mockImplementation(
      (kind: string) => `Wallet notice: ${kind}`
    );
    actionErrors.handleActionError.mockImplementation(() =>
      Response.json({ message: "checked failed" })
    );
  });

  it("returns the validation response for a missing or illegal form", async () => {
    const missing = await handlePlansAction(new FormData(), postRequest());
    expect(missing).toBeInstanceOf(Response);
    if (!(missing instanceof Response)) throw new Error("expected Response");
    expect(missing.status).toBe(400);
    expect(await missing.text()).toContain("intent");

    const yearly = await select({
      paymentMode: "btc_onchain",
      billingCadence: "monthly",
    });
    expect(yearly).toBeInstanceOf(Response);
    if (!(yearly instanceof Response)) throw new Error("expected Response");
    expect(await yearly.text()).toContain(
      "billingCadence: Bitcoin on-chain checkout is only available with yearly billing."
    );

    const blank = await handlePlansAction(
      form({ intent: "check_payment", paymentId: "" }),
      postRequest()
    );
    expect(blank).toBeInstanceOf(Response);
    if (!(blank instanceof Response)) throw new Error("expected Response");
    expect(await blank.text()).toContain("paymentId: Payment ID is required");
    expect(auth.requireUser).not.toHaveBeenCalled();
  });

  it("reports a completed payment and an unpaid one", async () => {
    const paidAt = new Date("2099-04-01T00:00:00.000Z");
    payments.checkPaymentStatus.mockResolvedValueOnce({
      paid: true,
      status: "COMPLETED",
      paidAt,
    });
    await expect(
      handlePlansAction(
        form({ intent: "check_payment", paymentId: "pay_1" }),
        postRequest()
      )
    ).resolves.toEqual({
      success: true,
      paid: true,
      paidAt,
      message: "Payment completed successfully!",
    });
    expect(events.trackProductEvent).toHaveBeenCalledWith(
      "checkout_payment_status_checked",
      { paymentId: "pay_1" }
    );

    payments.checkPaymentStatus.mockResolvedValueOnce({
      paid: false,
      status: "PENDING",
    });
    await expect(
      handlePlansAction(
        form({ intent: "check_payment", paymentId: "pay_2" }),
        postRequest()
      )
    ).resolves.toEqual({ success: true, paid: false, status: "PENDING" });
  });

  it("reads a handler message and falls back when the body has none", async () => {
    payments.checkPaymentStatus.mockRejectedValueOnce(new Error("missing"));
    actionErrors.handleActionError.mockReturnValueOnce(
      Response.json({ message: "Card declined" })
    );
    await expect(
      handlePlansAction(
        form({ intent: "check_payment", paymentId: "pay_1" }),
        postRequest()
      )
    ).resolves.toEqual({ success: false, error: "Card declined" });
    const thrown = actionErrors.handleActionError.mock.calls[0]?.[0];
    expect(thrown).toBeInstanceOf(Error);
    if (!(thrown instanceof Error)) throw new Error("expected Error");
    expect(thrown.message).toBe("missing");

    payments.checkPaymentStatus.mockRejectedValueOnce("status down");
    actionErrors.handleActionError.mockReturnValueOnce(
      Response.json({ message: "" })
    );
    await expect(
      handlePlansAction(
        form({ intent: "check_payment", paymentId: "pay_1" }),
        postRequest()
      )
    ).resolves.toEqual({ success: false, error: "" });
    expect(actionErrors.handleActionError.mock.calls[1]?.[0]).toBe(
      "status down"
    );

    for (const body of [null, ["nope"], { message: 5 }, { error: "x" }]) {
      payments.checkPaymentStatus.mockRejectedValueOnce(new Error("missing"));
      actionErrors.handleActionError.mockReturnValueOnce(Response.json(body));
      await expect(
        handlePlansAction(
          form({ intent: "check_payment", paymentId: "pay_1" }),
          postRequest()
        )
      ).resolves.toEqual({
        success: false,
        error: "Failed to check payment status",
      });
    }

    payments.checkPaymentStatus.mockRejectedValueOnce(new Error("missing"));
    actionErrors.handleActionError.mockReturnValueOnce(null);
    await expect(
      handlePlansAction(
        form({ intent: "check_payment", paymentId: "pay_1" }),
        postRequest()
      )
    ).resolves.toEqual({
      success: false,
      error: "Failed to check payment status",
    });
  });

  it("blocks a linked child before opening checkout", async () => {
    auth.requireUser.mockResolvedValueOnce({ id: "child-1", isChild: true });
    await expect(select()).resolves.toEqual({
      success: false,
      error: LINKED_CHILD_BILLING_ERROR,
      status: 400,
    });
    expect(events.trackProductEvent).not.toHaveBeenCalled();
    expect(payments.createPlanInvoice).not.toHaveBeenCalled();
  });

  it("activates the free plan or explains why it cannot", async () => {
    payments.createPlanInvoice.mockResolvedValueOnce(
      invoiceResult({ invoice: "free_plan" })
    );
    await expect(select({ planId: "free" })).resolves.toEqual({
      redirect:
        "/dashboard?planActivated=true&message=" +
        encodeURIComponent("Free plan activated successfully!"),
    });
    expect(invoiceCall()).toEqual({
      planId: "free",
      userId: "user-1",
      description: planSubscriptionDescription,
      amountUsdOverride: 0,
      billingCadence: "monthly",
      accessDurationMonths: 1,
      billingPaymentMethod: "lightning_one_time",
    });
    expect(payments.getPlanById).not.toHaveBeenCalled();

    payments.createPlanInvoice.mockResolvedValueOnce(
      invoiceResult({ invoice: "lnbc1notfree" })
    );
    await expect(select({ planId: "free" })).resolves.toEqual({
      success: false,
      error: "Could not activate the free plan.",
      status: 500,
    });
    await expect(
      select({
        planId: "free",
        paymentMode: "btc_onchain",
        billingCadence: "yearly",
      })
    ).resolves.toEqual({
      success: false,
      error: "Bitcoin on-chain checkout is not available for the free plan.",
      status: 400,
    });
  });

  it("rejects an inactive, disabled, or unpurchasable plan", async () => {
    payments.getPlanById.mockResolvedValueOnce(null);
    await expect(select()).resolves.toEqual({
      success: false,
      error: "This plan is not available.",
      status: 404,
    });
    payments.getPlanById.mockResolvedValueOnce(planRow({ isActive: false }));
    await expect(select()).resolves.toEqual({
      success: false,
      error: "This plan is not available.",
      status: 404,
    });
    payments.getPlanById.mockResolvedValueOnce(
      planRow({ planBillingModel: "disabled" })
    );
    await expect(select()).resolves.toEqual({
      success: false,
      error: "This plan is not available for purchase.",
      status: 400,
    });
    payments.getPlanById.mockResolvedValueOnce(planRow({ purchasable: false }));
    await expect(select()).resolves.toEqual({
      success: false,
      error: "This plan is not available for purchase.",
      status: 400,
    });
  });

  it("refuses lifetime auto-renew and enforces the founder seat cap", async () => {
    payments.getPlanById.mockResolvedValue(
      planRow({
        id: "founder",
        planBillingModel: "lifetime",
        founderSeatCap: 10,
        price: 250,
      })
    );
    await expect(
      select({ planId: "founder", paymentMode: "auto_renew" })
    ).resolves.toEqual({
      success: false,
      error:
        "Lifetime access does not support wallet auto-renew. Use one-time Lightning or Bitcoin on-chain.",
      status: 400,
    });

    payments.countActiveSubscriptionsForPlan.mockResolvedValue(10);
    payments.getUserSubscription.mockResolvedValue(null);
    await expect(select({ planId: "founder" })).resolves.toEqual({
      success: false,
      error: "Founder access is sold out.",
      status: 400,
    });
    payments.getUserSubscription.mockResolvedValue({
      planId: "pro",
      status: "ACTIVE",
    });
    await expect(select({ planId: "founder" })).resolves.toEqual({
      success: false,
      error: "Founder access is sold out.",
      status: 400,
    });
    payments.getUserSubscription.mockResolvedValue({
      planId: "founder",
      status: "PAST_DUE",
    });
    await expect(select({ planId: "founder" })).resolves.toEqual({
      success: false,
      error: "Founder access is sold out.",
      status: 400,
    });

    payments.getUserSubscription.mockResolvedValue({
      planId: "founder",
      status: "ACTIVE",
    });
    payments.getPlanPriceUsd.mockResolvedValue(null);
    await expect(
      select({ planId: "founder", billingCadence: "monthly" })
    ).resolves.toEqual(checkoutPayload("manual", "lightning"));
    expect(invoiceCall()).toMatchObject({
      planId: "founder",
      billingCadence: "yearly",
      accessDurationMonths: 12,
      billingPaymentMethod: "lightning_one_time",
      amountUsdOverride: 250,
    });

    payments.getPlanById.mockResolvedValue(
      planRow({
        id: "founder",
        planBillingModel: "lifetime",
        founderSeatCap: null,
        price: 250,
      })
    );
    await select({ planId: "founder" });
    expect(payments.countActiveSubscriptionsForPlan).toHaveBeenCalledTimes(4);
  });

  it("creates a Bitcoin checkout from the catalog price or the yearly fallback", async () => {
    payments.getPlanPriceUsd.mockResolvedValueOnce(99);
    payments.createPlanInvoice.mockResolvedValueOnce(
      invoiceResult({ checkoutKind: "btcpay", amountUsd: 99 })
    );
    await expect(
      select({
        paymentMode: "btc_onchain",
        billingCadence: "yearly",
        accessDurationMonths: "6",
      })
    ).resolves.toMatchObject({
      success: true,
      checkoutKind: "btcpay",
      amountUsd: 99,
      paymentMode: "btc_onchain",
    });
    expect(invoiceCall()).toMatchObject({
      billingCadence: "yearly",
      accessDurationMonths: 6,
      billingPaymentMethod: "btc_btcpay_onchain",
      amountUsdOverride: 99,
    });
    expect(events.trackProductEvent).toHaveBeenCalledWith(
      "checkout_btcpay_invoice_created",
      { userId: "user-1", planId: "pro", paymentId: "pay_1" }
    );

    payments.getPlanPriceUsd.mockResolvedValue(null);
    payments.createPlanInvoice.mockResolvedValue(invoiceWithoutKind());
    await expect(
      select({ paymentMode: "btc_onchain", billingCadence: "yearly" })
    ).resolves.toEqual(checkoutPayload("btc_onchain", "btcpay"));
    expect(
      payments.createPlanInvoice.mock.calls.at(-1)?.[0].amountUsdOverride
    ).toBe(200);

    payments.getPlanById.mockResolvedValue(
      planRow({ planBillingModel: "lifetime", price: 250, id: "founder" })
    );
    await select({
      planId: "founder",
      paymentMode: "btc_onchain",
      billingCadence: "yearly",
      accessDurationMonths: "6",
    });
    expect(payments.createPlanInvoice.mock.calls.at(-1)?.[0]).toMatchObject({
      amountUsdOverride: 250,
      accessDurationMonths: 6,
      billingPaymentMethod: "btc_btcpay_onchain",
    });
  });

  it("rejects Bitcoin checkout when it is unavailable or unpriced", async () => {
    btcpay.isBtcpayConfigured.mockReturnValue(false);
    await expect(
      select({ paymentMode: "btc_onchain", billingCadence: "yearly" })
    ).resolves.toEqual({
      success: false,
      error: "Bitcoin on-chain checkout is not available right now.",
      status: 503,
    });

    btcpay.isBtcpayConfigured.mockReturnValue(true);
    payments.getPlanPriceUsd.mockResolvedValue(null);
    await expect(
      select({
        paymentMode: "btc_onchain",
        billingCadence: "yearly",
        accessDurationMonths: "6",
      })
    ).resolves.toEqual({
      success: false,
      error: "Bitcoin on-chain price is not configured for this plan (yearly).",
      status: 400,
    });
    payments.getPlanById.mockResolvedValue(planRow({ price: -1 }));
    await expect(
      select({ paymentMode: "btc_onchain", billingCadence: "yearly" })
    ).resolves.toEqual({
      success: false,
      error: "Bitcoin on-chain price is not configured for this plan (yearly).",
      status: 400,
    });
    payments.getPlanById.mockResolvedValue(planRow({ price: Number.NaN }));
    await expect(
      select({ paymentMode: "btc_onchain", billingCadence: "yearly" })
    ).resolves.toMatchObject({ success: false, status: 400 });
  });

  it("prices lightning and auto-renew from the catalog or the duration fallback", async () => {
    await expect(select()).resolves.toEqual(
      checkoutPayload("manual", "lightning")
    );
    expect(invoiceCall()).toEqual({
      planId: "pro",
      userId: "user-1",
      description: planSubscriptionDescription,
      amountUsdOverride: 20,
      billingCadence: "monthly",
      accessDurationMonths: 1,
      billingPaymentMethod: "lightning_one_time",
    });

    payments.getPlanPriceUsd.mockResolvedValue(null);
    await select({ billingCadence: "monthly", accessDurationMonths: "3" });
    expect(
      payments.createPlanInvoice.mock.calls.at(-1)?.[0].amountUsdOverride
    ).toBe(60);
    await select({ billingCadence: "yearly" });
    expect(
      payments.createPlanInvoice.mock.calls.at(-1)?.[0].amountUsdOverride
    ).toBe(200);
    await select({ paymentMode: "auto_renew" });
    expect(payments.createPlanInvoice.mock.calls.at(-1)?.[0]).toMatchObject({
      billingPaymentMethod: "nwc_auto_renew",
      accessDurationMonths: 1,
      amountUsdOverride: 20,
    });

    await expect(
      select({ billingCadence: "monthly", accessDurationMonths: "2" })
    ).resolves.toEqual({
      success: false,
      error: "This billing option is not available for the selected plan.",
      status: 400,
    });
    await expect(
      select({
        paymentMode: "auto_renew",
        billingCadence: "monthly",
        accessDurationMonths: "3",
      })
    ).resolves.toEqual({
      success: false,
      error: "This billing option is not available for the selected plan.",
      status: 400,
    });
    await expect(
      select({ billingCadence: "yearly", accessDurationMonths: "6" })
    ).resolves.toMatchObject({ success: false, status: 400 });

    payments.getPlanById.mockResolvedValue(planRow({ price: 0 }));
    await expect(select({ billingCadence: "yearly" })).resolves.toMatchObject({
      success: true,
    });
    expect(
      payments.createPlanInvoice.mock.calls.at(-1)?.[0].amountUsdOverride
    ).toBe(0);
  });

  it("pays an auto-renew invoice immediately or returns the wallet error", async () => {
    await expect(
      select({
        paymentMode: "auto_renew",
        nwcString: "  nostr+walletconnect://new  ",
      })
    ).resolves.toEqual({
      success: true,
      paid: true,
      message: "Subscription started with auto-renew enabled.",
    });
    expect(users.updateUserNWC).toHaveBeenCalledWith(
      "user-1",
      "nostr+walletconnect://new",
      true
    );
    expect(users.getDecryptedUserNWC).not.toHaveBeenCalled();
    expect(nwc.payBolt11WithUserNwc).toHaveBeenCalledWith(
      "nostr+walletconnect://new",
      "lnbc1invoice"
    );
    expect(users.touchUserNwcLastUsed).toHaveBeenCalledWith("user-1");
    expect(events.trackProductEvent).toHaveBeenCalledWith(
      "first_payment_succeeded",
      { userId: "user-1", planId: "pro", paymentMode: "auto_renew" }
    );

    users.getDecryptedUserNWC.mockResolvedValueOnce(null);
    await expect(
      select({ paymentMode: "auto_renew", nwcString: "  " })
    ).resolves.toEqual({
      success: false,
      error:
        "Connect a wallet with Nostr Wallet Connect to enable automatic renewals.",
      status: 400,
    });
    expect(nwc.payBolt11WithUserNwc).toHaveBeenCalledTimes(1);

    nwc.payBolt11WithUserNwc.mockRejectedValueOnce(
      new nwc.NwcChargeError("connection_dead", "socket closed")
    );
    await expect(select({ paymentMode: "auto_renew" })).resolves.toEqual({
      success: false,
      error: "Wallet notice: connection_dead",
      status: 502,
    });
    nwc.payBolt11WithUserNwc.mockRejectedValueOnce(new Error("rejected"));
    await expect(select({ paymentMode: "auto_renew" })).resolves.toEqual({
      success: false,
      error: "Wallet notice: wallet_rejected",
      status: 502,
    });
    nwc.payBolt11WithUserNwc.mockRejectedValueOnce("wallet string");
    await expect(select({ paymentMode: "auto_renew" })).resolves.toEqual({
      success: false,
      error: "Wallet notice: wallet_rejected",
      status: 502,
    });
    const logged = logger.logError.mock.calls.at(-1)?.[0];
    expect(logged).toBeInstanceOf(Error);
    if (!(logged instanceof Error)) throw new Error("expected Error");
    expect(logged.message).toBe("wallet string");
    expect(logger.logError.mock.calls.at(-1)?.[1]).toEqual({
      userId: "user-1",
      planId: "pro",
      kind: "wallet_rejected",
      message: "Immediate NWC payment failed",
    });
  });

  it("keeps polling after an unconfirmed wallet charge and after a failed check", async () => {
    nwc.payBolt11WithUserNwc.mockRejectedValueOnce(
      new nwc.NwcChargeError("unconfirmed", "slow")
    );
    await expect(select({ paymentMode: "auto_renew" })).resolves.toEqual({
      success: true,
      paid: true,
      message: "Subscription started with auto-renew enabled.",
    });
    expect(nwc.nwcChargeFailureNotice).not.toHaveBeenCalled();
    expect(users.touchUserNwcLastUsed).not.toHaveBeenCalled();

    payments.manuallyVerifyPayment
      .mockResolvedValueOnce({ success: false, paid: true })
      .mockResolvedValueOnce({ success: true, paid: false })
      .mockResolvedValueOnce({ success: true, paid: true });
    vi.useFakeTimers();
    try {
      const pending = select({ paymentMode: "auto_renew" });
      await vi.advanceTimersByTimeAsync(2000);
      await expect(pending).resolves.toMatchObject({
        success: true,
        paid: true,
      });
    } finally {
      vi.useRealTimers();
    }
    expect(payments.manuallyVerifyPayment).toHaveBeenCalledTimes(4);
  });

  it("returns the invoice when three verification attempts stay unpaid", async () => {
    vi.useFakeTimers();
    try {
      payments.manuallyVerifyPayment.mockResolvedValue({
        success: true,
        paid: false,
      });
      const pending = select({ paymentMode: "auto_renew" });
      await vi.advanceTimersByTimeAsync(2000);
      await expect(pending).resolves.toEqual(
        checkoutPayload("auto_renew", "lightning")
      );
      expect(payments.manuallyVerifyPayment).toHaveBeenCalledTimes(3);
      expect(events.trackProductEvent).toHaveBeenCalledWith(
        "first_payment_pending",
        {
          userId: "user-1",
          planId: "pro",
          paymentId: "pay_1",
          paymentMode: "auto_renew",
        }
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves an explicit checkout kind and logs invoice failures", async () => {
    payments.createPlanInvoice.mockResolvedValueOnce(
      invoiceResult({ checkoutKind: "btcpay" })
    );
    await expect(select()).resolves.toEqual(
      checkoutPayload("manual", "btcpay")
    );

    payments.createPlanInvoice.mockRejectedValueOnce(
      new ExternalServiceError("upstream", 502)
    );
    await expect(select()).resolves.toEqual({ error: "upstream", status: 502 });
    expect(logger.logError.mock.calls.at(-1)?.[1]).toEqual({
      userId: "user-1",
      planId: "pro",
      message: "Error creating plan invoice",
    });

    payments.getPlanById.mockRejectedValueOnce("plan string");
    await expect(select()).resolves.toEqual({
      error: "Failed to create payment invoice",
      status: 500,
    });
    const stringError = logger.logError.mock.calls.at(-1)?.[0];
    expect(stringError).toBeInstanceOf(Error);
    if (!(stringError instanceof Error)) throw new Error("expected Error");
    expect(stringError.message).toBe("plan string");

    const coded = new Error("coded");
    Object.assign(coded, { statusCode: "503" });
    payments.getPlanById.mockRejectedValueOnce(coded);
    await expect(select()).resolves.toEqual({ error: "coded", status: 500 });

    auth.requireUser.mockRejectedValue(new Error("no session"));
    await expect(select()).resolves.toEqual({
      error: "no session",
      status: 500,
    });
    expect(logger.logError.mock.calls.at(-1)?.[1]).toEqual({
      userId: undefined,
      planId: "pro",
      message: "Error creating plan invoice",
    });

    actionErrors.handleActionError.mockImplementation(() => {
      throw new Error("handler blew up");
    });
    payments.checkPaymentStatus.mockRejectedValue(new Error("missing"));
    auth.requireUser.mockResolvedValue({ id: "user-1", isChild: false });
    await expect(
      handlePlansAction(
        form({ intent: "check_payment", paymentId: "pay_1" }),
        postRequest()
      )
    ).resolves.toEqual({ error: "handler blew up", status: 500 });
    expect(logger.logError.mock.calls.at(-1)?.[1]).toEqual({
      userId: "user-1",
      planId: undefined,
      message: "Error creating plan invoice",
    });
  });
});
