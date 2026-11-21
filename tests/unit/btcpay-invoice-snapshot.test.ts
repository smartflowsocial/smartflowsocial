import { describe, expect, it } from "vitest";

import {
  BTCPAY_MIN_ONCHAIN_CONFIRMS_FOR_ACCESS,
  parseBtcpayInvoiceOnChainSnapshot,
} from "~/features/payments/btcpay.server";

describe("parseBtcpayInvoiceOnChainSnapshot", () => {
  it("returns no on-chain activity for empty payments", () => {
    expect(
      parseBtcpayInvoiceOnChainSnapshot({
        status: "New",
        payments: [],
      })
    ).toEqual({
      invoiceStatus: "New",
      maxOnChainConfirmations: 0,
      hasOnChainPaymentStarted: false,
    });
  });

  it("detects 0-conf on-chain payment", () => {
    const snap = parseBtcpayInvoiceOnChainSnapshot({
      status: "Processing",
      payments: [
        {
          paymentMethodId: "BTC-OnChain",
          confirmations: 0,
          status: "Processing",
        },
      ],
    });
    expect(snap.hasOnChainPaymentStarted).toBe(true);
    expect(snap.maxOnChainConfirmations).toBe(0);
    expect(snap.invoiceStatus).toBe("Processing");
    expect(
      snap.maxOnChainConfirmations < BTCPAY_MIN_ONCHAIN_CONFIRMS_FOR_ACCESS
    ).toBe(true);
  });

  it("reads max confirmations across on-chain rows", () => {
    const snap = parseBtcpayInvoiceOnChainSnapshot({
      status: "Settled",
      payments: [
        { paymentMethodId: "BTC-OnChain", confirmations: 1 },
        { paymentMethodId: "BTC-OnChain", confirmations: 0 },
      ],
    });
    expect(snap.maxOnChainConfirmations).toBe(1);
    expect(snap.hasOnChainPaymentStarted).toBe(true);
  });

  it("ignores Lightning rows on an invoice that is still unpaid", () => {
    const snap = parseBtcpayInvoiceOnChainSnapshot({
      status: "New",
      payments: [
        {
          paymentMethodId: "BTC-LNURLPay",
          confirmations: 0,
        },
      ],
    });
    expect(snap.hasOnChainPaymentStarted).toBe(false);
    expect(snap.maxOnChainConfirmations).toBe(0);
  });

  it("treats a Settled invoice as confirmed when payments are omitted", () => {
    const snap = parseBtcpayInvoiceOnChainSnapshot({
      status: "Settled",
      additionalStatus: "None",
    });
    expect(snap.hasOnChainPaymentStarted).toBe(true);
    expect(snap.maxOnChainConfirmations).toBe(
      BTCPAY_MIN_ONCHAIN_CONFIRMS_FOR_ACCESS
    );

    const lightningSettled = parseBtcpayInvoiceOnChainSnapshot({
      status: "Settled",
      payments: [{ paymentMethodId: "BTC-LN", status: "Settled" }],
    });
    expect(lightningSettled.hasOnChainPaymentStarted).toBe(true);
    expect(lightningSettled.maxOnChainConfirmations).toBe(
      BTCPAY_MIN_ONCHAIN_CONFIRMS_FOR_ACCESS
    );
  });

  it("treats Processing without a payments list as seen but unconfirmed", () => {
    const snap = parseBtcpayInvoiceOnChainSnapshot({
      status: "Processing",
    });
    expect(snap.hasOnChainPaymentStarted).toBe(true);
    expect(snap.maxOnChainConfirmations).toBe(0);
  });

  it("recognizes BTC-CHAIN and a settled payment row without a confirmation count", () => {
    const processing = parseBtcpayInvoiceOnChainSnapshot({
      status: "Processing",
      paymentMethods: [
        {
          paymentMethodId: "BTC-CHAIN",
          payments: [{ status: "Processing", value: "0.001" }],
        },
      ],
    });
    expect(processing.hasOnChainPaymentStarted).toBe(true);
    expect(processing.maxOnChainConfirmations).toBe(0);

    const settled = parseBtcpayInvoiceOnChainSnapshot({
      status: "Processing",
      payments: [{ paymentMethodId: "BTC-CHAIN", status: "Settled" }],
    });
    expect(settled.hasOnChainPaymentStarted).toBe(true);
    expect(settled.maxOnChainConfirmations).toBe(
      BTCPAY_MIN_ONCHAIN_CONFIRMS_FOR_ACCESS
    );
  });

  it("does not treat a partial Settled invoice as confirmed", () => {
    const snap = parseBtcpayInvoiceOnChainSnapshot({
      status: "Settled",
      additionalStatus: "PaidPartial",
    });
    expect(snap.hasOnChainPaymentStarted).toBe(false);
    expect(snap.maxOnChainConfirmations).toBe(0);
  });

  it("accepts paymentMethod as fallback field name", () => {
    const snap = parseBtcpayInvoiceOnChainSnapshot({
      status: "Processing",
      payments: [{ paymentMethod: "BTC-OnChain", confirmations: 2 }],
    });
    expect(snap.maxOnChainConfirmations).toBe(2);
    expect(snap.hasOnChainPaymentStarted).toBe(true);
  });
});
