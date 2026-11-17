import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { FIXTURE_NOW_MS, invoiceForSats } from "../helpers/bolt11-fixture";

import {
  classifyNwcPayFailure,
  interpretNwcLookup,
  payAuthorizedBolt11,
  type AuthorizedNwcClient,
} from "~/features/payments/nwc-authorized-pay.server";

const PREIMAGE = "ab".repeat(32);
const HASH = createHash("sha256")
  .update(Buffer.from(PREIMAGE, "hex"))
  .digest("hex");

function client(partial: Partial<AuthorizedNwcClient>): AuthorizedNwcClient {
  return {
    payInvoice: vi.fn(),
    close: vi.fn(),
    ...partial,
  };
}

describe("NWC payout outcome", () => {
  it("treats a structured wallet rejection code as safe to record as failed", () => {
    const error = new Error("insufficient balance");
    Object.assign(error, { code: "INSUFFICIENT_BALANCE" });
    expect(classifyNwcPayFailure(error).disposition).toBe("rejected");
  });

  it("does not treat the words payment failed as proof nothing was sent", () => {
    expect(classifyNwcPayFailure(new Error("payment failed")).disposition).toBe(
      "unknown"
    );
    const coded = new Error("payment failed");
    Object.assign(coded, { code: "PAYMENT_FAILED" });
    expect(classifyNwcPayFailure(coded).disposition).toBe("unknown");
    expect(
      classifyNwcPayFailure(new Error("insufficient balance")).disposition
    ).toBe("unknown");
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
        125,
        HASH
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
        125,
        HASH
      ).kind
    ).toBe("inconclusive");
    expect(interpretNwcLookup({ state: "failed" }, 125, HASH).kind).toBe(
      "failed"
    );
    expect(interpretNwcLookup(undefined, 125, HASH).kind).toBe("inconclusive");
    expect(
      interpretNwcLookup(
        {
          state: "settled",
          amount: 125_000,
          preimage: "cd".repeat(32),
          payment_hash: HASH,
        },
        125,
        HASH
      ).kind
    ).toBe("inconclusive");
    expect(
      interpretNwcLookup(
        {
          state: "settled",
          amount: 125_000,
          preimage: PREIMAGE,
          payment_hash: "22".repeat(32),
        },
        125,
        HASH
      ).kind
    ).toBe("inconclusive");
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

  it("returns unknown when payment and lookup both stay unresolved", async () => {
    const payInvoice = vi.fn(() => new Promise(() => undefined));
    const lookupInvoice = vi.fn(() => new Promise(() => undefined));
    const started = Date.now();
    const result = await payAuthorizedBolt11({
      nwcUrl: "nostr+walletconnect://test",
      invoice: invoiceForSats(100, HASH),
      authorizedSats: 100,
      timeoutMs: 20,
      reconcileTimeoutMs: 30,
      nowMs: FIXTURE_NOW_MS,
      clientFactory: () =>
        client({
          payInvoice,
          lookupInvoice,
          getInfo: async () => ({ methods: ["lookup_invoice"] }),
        }),
    });
    expect(Date.now() - started).toBeLessThan(500);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.disposition).toBe("unknown");
    expect(["reconciliation_timeout", "reconciliation_required"]).toContain(
      result.code
    );
    expect(payInvoice).toHaveBeenCalledTimes(1);
  });

  it("returns unknown when get_info hangs and does not call lookup", async () => {
    const payInvoice = vi.fn(() => new Promise(() => undefined));
    const lookupInvoice = vi.fn(async () => ({
      state: "settled",
      amount: 100_000,
      preimage: PREIMAGE,
    }));
    const result = await payAuthorizedBolt11({
      nwcUrl: "nostr+walletconnect://test",
      invoice: invoiceForSats(100, HASH),
      authorizedSats: 100,
      timeoutMs: 15,
      reconcileTimeoutMs: 25,
      nowMs: FIXTURE_NOW_MS,
      clientFactory: () =>
        client({
          payInvoice,
          lookupInvoice,
          getInfo: () => new Promise(() => undefined),
        }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.disposition).toBe("unknown");
    expect(lookupInvoice).not.toHaveBeenCalled();
  });

  it("confirms a lookup that settles before the reconciliation deadline", async () => {
    const payInvoice = vi.fn(() => new Promise(() => undefined));
    const result = await payAuthorizedBolt11({
      nwcUrl: "nostr+walletconnect://test",
      invoice: invoiceForSats(100, HASH),
      authorizedSats: 100,
      timeoutMs: 15,
      reconcileTimeoutMs: 200,
      nowMs: FIXTURE_NOW_MS,
      clientFactory: () =>
        client({
          payInvoice,
          lookupInvoice: async () => ({
            state: "settled",
            amount: 100_000,
            preimage: PREIMAGE,
            settled_at: 4,
          }),
          getInfo: async () => ({ methods: ["lookup_invoice"] }),
        }),
    });
    expect(result).toMatchObject({ ok: true, preimage: PREIMAGE });
  });

  it("ignores a wallet response that arrives after the deadline", async () => {
    let finish: (value: { preimage: string }) => void = () => undefined;
    const payInvoice = vi.fn(
      () =>
        new Promise<{ preimage: string }>((resolve) => {
          finish = resolve;
        })
    );
    const result = await payAuthorizedBolt11({
      nwcUrl: "nostr+walletconnect://test",
      invoice: invoiceForSats(100, HASH),
      authorizedSats: 100,
      timeoutMs: 15,
      reconcileTimeoutMs: 20,
      nowMs: FIXTURE_NOW_MS,
      clientFactory: () =>
        client({
          payInvoice,
          lookupInvoice: () => new Promise(() => undefined),
          getInfo: async () => ({ methods: ["lookup_invoice"] }),
        }),
    });
    expect(result.ok).toBe(false);
    finish({ preimage: PREIMAGE });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(payInvoice).toHaveBeenCalledTimes(1);
  });

  it("stays unknown when the wallet reconnect for lookup fails", async () => {
    const payInvoice = vi.fn(() => new Promise(() => undefined));
    const result = await payAuthorizedBolt11({
      nwcUrl: "nostr+walletconnect://test",
      invoice: invoiceForSats(100, HASH),
      authorizedSats: 100,
      timeoutMs: 15,
      reconcileTimeoutMs: 40,
      nowMs: FIXTURE_NOW_MS,
      clientFactory: () =>
        client({
          payInvoice,
          getInfo: async () => {
            throw new Error("socket closed");
          },
          lookupInvoice: async () => ({
            state: "settled",
            amount: 100_000,
            preimage: PREIMAGE,
          }),
        }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.disposition).toBe("unknown");
    expect(payInvoice).toHaveBeenCalledTimes(1);
  });

  it("does not pay when the wallet client cannot be opened", async () => {
    const result = await payAuthorizedBolt11({
      nwcUrl: "nostr+walletconnect://test",
      invoice: invoiceForSats(100, HASH),
      authorizedSats: 100,
      timeoutMs: 20,
      nowMs: FIXTURE_NOW_MS,
      clientFactory: () => {
        throw new Error("reconnect failed");
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("wallet_unavailable");
  });

  it("does not confirm an unrelated preimage and can pay a later invoice", async () => {
    const wrong = vi.fn(async () => ({ preimage: "cd".repeat(40) }));
    const first = await payAuthorizedBolt11({
      nwcUrl: "nostr+walletconnect://test",
      invoice: invoiceForSats(100, HASH),
      authorizedSats: 100,
      timeoutMs: 50,
      reconcileTimeoutMs: 20,
      nowMs: FIXTURE_NOW_MS,
      clientFactory: () => client({ payInvoice: wrong }),
    });
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.disposition).toBe("unknown");
    expect(wrong).toHaveBeenCalledTimes(1);

    const right = vi.fn(async () => ({ preimage: PREIMAGE }));
    const second = await payAuthorizedBolt11({
      nwcUrl: "nostr+walletconnect://test",
      invoice: invoiceForSats(100, HASH),
      authorizedSats: 100,
      timeoutMs: 50,
      nowMs: FIXTURE_NOW_MS,
      clientFactory: () => client({ payInvoice: right }),
    });
    expect(second).toMatchObject({ ok: true, preimage: PREIMAGE });
  });
});
