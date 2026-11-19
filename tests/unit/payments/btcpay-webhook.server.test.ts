import { beforeEach, describe, expect, it, vi } from "vitest";

const btcpay = vi.hoisted(() => ({
  btcpayGetInvoiceSnapshot: vi.fn(),
}));
const payments = vi.hoisted(() => ({
  handlePaymentCompleted: vi.fn(),
}));
const logger = vi.hoisted(() => ({
  logError: vi.fn(),
}));
const prismaMock = vi.hoisted(() => ({
  payment: {
    findFirst: vi.fn(),
    updateMany: vi.fn(
      (_args: {
        where: { btcpayInvoiceId: string; status: string };
        data: { status: string; failureReason: string; failedAt: Date };
      }): Promise<{ count: number }> => Promise.resolve({ count: 1 })
    ),
  },
}));

vi.mock("~/features/payments/btcpay.server", () => ({
  BTCPAY_MIN_ONCHAIN_CONFIRMS_FOR_ACCESS: 1,
  btcpayGetInvoiceSnapshot: btcpay.btcpayGetInvoiceSnapshot,
}));
vi.mock("~/features/payments/data/payment.handlers.server", () => payments);
vi.mock("~/lib/error-logger.server", () => logger);
vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));

import {
  processBtcpayWebhookPayload,
  settleSubscriptionFromBtcpayInvoiceId,
} from "~/features/payments/data/btcpay-webhook.server";

function confirmedSnapshot(confirmations = 1) {
  return {
    maxOnChainConfirmations: confirmations,
    hasOnChainPaymentStarted: true,
  };
}

describe("BTCPay webhook settlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });
  });

  it("ignores payloads without an invoice id", async () => {
    await processBtcpayWebhookPayload(null);
    await processBtcpayWebhookPayload("nope");
    await processBtcpayWebhookPayload({ type: "InvoiceSettled" });
    await processBtcpayWebhookPayload({ type: 1, invoiceId: 2 });
    expect(btcpay.btcpayGetInvoiceSnapshot).not.toHaveBeenCalled();
  });

  it("reads the invoice id from the nested data object", async () => {
    btcpay.btcpayGetInvoiceSnapshot.mockResolvedValueOnce(confirmedSnapshot(0));
    await processBtcpayWebhookPayload({
      type: "InvoiceSettled",
      data: { id: "inv-nested" },
    });
    expect(btcpay.btcpayGetInvoiceSnapshot).toHaveBeenCalledWith("inv-nested");
  });

  it("returns before settlement when the snapshot is unconfirmed or missing", async () => {
    btcpay.btcpayGetInvoiceSnapshot.mockRejectedValueOnce(new Error("down"));
    await settleSubscriptionFromBtcpayInvoiceId("inv-1");
    btcpay.btcpayGetInvoiceSnapshot.mockRejectedValueOnce("down");
    await settleSubscriptionFromBtcpayInvoiceId("inv-1");
    btcpay.btcpayGetInvoiceSnapshot.mockResolvedValueOnce({
      maxOnChainConfirmations: 0,
      hasOnChainPaymentStarted: true,
    });
    await settleSubscriptionFromBtcpayInvoiceId("inv-1");
    btcpay.btcpayGetInvoiceSnapshot.mockResolvedValueOnce({
      maxOnChainConfirmations: 2,
      hasOnChainPaymentStarted: false,
    });
    await settleSubscriptionFromBtcpayInvoiceId("inv-1");
    expect(prismaMock.payment.findFirst).not.toHaveBeenCalled();
    expect(logger.logError).toHaveBeenCalledTimes(2);
  });

  it("settles historical and current plan ids and logs unusable payment ids", async () => {
    btcpay.btcpayGetInvoiceSnapshot.mockResolvedValue(confirmedSnapshot());
    prismaMock.payment.findFirst.mockResolvedValueOnce(null);
    await settleSubscriptionFromBtcpayInvoiceId("inv-missing");
    expect(payments.handlePaymentCompleted).not.toHaveBeenCalled();

    prismaMock.payment.findFirst.mockResolvedValueOnce({
      id: "_",
      userId: "user-1",
    });
    await settleSubscriptionFromBtcpayInvoiceId("inv-blank");
    expect(logger.logError).toHaveBeenCalled();

    prismaMock.payment.findFirst.mockResolvedValueOnce({
      id: "nope_payment",
      userId: "user-1",
    });
    await settleSubscriptionFromBtcpayInvoiceId("inv-bad-plan");

    for (const [paymentId, planId] of [
      ["creator_1", "creator"],
      ["basic_1", "creator"],
      ["premium_1", "pro"],
      ["enterprise_1", "teams"],
      [" founder_1", "founder"],
    ] as const) {
      prismaMock.payment.findFirst.mockResolvedValueOnce({
        id: paymentId,
        userId: "user-1",
      });
      await settleSubscriptionFromBtcpayInvoiceId("inv-ok");
      expect(payments.handlePaymentCompleted).toHaveBeenCalledWith(
        paymentId,
        "user-1",
        planId
      );
    }
  });

  it("expires pending payments for expired and invalid invoices", async () => {
    await processBtcpayWebhookPayload({
      type: "InvoiceExpired",
      invoiceId: "inv-exp",
    });
    await processBtcpayWebhookPayload({
      type: "InvoiceInvalid",
      invoiceId: "inv-bad",
    });
    await processBtcpayWebhookPayload({
      type: "InvoiceProcessing",
      invoiceId: "inv-wait",
    });

    const reasons = prismaMock.payment.updateMany.mock.calls.map(
      (call) => call[0].data.failureReason
    );
    expect(reasons).toEqual([
      "BTCPay invoice expired",
      "BTCPay invoice invalid",
    ]);
    expect(
      prismaMock.payment.updateMany.mock.calls[0]?.[0].where.btcpayInvoiceId
    ).toBe("inv-exp");
    expect(btcpay.btcpayGetInvoiceSnapshot).not.toHaveBeenCalled();
  });
});
