import { describe, expect, it, vi } from "vitest";

import { FIXTURE_NOW_MS, invoiceForSats } from "../helpers/bolt11-fixture";

import {
  classifyNwcPayFailure,
  interpretNwcLookup,
  payAuthorizedBolt11,
  type AuthorizedNwcClient,
} from "~/features/payments/nwc-authorized-pay.server";

const HASH = "11".repeat(32);
const PREIMAGE = "ab".repeat(32);

function client(partial: Partial<AuthorizedNwcClient>): AuthorizedNwcClient {
  return {
    payInvoice: vi.fn(),
    close: vi.fn(),
    ...partial,
  };
}

describe("NWC payout outcome", () => {
  it("treats a wallet rejection code as safe to record as failed", () => {
    const error = new Error("insufficient balance");
    Object.assign(error, { code: "INSUFFICIENT_BALANCE" });
    expect(classifyNwcPayFailure(error).disposition).toBe("rejected");
  });

  it("treats a timeout as unknown", () => {
    expect(
      classifyNwcPayFailure(new Error("NWC payInvoice timeout")).disposition
    ).toBe("unknown");
  });

  it("accepts a settled lookup only when the millisatoshi amount matches", () => {
    expect(
      interpretNwcLookup(
        {
          state: "settled",
          amount: 125_000,
          preimage: PREIMAGE,
          settled_at: 5,
        },
        125
      )
    ).toEqual({ kind: "settled", preimage: PREIMAGE });
    expect(
      interpretNwcLookup(
        {
          state: "settled",
          amount: 126_000,
          preimage: PREIMAGE,
          settled_at: 5,
        },
        125
      ).kind
    ).toBe("inconclusive");
    expect(interpretNwcLookup({ state: "failed" }, 125).kind).toBe("failed");
    expect(interpretNwcLookup(undefined, 125).kind).toBe("inconclusive");
  });

  it("does not call the wallet when the invoice amount is wrong", async () => {
    const payInvoice = vi.fn();
    const result = await payAuthorizedBolt11({
      nwcUrl: "nostr+walletconnect://test",
      invoice: invoiceForSats(101),
      authorizedSats: 100,
      timeoutMs: 50,
      nowMs: FIXTURE_NOW_MS,
      clientFactory: () => client({ payInvoice }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invoice_rejected");
    expect(payInvoice).not.toHaveBeenCalled();
  });

  it("pays a matching invoice and returns the preimage", async () => {
    const payInvoice = vi.fn(async () => ({ preimage: PREIMAGE }));
    const result = await payAuthorizedBolt11({
      nwcUrl: "nostr+walletconnect://test",
      invoice: invoiceForSats(100, HASH),
      authorizedSats: 100,
      timeoutMs: 50,
      nowMs: FIXTURE_NOW_MS,
      clientFactory: () => client({ payInvoice }),
    });
    expect(result).toMatchObject({
      ok: true,
      preimage: PREIMAGE,
      paymentHash: HASH,
      amountSats: 100,
    });
    expect(payInvoice).toHaveBeenCalledTimes(1);
  });

  it("does not treat a timeout as a definitive failure", async () => {
    const payInvoice = vi.fn(() => new Promise(() => undefined));
    const lookupInvoice = vi.fn(async () => ({
      state: "pending",
      amount: 100_000,
    }));
    const result = await payAuthorizedBolt11({
      nwcUrl: "nostr+walletconnect://test",
      invoice: invoiceForSats(100, HASH),
      authorizedSats: 100,
      timeoutMs: 20,
      nowMs: FIXTURE_NOW_MS,
      clientFactory: () =>
        client({
          payInvoice,
          lookupInvoice,
          getInfo: async () => ({ methods: ["pay_invoice", "lookup_invoice"] }),
        }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.disposition).toBe("unknown");
    expect(payInvoice).toHaveBeenCalledTimes(1);
    expect(lookupInvoice).toHaveBeenCalledWith({ payment_hash: HASH });
  });

  it("marks the payout paid when lookup shows the timed-out payment settled", async () => {
    const payInvoice = vi.fn(() => new Promise(() => undefined));
    const lookupInvoice = vi.fn(async () => ({
      state: "settled",
      amount: 100_000,
      preimage: PREIMAGE,
      settled_at: 9,
    }));
    const result = await payAuthorizedBolt11({
      nwcUrl: "nostr+walletconnect://test",
      invoice: invoiceForSats(100, HASH),
      authorizedSats: 100,
      timeoutMs: 20,
      nowMs: FIXTURE_NOW_MS,
      clientFactory: () =>
        client({
          payInvoice,
          lookupInvoice,
          getInfo: async () => ({ methods: ["lookup_invoice"] }),
        }),
    });
    expect(result).toMatchObject({ ok: true, preimage: PREIMAGE });
    expect(payInvoice).toHaveBeenCalledTimes(1);
  });

  it("keeps the payout unknown when lookup is not available", async () => {
    const payInvoice = vi.fn(() => new Promise(() => undefined));
    const result = await payAuthorizedBolt11({
      nwcUrl: "nostr+walletconnect://test",
      invoice: invoiceForSats(100, HASH),
      authorizedSats: 100,
      timeoutMs: 20,
      nowMs: FIXTURE_NOW_MS,
      clientFactory: () =>
        client({
          payInvoice,
          getInfo: async () => ({ methods: ["pay_invoice"] }),
        }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.disposition).toBe("unknown");
  });
});
