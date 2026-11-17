/**
 * Decides what a campaign finalization may collect.
 * Paid rows are never rewritten. An outstanding invoice is not raised.
 * A higher outstanding invoice is not the amount due after the rate drops.
 */

export interface FinalizationFeeQuote {
  plannedPayoutSats: number;
  feeRateBps: number;
  feeSats: number;
  waivedByPlan: boolean;
  lockConfigHash: string;
}

export interface StoredFinalizationRecord {
  id: string;
  status: "PENDING" | "PAID" | "EXPIRED" | "FAILED";
  feeRateBps: number;
  feeSats: number;
  lockConfigHash: string;
  paymentId: string | null;
  paymentStatus:
    | "PENDING"
    | "COMPLETED"
    | "EXPIRED"
    | "FAILED"
    | "CANCELED"
    | null;
  paymentExpiresAtMs: number | null;
}

export type FinalizationCollection =
  | { kind: "waived"; quote: FinalizationFeeQuote; expireIds: string[] }
  | {
      kind: "settled";
      quote: FinalizationFeeQuote;
      paymentId: string | null;
    }
  | {
      kind: "honor_pending";
      quote: FinalizationFeeQuote;
      paymentId: string;
      recordId: string;
    }
  | {
      kind: "collect";
      quote: FinalizationFeeQuote;
      expireIds: string[];
    };

function quoteFromRecord(
  current: FinalizationFeeQuote,
  record: StoredFinalizationRecord
): FinalizationFeeQuote {
  return {
    ...current,
    feeRateBps: record.feeRateBps,
    feeSats: record.feeSats,
    waivedByPlan: record.feeSats === 0 && current.plannedPayoutSats > 0,
  };
}

function isOpenPending(
  record: StoredFinalizationRecord,
  nowMs: number
): boolean {
  if (record.status !== "PENDING") return false;
  if (record.paymentStatus !== "PENDING") return false;
  if (!record.paymentId) return false;
  if (record.paymentExpiresAtMs != null && record.paymentExpiresAtMs <= nowMs) {
    return false;
  }
  return true;
}

/**
 * `current` is the policy quote for this deployment and plan.
 * Historical paid rows win. A still-open invoice at or below the current
 * fee is reused. Anything else unpaid is expired before a new invoice.
 */
export function resolveFinalizationCollection(input: {
  current: FinalizationFeeQuote;
  records: StoredFinalizationRecord[];
  nowMs: number;
}): FinalizationCollection {
  const sameHash = input.records.filter(
    (record) => record.lockConfigHash === input.current.lockConfigHash
  );
  const paid = sameHash.find(
    (record) => record.status === "PAID" || record.paymentStatus === "COMPLETED"
  );
  if (paid) {
    return {
      kind: "settled",
      quote: quoteFromRecord(input.current, paid),
      paymentId: paid.paymentId,
    };
  }

  const openPending = input.records.filter((record) =>
    isOpenPending(record, input.nowMs)
  );
  const openSameHash = openPending.filter(
    (record) => record.lockConfigHash === input.current.lockConfigHash
  );

  if (input.current.feeSats <= 0) {
    return {
      kind: "waived",
      quote: input.current,
      expireIds: openPending.map((record) => record.id),
    };
  }

  const honorable = openSameHash
    .filter(
      (record) => record.feeSats > 0 && record.feeSats <= input.current.feeSats
    )
    .sort((a, b) => a.feeSats - b.feeSats)[0];
  if (honorable?.paymentId) {
    return {
      kind: "honor_pending",
      quote: quoteFromRecord(input.current, honorable),
      paymentId: honorable.paymentId,
      recordId: honorable.id,
    };
  }

  return {
    kind: "collect",
    quote: input.current,
    expireIds: openPending.map((record) => record.id),
  };
}

/** Platform-fee invoices are created only when a positive fee is still due. */
export function finalizationNeedsNewOwnerInvoice(
  collection: FinalizationCollection
): boolean {
  return collection.kind === "collect" && collection.quote.feeSats > 0;
}
