import { amountSatsFromMillisatoshis } from "~/features/referral/bolt11-invoice.server";

import { normalizePaymentHex, verifiedPreimage } from "./payment-preimage";

/**
 * Result of looking up an invoice this application created and is waiting to
 * receive. A missing preimage can still confirm settlement. A present preimage
 * must hash to the expected payment hash. This is not the outgoing payout
 * check: a settled incoming invoice does not need a preimage to be accepted.
 */
/**
 * `preimage` means the wallet returned a preimage that hashes to the invoice.
 * `wallet_reported` means the wallet said the invoice settled and did not return
 * a preimage. NIP-47 does not require a preimage on every lookup. Callers that
 * pay out must not treat `wallet_reported` as proof a payment was sent.
 */
export type IncomingSettlementAssurance = "preimage" | "wallet_reported";

export type IncomingLookupVerdict =
  | {
      kind: "settled";
      assurance: IncomingSettlementAssurance;
      preimage: string | null;
    }
  | { kind: "unpaid" }
  | { kind: "inconclusive"; reason: string };

export function interpretIncomingInvoiceLookup(args: {
  raw: unknown;
  expectedPaymentHash: string;
  expectedAmountSats: number;
}): IncomingLookupVerdict {
  const expectedHash = normalizePaymentHex(args.expectedPaymentHash);
  if (!expectedHash) {
    return { kind: "inconclusive", reason: "stored_hash_invalid" };
  }
  if (
    typeof args.expectedAmountSats !== "number" ||
    !Number.isSafeInteger(args.expectedAmountSats) ||
    args.expectedAmountSats <= 0
  ) {
    return { kind: "inconclusive", reason: "stored_amount_invalid" };
  }
  if (!args.raw || typeof args.raw !== "object" || Array.isArray(args.raw)) {
    return { kind: "inconclusive", reason: "malformed_response" };
  }

  const obj = args.raw as Record<string, unknown>;
  const returnedHash = normalizePaymentHex(obj["payment_hash"]);
  if (obj["payment_hash"] != null && obj["payment_hash"] !== "") {
    if (!returnedHash || returnedHash !== expectedHash) {
      return { kind: "inconclusive", reason: "payment_hash_mismatch" };
    }
  }

  const preimageField = obj["preimage"];
  const preimageProvided =
    typeof preimageField === "string" && preimageField.trim().length > 0;
  const preimage = verifiedPreimage(preimageField, expectedHash);
  if (preimageProvided && !preimage) {
    return { kind: "inconclusive", reason: "preimage_mismatch" };
  }

  const amountProvided = obj["amount"] !== undefined && obj["amount"] !== null;
  let amountMatches = true;
  if (amountProvided) {
    const amount = amountSatsFromMillisatoshis(obj["amount"]);
    amountMatches = amount.ok && amount.amountSats === args.expectedAmountSats;
    if (!amountMatches) {
      return { kind: "inconclusive", reason: "amount_mismatch" };
    }
  }

  const state =
    typeof obj["state"] === "string" ? obj["state"].toLowerCase() : "";
  const settledAt = obj["settled_at"];
  const settledAtMs =
    typeof settledAt === "number" && Number.isFinite(settledAt) && settledAt > 0
      ? settledAt
      : 0;
  const settledAtMalformed =
    settledAt != null &&
    settledAt !== 0 &&
    (typeof settledAt !== "number" ||
      !Number.isFinite(settledAt) ||
      settledAt < 0);
  if (settledAtMalformed) {
    return { kind: "inconclusive", reason: "malformed_settlement" };
  }

  const failed = state === "failed" || state === "expired";
  const settled = state === "settled" || settledAtMs > 0;
  if (failed && (settledAtMs > 0 || preimage !== null)) {
    return { kind: "inconclusive", reason: "contradictory_settlement" };
  }
  if (settled && !failed) {
    return {
      kind: "settled",
      assurance: preimage ? "preimage" : "wallet_reported",
      preimage,
    };
  }
  if (failed && preimage === null && settledAtMs <= 0) {
    return { kind: "unpaid" };
  }
  return { kind: "inconclusive", reason: "not_settled" };
}

/**
 * Bounds one incoming `lookup_invoice`. A lookup that never returns becomes
 * inconclusive when `timeoutMs` elapses. The caller must not wait for it again.
 */
export async function lookupIncomingInvoice(args: {
  lookup: (paymentHash: string) => Promise<unknown>;
  paymentHash: string;
  expectedAmountSats: number;
  timeoutMs: number;
}): Promise<IncomingLookupVerdict> {
  const timeoutMs = Number.isFinite(args.timeoutMs)
    ? Math.max(0, args.timeoutMs)
    : 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let work: Promise<unknown>;
  try {
    work = args.lookup(args.paymentHash);
  } catch {
    return { kind: "inconclusive", reason: "lookup_failed" };
  }
  const ignoreLateResult = async (): Promise<void> => {
    try {
      await work;
    } catch {
      // The race below owns this lookup. A late rejection is ignored.
    }
  };
  void ignoreLateResult();
  try {
    const raw = await Promise.race([
      work,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      }),
    ]);
    if (raw === "timeout") {
      return { kind: "inconclusive", reason: "lookup_timeout" };
    }
    return interpretIncomingInvoiceLookup({
      raw,
      expectedPaymentHash: args.paymentHash,
      expectedAmountSats: args.expectedAmountSats,
    });
  } catch {
    return { kind: "inconclusive", reason: "lookup_failed" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
