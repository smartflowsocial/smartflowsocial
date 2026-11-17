import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  paymentHashOfPreimage,
  preimageMatchesPaymentHash,
  verifiedPreimage,
} from "~/features/payments/payment-preimage";

const PREIMAGE = "ab".repeat(32);
const HASH = createHash("sha256")
  .update(Buffer.from(PREIMAGE, "hex"))
  .digest("hex");

describe("payment preimage", () => {
  it("accepts a 32-byte preimage that hashes to the invoice", () => {
    expect(paymentHashOfPreimage(PREIMAGE)).toBe(HASH);
    expect(preimageMatchesPaymentHash(PREIMAGE.toUpperCase(), HASH)).toBe(true);
    expect(verifiedPreimage(PREIMAGE, HASH)).toBe(PREIMAGE);
  });

  it("rejects a long string that is not the preimage", () => {
    const unrelated = "cd".repeat(32);
    expect(unrelated.length).toBe(64);
    expect(verifiedPreimage(unrelated, HASH)).toBeNull();
    expect(verifiedPreimage("abc123", HASH)).toBeNull();
    expect(verifiedPreimage(PREIMAGE, "11".repeat(32))).toBeNull();
  });
});
