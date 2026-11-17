import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  interpretIncomingInvoiceLookup,
  lookupIncomingInvoice,
} from "~/features/payments/incoming-nwc-lookup";

const PREIMAGE = "ab".repeat(32);
const HASH = createHash("sha256")
  .update(Buffer.from(PREIMAGE, "hex"))
  .digest("hex");

function lookup(raw: unknown) {
  return interpretIncomingInvoiceLookup({
    raw,
    expectedPaymentHash: HASH,
    expectedAmountSats: 100,
  });
}

describe("incoming NWC invoice lookup", () => {
  it("confirms a settled invoice that includes a matching preimage", () => {
    expect(
      lookup({
        state: "settled",
        amount: 100_000,
        preimage: PREIMAGE,
        payment_hash: HASH,
        settled_at: 5,
      })
    ).toEqual({ kind: "settled", preimage: PREIMAGE });
  });

  it("confirms a settled invoice when the wallet does not return a preimage", () => {
    expect(
      lookup({
        state: "settled",
        amount: 100_000,
        payment_hash: HASH.toUpperCase(),
      })
    ).toEqual({ kind: "settled", preimage: null });
  });

  it("confirms settlement when the amount field is omitted", () => {
    expect(lookup({ state: "settled", payment_hash: HASH })).toEqual({
      kind: "settled",
      preimage: null,
    });
  });

  it("rejects a mismatched payment hash", () => {
    expect(
      lookup({
        state: "settled",
        amount: 100_000,
        payment_hash: "22".repeat(32),
        preimage: PREIMAGE,
      }).kind
    ).toBe("inconclusive");
  });

  it("rejects an amount one sat above or below the stored invoice", () => {
    expect(lookup({ state: "settled", amount: 101_000 }).kind).toBe(
      "inconclusive"
    );
    expect(lookup({ state: "settled", amount: 99_000 }).kind).toBe(
      "inconclusive"
    );
  });

  it("rejects a fractional millisatoshi amount", () => {
    expect(lookup({ state: "settled", amount: 100_500 }).kind).toBe(
      "inconclusive"
    );
  });

  it("rejects a preimage that does not hash to the invoice", () => {
    expect(
      lookup({
        state: "settled",
        amount: 100_000,
        preimage: "cd".repeat(32),
      })
    ).toEqual({ kind: "inconclusive", reason: "preimage_mismatch" });
  });

  it("rejects contradictory failed and settled evidence", () => {
    expect(
      lookup({
        state: "failed",
        settled_at: 5,
        amount: 100_000,
      }).kind
    ).toBe("inconclusive");
    expect(
      lookup({
        state: "failed",
        preimage: PREIMAGE,
        amount: 100_000,
      }).kind
    ).toBe("inconclusive");
  });

  it("treats a clean failed lookup as unpaid and a pending lookup as inconclusive", () => {
    expect(lookup({ state: "failed", amount: 100_000 })).toEqual({
      kind: "unpaid",
    });
    expect(lookup({ state: "pending", amount: 100_000 })).toEqual({
      kind: "inconclusive",
      reason: "not_settled",
    });
  });

  it("rejects a malformed response", () => {
    expect(lookup(null)).toEqual({
      kind: "inconclusive",
      reason: "malformed_response",
    });
    expect(lookup("settled")).toEqual({
      kind: "inconclusive",
      reason: "malformed_response",
    });
  });

  it("returns the same verdict when the same response is checked twice", () => {
    const raw = { state: "settled", amount: 100_000, preimage: PREIMAGE };
    expect(lookup(raw)).toEqual(lookup(raw));
  });

  it("stops waiting when lookup hangs", async () => {
    const started = Date.now();
    const verdict = await lookupIncomingInvoice({
      lookup: () => new Promise(() => undefined),
      paymentHash: HASH,
      expectedAmountSats: 100,
      timeoutMs: 30,
    });
    expect(Date.now() - started).toBeLessThan(500);
    expect(verdict).toEqual({
      kind: "inconclusive",
      reason: "lookup_timeout",
    });
  });

  it("does not change a timeout verdict when the lookup resolves afterwards", async () => {
    let finish: (value: unknown) => void = () => undefined;
    const verdict = await lookupIncomingInvoice({
      lookup: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      paymentHash: HASH,
      expectedAmountSats: 100,
      timeoutMs: 20,
    });
    finish({
      state: "settled",
      amount: 100_000,
      preimage: PREIMAGE,
      payment_hash: HASH,
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(verdict).toEqual({
      kind: "inconclusive",
      reason: "lookup_timeout",
    });
  });
});
