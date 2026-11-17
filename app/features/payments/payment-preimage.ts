import { createHash, timingSafeEqual } from "node:crypto";

const HEX_32 = /^[0-9a-fA-F]{64}$/;

export function normalizePaymentHex(value: unknown): string | null {
  if (typeof value !== "string" || !HEX_32.test(value.trim())) return null;
  return value.trim().toLowerCase();
}

/** SHA-256 of the 32-byte preimage, or null when the preimage is not 32 bytes. */
export function paymentHashOfPreimage(preimageHex: string): string | null {
  const normalized = normalizePaymentHex(preimageHex);
  if (!normalized) return null;
  return createHash("sha256")
    .update(Buffer.from(normalized, "hex"))
    .digest("hex");
}

export function preimageMatchesPaymentHash(
  preimageHex: string,
  paymentHashHex: string
): boolean {
  const digest = paymentHashOfPreimage(preimageHex);
  const expected = normalizePaymentHex(paymentHashHex);
  if (!digest || !expected) return false;
  return timingSafeEqual(
    Buffer.from(digest, "hex"),
    Buffer.from(expected, "hex")
  );
}

/**
 * Returns the preimage only when it is 32 bytes and hashes to `paymentHashHex`.
 * A long unrelated string is not a preimage.
 */
export function verifiedPreimage(
  preimage: unknown,
  paymentHashHex: string
): string | null {
  if (typeof preimage !== "string") return null;
  const normalized = normalizePaymentHex(preimage);
  if (!normalized) return null;
  if (!preimageMatchesPaymentHash(normalized, paymentHashHex)) return null;
  return normalized;
}
