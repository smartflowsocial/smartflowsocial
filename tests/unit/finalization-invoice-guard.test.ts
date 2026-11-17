import { describe, expect, it } from "vitest";

import {
  FIXTURE_NOW_MS,
  invoiceForSats,
  makeBolt11,
} from "../helpers/bolt11-fixture";

import {
  acceptFinalizationWalletInvoice,
  singleFlight,
} from "~/features/payments/finalization-invoice-guard";

const HASH = "11".repeat(32);
const NOW = FIXTURE_NOW_MS;

function request(args: {
  invoice: string;
  paymentHash?: string;
  amount?: number;
  satoshi?: number;
}) {
  return {
    invoice: args.invoice,
    ...(args.paymentHash !== undefined
      ? { paymentHash: args.paymentHash }
      : {}),
    ...(args.amount !== undefined ? { amount: args.amount } : {}),
    ...(args.satoshi !== undefined ? { satoshi: args.satoshi } : {}),
  };
}

describe("finalization BOLT11 invoices", () => {
  it("accepts an invoice whose encoded amount is the authorized fee", () => {
    const accepted = acceptFinalizationWalletInvoice({
      request: request({
        invoice: invoiceForSats(100, HASH),
        paymentHash: HASH,
        amount: 100,
      }),
      authorizedSats: 100,
      nowMs: NOW,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.amountSats).toBe(100);
    expect(accepted.paymentHash).toBe(HASH);
  });

  it("accepts a matching invoice when the wallet omits its amount metadata", () => {
    expect(
      acceptFinalizationWalletInvoice({
        request: request({
          invoice: invoiceForSats(100, HASH),
          paymentHash: HASH,
        }),
        authorizedSats: 100,
        nowMs: NOW,
      }).ok
    ).toBe(true);
  });

  it("rejects an invoice one sat above the authorized fee", () => {
    const accepted = acceptFinalizationWalletInvoice({
      request: request({
        invoice: invoiceForSats(101, HASH),
        paymentHash: HASH,
        amount: 101,
      }),
      authorizedSats: 100,
      nowMs: NOW,
    });
    expect(accepted.ok).toBe(false);
  });

  it("rejects an invoice one sat below the authorized fee", () => {
    const accepted = acceptFinalizationWalletInvoice({
      request: request({
        invoice: invoiceForSats(99, HASH),
        paymentHash: HASH,
        amount: 99,
      }),
      authorizedSats: 100,
      nowMs: NOW,
    });
    expect(accepted.ok).toBe(false);
  });

  it("rejects an amountless invoice", () => {
    const accepted = acceptFinalizationWalletInvoice({
      request: request({
        invoice: makeBolt11({ amountSats: null, paymentHashHex: HASH }),
        paymentHash: HASH,
      }),
      authorizedSats: 100,
      nowMs: NOW,
    });
    expect(accepted.ok).toBe(false);
  });

  it("rejects a fractional-satoshi invoice instead of rounding it", () => {
    const accepted = acceptFinalizationWalletInvoice({
      request: request({
        invoice: makeBolt11({ millisats: 100_500n, paymentHashHex: HASH }),
        paymentHash: HASH,
      }),
      authorizedSats: 100,
      nowMs: NOW,
    });
    expect(accepted.ok).toBe(false);
  });

  it("rejects a wallet payment hash that is not the invoice hash", () => {
    const accepted = acceptFinalizationWalletInvoice({
      request: request({
        invoice: invoiceForSats(100, HASH),
        paymentHash: "22".repeat(32),
        amount: 100,
      }),
      authorizedSats: 100,
      nowMs: NOW,
    });
    expect(accepted.ok).toBe(false);
    if (accepted.ok) return;
    expect(accepted.error).toMatch(/payment hash/i);
  });

  it("rejects a testnet invoice", () => {
    const accepted = acceptFinalizationWalletInvoice({
      request: request({
        invoice: makeBolt11({
          amountSats: 100,
          paymentHashHex: HASH,
          network: "tb",
        }),
        paymentHash: HASH,
        amount: 100,
      }),
      authorizedSats: 100,
      nowMs: NOW,
    });
    expect(accepted.ok).toBe(false);
  });

  it("rejects an expired invoice", () => {
    const accepted = acceptFinalizationWalletInvoice({
      request: request({
        invoice: makeBolt11({
          amountSats: 100,
          paymentHashHex: HASH,
          timestampSeconds: 1_600_000_000,
          expirySeconds: 60,
        }),
        paymentHash: HASH,
        amount: 100,
      }),
      authorizedSats: 100,
      nowMs: NOW,
    });
    expect(accepted.ok).toBe(false);
  });

  it("rejects a malformed invoice", () => {
    const accepted = acceptFinalizationWalletInvoice({
      request: request({
        invoice: "not-an-invoice",
        paymentHash: HASH,
        amount: 100,
      }),
      authorizedSats: 100,
      nowMs: NOW,
    });
    expect(accepted.ok).toBe(false);
  });

  it("rejects wallet metadata that disagrees with the encoded amount", () => {
    const accepted = acceptFinalizationWalletInvoice({
      request: request({
        invoice: invoiceForSats(100, HASH),
        paymentHash: HASH,
        amount: 101,
      }),
      authorizedSats: 100,
      nowMs: NOW,
    });
    expect(accepted.ok).toBe(false);
    if (accepted.ok) return;
    expect(accepted.error).toMatch(/amount/i);
  });

  it("rejects fractional wallet metadata", () => {
    const accepted = acceptFinalizationWalletInvoice({
      request: {
        invoice: invoiceForSats(100, HASH),
        paymentHash: HASH,
        amount: 100.4,
      },
      authorizedSats: 100,
      nowMs: NOW,
    });
    expect(accepted.ok).toBe(false);
  });

  it("lets only one of two concurrent creates for the same configuration call the wallet", async () => {
    let calls = 0;
    const run = () =>
      singleFlight("contest:same-config", async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { invoice: "one" };
      });
    const [first, second] = await Promise.all([run(), run()]);
    expect(calls).toBe(1);
    expect(first).toEqual(second);
  });
});
