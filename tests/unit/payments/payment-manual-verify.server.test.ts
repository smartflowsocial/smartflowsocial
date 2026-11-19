import { beforeEach, describe, expect, it, vi } from "vitest";

interface PaymentRow {
  id: string;
  status: string;
  userId: string | null;
  purpose: string;
  billingPaymentMethod: string | null;
  btcpayInvoiceId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  paymentHash: string;
  amount: number;
  Subscription: { planId: string | null } | null;
}

interface InvoiceSnapshot {
  invoiceStatus: string;
  maxOnChainConfirmations: number;
  hasOnChainPaymentStarted: boolean;
}

interface LookupArgs {
  lookup: (paymentHash: string) => Promise<unknown>;
  paymentHash: string;
  expectedAmountSats: number;
  timeoutMs: number;
}

interface LookupVerdict {
  kind: "settled" | "unpaid" | "inconclusive";
  reason?: string;
  preimage?: string | null;
  assurance?: string;
}

const btcpay = vi.hoisted(() => ({
  btcpayGetInvoiceSnapshot:
    vi.fn<(invoiceId: string) => Promise<InvoiceSnapshot>>(),
}));

const incoming = vi.hoisted(() => ({
  lookupIncomingInvoice: vi.fn<(args: LookupArgs) => Promise<LookupVerdict>>(),
}));

const timeouts = vi.hoisted(() => ({
  nwcTimeouts: vi.fn(() => ({ payMs: 45_000, reconcileMs: 2_222 })),
}));

const envState = vi.hoisted(() => ({
  OWNER_NWC: "nostr+walletconnect://owner",
}));

const logger = vi.hoisted(() => ({
  logError:
    vi.fn<(error: unknown, context?: Record<string, unknown>) => void>(),
}));

const prismaMock = vi.hoisted(() => ({
  payment: {
    findUnique:
      vi.fn<
        (args: {
          where: { id: string };
          include: { Subscription: { select: { planId: true } } };
        }) => Promise<PaymentRow | null>
      >(),
    updateMany:
      vi.fn<
        (args: {
          where: { id: string; preimage: null };
          data: { preimage: string };
        }) => Promise<{ count: number }>
      >(),
  },
}));

const wallet = vi.hoisted(() => ({
  getOwnerNwcWithRelayOverrides:
    vi.fn<(ownerNwc: string) => { credentials: string; relays: string[] }>(),
}));

const handlers = vi.hoisted(() => ({
  handlePaymentCompleted:
    vi.fn<
      (paymentId: string, userId: string, planId: string) => Promise<void>
    >(),
  handlePaymentTimeout: vi.fn<(paymentId: string) => Promise<void>>(),
}));

const nwcState = vi.hoisted(() => ({
  urls: [] as string[],
  lookupInvoice: vi.fn<(args: { payment_hash: string }) => Promise<unknown>>(),
  close: vi.fn<() => void>(),
}));

vi.mock("~/features/payments/btcpay.server", () => ({
  BTCPAY_MIN_ONCHAIN_CONFIRMS_FOR_ACCESS: 1,
  btcpayGetInvoiceSnapshot: btcpay.btcpayGetInvoiceSnapshot,
}));
vi.mock("~/features/payments/incoming-nwc-lookup", () => incoming);
vi.mock("~/features/payments/nwc-authorized-pay.server", () => timeouts);
vi.mock("~/lib/env.server", () => ({ env: envState }));
vi.mock("~/lib/error-logger.server", () => logger);
vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));
vi.mock("~/features/payments/data/payment-shared.server", () => wallet);
vi.mock("~/features/payments/data/payment.handlers.server", () => handlers);
vi.mock("@getalby/sdk", () => ({
  NWCClient: class NWCClient {
    constructor(options: { nostrWalletConnectUrl: string }) {
      nwcState.urls.push(options.nostrWalletConnectUrl);
    }

    lookupInvoice(args: { payment_hash: string }): Promise<unknown> {
      return nwcState.lookupInvoice(args);
    }

    close(): void {
      nwcState.close();
    }
  },
}));

import { manuallyVerifyPayment } from "~/features/payments/data/payment-manual-verify.server";
import { OWNER_NWC_MISSING } from "~/features/payments/data/payment-owner-wallet-invoice-timeout.server";

function payment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: "pay-1",
    status: "PENDING",
    userId: "user-1",
    purpose: "SUBSCRIPTION",
    billingPaymentMethod: "lightning",
    btcpayInvoiceId: null,
    expiresAt: null,
    createdAt: new Date(),
    paymentHash: "hash-1",
    amount: 1_000,
    Subscription: { planId: "starter" },
    ...overrides,
  };
}

function loggedError(index = 0): Error {
  const error = logger.logError.mock.calls[index]?.[0];
  if (!(error instanceof Error)) throw new Error("expected logged Error");
  return error;
}

describe("manuallyVerifyPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    envState.OWNER_NWC = "nostr+walletconnect://owner";
    nwcState.urls.length = 0;
    nwcState.close.mockImplementation(() => undefined);
    wallet.getOwnerNwcWithRelayOverrides.mockReturnValue({
      credentials: "nostr+walletconnect://overridden",
      relays: ["wss://relay.example"],
    });
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });
    handlers.handlePaymentCompleted.mockResolvedValue(undefined);
    handlers.handlePaymentTimeout.mockResolvedValue(undefined);
    incoming.lookupIncomingInvoice.mockResolvedValue({ kind: "unpaid" });
  });

  it("returns not found, already completed, an unknown plan, and a non-pending row", async () => {
    prismaMock.payment.findUnique.mockResolvedValueOnce(null);
    await expect(manuallyVerifyPayment("missing")).resolves.toEqual({
      success: false,
      paid: false,
      message: "Payment not found",
    });
    expect(prismaMock.payment.findUnique).toHaveBeenCalledWith({
      where: { id: "missing" },
      include: { Subscription: { select: { planId: true } } },
    });

    prismaMock.payment.findUnique.mockResolvedValueOnce(
      payment({ status: "COMPLETED", Subscription: null, id: "done" })
    );
    await expect(manuallyVerifyPayment("done")).resolves.toEqual({
      success: true,
      paid: true,
      message: "Payment already completed",
    });

    prismaMock.payment.findUnique.mockResolvedValueOnce(
      payment({
        id: "only",
        Subscription: null,
        purpose: "SUBSCRIPTION",
      })
    );
    await expect(manuallyVerifyPayment("only")).resolves.toEqual({
      success: false,
      paid: false,
      message: "Could not determine plan for this payment",
    });

    prismaMock.payment.findUnique.mockResolvedValueOnce(
      payment({ id: "_x_y", Subscription: null })
    );
    await expect(manuallyVerifyPayment("_x_y")).resolves.toEqual({
      success: false,
      paid: false,
      message: "Could not determine plan for this payment",
    });

    prismaMock.payment.findUnique.mockResolvedValueOnce(
      payment({ status: "FAILED" })
    );
    await expect(manuallyVerifyPayment("pay-1")).resolves.toEqual({
      success: true,
      paid: false,
      message: "Payment is not pending",
    });

    prismaMock.payment.findUnique.mockResolvedValueOnce(
      payment({ userId: "" })
    );
    await expect(manuallyVerifyPayment("pay-1")).resolves.toEqual({
      success: true,
      paid: false,
      message: "Payment is not pending",
    });
  });

  it("derives a plan id from a giveaway, the subscription, or the payment id", async () => {
    btcpay.btcpayGetInvoiceSnapshot.mockResolvedValue({
      invoiceStatus: "New",
      maxOnChainConfirmations: 1,
      hasOnChainPaymentStarted: true,
    });
    prismaMock.payment.findUnique.mockResolvedValueOnce(
      payment({
        purpose: "GIVEAWAY_FINALIZATION",
        billingPaymentMethod: "btc_btcpay_onchain",
        btcpayInvoiceId: "inv-g",
        Subscription: { planId: "starter" },
      })
    );
    await manuallyVerifyPayment("pay-1");
    expect(handlers.handlePaymentCompleted).toHaveBeenCalledWith(
      "pay-1",
      "user-1",
      "__giveaway_finalization__"
    );

    prismaMock.payment.findUnique.mockResolvedValueOnce(
      payment({
        id: "ignored_user_1",
        Subscription: { planId: "creator" },
        billingPaymentMethod: "btc_btcpay_onchain",
        btcpayInvoiceId: "inv-s",
      })
    );
    await manuallyVerifyPayment("ignored_user_1");
    expect(handlers.handlePaymentCompleted).toHaveBeenLastCalledWith(
      "ignored_user_1",
      "user-1",
      "creator"
    );

    prismaMock.payment.findUnique.mockResolvedValueOnce(
      payment({
        id: "pro_user_1",
        Subscription: { planId: "" },
        billingPaymentMethod: "btc_btcpay_onchain",
        btcpayInvoiceId: "inv-p",
      })
    );
    await manuallyVerifyPayment("pro_user_1");
    expect(handlers.handlePaymentCompleted).toHaveBeenLastCalledWith(
      "pro_user_1",
      "user-1",
      "pro"
    );
  });

  it("closes an expired BTCPay window and settles each invoice status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
    btcpay.btcpayGetInvoiceSnapshot.mockResolvedValueOnce({
      invoiceStatus: "New",
      maxOnChainConfirmations: 0,
      hasOnChainPaymentStarted: false,
    });
    prismaMock.payment.findUnique.mockResolvedValueOnce(
      payment({
        billingPaymentMethod: "btc_btcpay_onchain",
        btcpayInvoiceId: "inv-old",
        expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      })
    );
    await expect(manuallyVerifyPayment("pay-1")).resolves.toEqual({
      success: true,
      paid: false,
      message: "Payment not received yet",
    });

    prismaMock.payment.findUnique.mockResolvedValueOnce(
      payment({
        billingPaymentMethod: "btc_btcpay_onchain",
        btcpayInvoiceId: "inv-ended",
        expiresAt: new Date("2025-12-31T23:59:59.999Z"),
      })
    );
    await expect(manuallyVerifyPayment("pay-1")).resolves.toEqual({
      success: false,
      paid: false,
      message:
        "Payment window has ended. Please contact support if you already paid.",
    });
    expect(btcpay.btcpayGetInvoiceSnapshot).toHaveBeenCalledTimes(1);

    for (const invoiceStatus of [" Expired ", "INVALID", "expired"]) {
      btcpay.btcpayGetInvoiceSnapshot.mockResolvedValueOnce({
        invoiceStatus,
        maxOnChainConfirmations: 3,
        hasOnChainPaymentStarted: true,
      });
      prismaMock.payment.findUnique.mockResolvedValueOnce(
        payment({
          billingPaymentMethod: "btc_btcpay_onchain",
          btcpayInvoiceId: "inv-dead",
          expiresAt: null,
        })
      );
      await expect(manuallyVerifyPayment("pay-1")).resolves.toEqual({
        success: true,
        paid: false,
        message: "Invoice expired or was invalidated",
      });
    }
    expect(handlers.handlePaymentTimeout).toHaveBeenCalledTimes(3);
    expect(handlers.handlePaymentTimeout).toHaveBeenCalledWith("pay-1");

    btcpay.btcpayGetInvoiceSnapshot.mockResolvedValueOnce({
      invoiceStatus: "Settled",
      maxOnChainConfirmations: 0,
      hasOnChainPaymentStarted: true,
    });
    prismaMock.payment.findUnique.mockResolvedValueOnce(
      payment({
        billingPaymentMethod: "btc_btcpay_onchain",
        btcpayInvoiceId: "inv-wait",
        expiresAt: null,
      })
    );
    await expect(manuallyVerifyPayment("pay-1")).resolves.toEqual({
      success: true,
      paid: false,
      btcpayAwaitingConfirmations: true,
      message: "Payment seen; waiting for first on-chain confirmation",
    });

    btcpay.btcpayGetInvoiceSnapshot.mockResolvedValueOnce({
      invoiceStatus: "New",
      maxOnChainConfirmations: 2,
      hasOnChainPaymentStarted: false,
    });
    prismaMock.payment.findUnique.mockResolvedValueOnce(
      payment({
        billingPaymentMethod: "btc_btcpay_onchain",
        btcpayInvoiceId: "inv-new",
        expiresAt: null,
      })
    );
    await expect(manuallyVerifyPayment("pay-1")).resolves.toEqual({
      success: true,
      paid: false,
      message: "Payment not received yet",
    });
  });

  it("logs a BTCPay lookup Error and a thrown string", async () => {
    prismaMock.payment.findUnique.mockResolvedValue(
      payment({
        billingPaymentMethod: "btc_btcpay_onchain",
        btcpayInvoiceId: "inv-err",
        expiresAt: null,
      })
    );
    btcpay.btcpayGetInvoiceSnapshot.mockRejectedValueOnce(
      new Error("btc down")
    );
    await expect(manuallyVerifyPayment("pay-1")).resolves.toEqual({
      success: false,
      paid: false,
      message: "Failed to verify payment",
    });
    expect(loggedError().message).toBe("btc down");
    expect(logger.logError.mock.calls[0]?.[1]).toEqual({
      paymentId: "pay-1",
      message: "Failed to verify BTCPay invoice",
    });

    btcpay.btcpayGetInvoiceSnapshot.mockRejectedValueOnce("btc string");
    await manuallyVerifyPayment("pay-1");
    expect(loggedError(1).message).toBe("btc string");
  });

  it("refuses an NWC payment that is too old or has no owner wallet", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:30:00.000Z"));
    prismaMock.payment.findUnique.mockResolvedValueOnce(
      payment({ createdAt: new Date("2026-01-01T00:00:00.000Z") })
    );
    await expect(manuallyVerifyPayment("pay-1")).resolves.toEqual({
      success: false,
      paid: false,
      outcome: "inconclusive",
      message: "Payment is too old to auto-verify. Please contact support.",
    });

    prismaMock.payment.findUnique.mockResolvedValueOnce(
      payment({ createdAt: new Date("2026-01-01T00:00:00.001Z") })
    );
    incoming.lookupIncomingInvoice.mockResolvedValueOnce({ kind: "unpaid" });
    await expect(manuallyVerifyPayment("pay-1")).resolves.toMatchObject({
      outcome: "unpaid",
    });

    vi.useRealTimers();
    envState.OWNER_NWC = undefined;
    prismaMock.payment.findUnique.mockResolvedValueOnce(payment());
    await expect(manuallyVerifyPayment("pay-1")).resolves.toEqual({
      success: false,
      paid: false,
      outcome: "inconclusive",
      message: OWNER_NWC_MISSING,
    });
    expect(nwcState.urls).toEqual(["nostr+walletconnect://overridden"]);
  });

  it("verifies each incoming lookup verdict and stores a preimage", async () => {
    prismaMock.payment.findUnique.mockResolvedValue(payment());
    incoming.lookupIncomingInvoice.mockResolvedValueOnce({ kind: "unpaid" });
    await expect(manuallyVerifyPayment("pay-1")).resolves.toEqual({
      success: true,
      paid: false,
      outcome: "unpaid",
      message: "Invoice is not paid",
    });
    const lookup = incoming.lookupIncomingInvoice.mock.calls[0]?.[0];
    if (!lookup) throw new Error("missing lookup");
    expect(lookup.paymentHash).toBe("hash-1");
    expect(lookup.expectedAmountSats).toBe(1_000);
    expect(lookup.timeoutMs).toBe(2_222);
    nwcState.lookupInvoice.mockResolvedValueOnce({ state: "open" });
    await lookup.lookup("hash-1");
    expect(nwcState.lookupInvoice).toHaveBeenCalledWith({
      payment_hash: "hash-1",
    });
    expect(wallet.getOwnerNwcWithRelayOverrides).toHaveBeenCalledWith(
      "nostr+walletconnect://owner"
    );
    expect(nwcState.close).toHaveBeenCalledTimes(1);

    incoming.lookupIncomingInvoice.mockResolvedValueOnce({
      kind: "settled",
      assurance: "preimage",
      preimage: "ab".repeat(32),
    });
    await expect(manuallyVerifyPayment("pay-1")).resolves.toEqual({
      success: true,
      paid: true,
      outcome: "settled",
      message: "Payment verified and completed",
    });
    expect(handlers.handlePaymentCompleted).toHaveBeenCalledWith(
      "pay-1",
      "user-1",
      "starter"
    );
    expect(prismaMock.payment.updateMany).toHaveBeenCalledWith({
      where: { id: "pay-1", preimage: null },
      data: { preimage: "ab".repeat(32) },
    });

    incoming.lookupIncomingInvoice.mockResolvedValueOnce({
      kind: "settled",
      assurance: "wallet_reported",
      preimage: null,
    });
    await manuallyVerifyPayment("pay-1");
    expect(prismaMock.payment.updateMany).toHaveBeenCalledTimes(1);

    const inconclusive: Array<{
      reason: string;
      success: boolean;
      message: string;
    }> = [
      {
        reason: "lookup_timeout",
        success: false,
        message: "Payment lookup did not finish in time",
      },
      {
        reason: "lookup_failed",
        success: false,
        message: "Payment could not be verified",
      },
      {
        reason: "not_settled",
        success: true,
        message: "Payment not settled yet",
      },
      {
        reason: "lookup_not_found",
        success: true,
        message: "Payment could not be verified",
      },
    ];
    for (const item of inconclusive) {
      incoming.lookupIncomingInvoice.mockResolvedValueOnce({
        kind: "inconclusive",
        reason: item.reason,
      });
      await expect(manuallyVerifyPayment("pay-1")).resolves.toEqual({
        success: item.success,
        paid: false,
        outcome: "inconclusive",
        message: item.message,
      });
    }
  });

  it("logs lookup failures and still closes the wallet client", async () => {
    prismaMock.payment.findUnique.mockResolvedValue(payment());
    incoming.lookupIncomingInvoice.mockRejectedValueOnce(
      new Error("socket down")
    );
    await expect(manuallyVerifyPayment("pay-1")).resolves.toEqual({
      success: false,
      paid: false,
      outcome: "inconclusive",
      message: "Failed to verify payment",
    });
    expect(loggedError().message).toBe("socket down");
    expect(logger.logError.mock.calls[0]?.[1]).toEqual({
      paymentId: "pay-1",
      ownerRelays: ["wss://relay.example"],
      message: "Failed to verify payment via lookup_invoice",
    });
    expect(nwcState.close).toHaveBeenCalledTimes(1);

    logger.logError.mockClear();
    incoming.lookupIncomingInvoice.mockRejectedValueOnce("lookup string");
    nwcState.close.mockImplementationOnce(() => {
      throw new Error("close failed");
    });
    await expect(manuallyVerifyPayment("pay-1")).resolves.toEqual({
      success: false,
      paid: false,
      outcome: "inconclusive",
      message: "Failed to verify payment",
    });
    expect(loggedError().message).toBe("lookup string");

    incoming.lookupIncomingInvoice.mockResolvedValueOnce({ kind: "unpaid" });
    nwcState.close.mockImplementationOnce(() => {
      throw "close string";
    });
    await expect(manuallyVerifyPayment("pay-1")).resolves.toMatchObject({
      outcome: "unpaid",
      success: true,
    });
  });

  it("uses NWC when a BTCPay method has no invoice id", async () => {
    prismaMock.payment.findUnique.mockResolvedValue(
      payment({
        billingPaymentMethod: "btc_btcpay_onchain",
        btcpayInvoiceId: null,
      })
    );
    incoming.lookupIncomingInvoice.mockResolvedValue({ kind: "unpaid" });
    await expect(manuallyVerifyPayment("pay-1")).resolves.toMatchObject({
      outcome: "unpaid",
    });
    expect(btcpay.btcpayGetInvoiceSnapshot).not.toHaveBeenCalled();
    expect(incoming.lookupIncomingInvoice).toHaveBeenCalledTimes(1);
  });
});
