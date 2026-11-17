import { describe, expect, it } from "vitest";

import {
  finalizationNeedsNewOwnerInvoice,
  resolveFinalizationCollection,
  type FinalizationFeeQuote,
  type StoredFinalizationRecord,
} from "~/features/payments/campaign-finalization-charge";

const NOW = 1_700_000_000_000;

function quote(feeRateBps: number, feeSats: number): FinalizationFeeQuote {
  return {
    plannedPayoutSats: 10_000,
    feeRateBps,
    feeSats,
    waivedByPlan: feeSats === 0,
    lockConfigHash: "hash-a",
  };
}

function record(
  partial: Partial<StoredFinalizationRecord> &
    Pick<StoredFinalizationRecord, "id">
): StoredFinalizationRecord {
  return {
    status: "PENDING",
    feeRateBps: 1000,
    feeSats: 1000,
    lockConfigHash: "hash-a",
    paymentId: `pay-${partial.id}`,
    paymentStatus: "PENDING",
    paymentExpiresAtMs: NOW + 60_000,
    ...partial,
  };
}

describe("outstanding finalization invoices", () => {
  it("does not create an invoice when the effective fee is zero", () => {
    const open = record({ id: "old", feeSats: 1000, feeRateBps: 1000 });
    const collection = resolveFinalizationCollection({
      current: quote(0, 0),
      records: [open],
      nowMs: NOW,
    });
    expect(collection.kind).toBe("waived");
    expect(finalizationNeedsNewOwnerInvoice(collection)).toBe(false);
    if (collection.kind === "waived")
      expect(collection.expireIds).toEqual(["old"]);
  });

  it("keeps a paid invoice and does not collect the difference", () => {
    const paid = record({
      id: "paid",
      status: "PAID",
      paymentStatus: "COMPLETED",
      feeRateBps: 0,
      feeSats: 0,
    });
    const collection = resolveFinalizationCollection({
      current: quote(750, 750),
      records: [paid],
      nowMs: NOW,
    });
    expect(collection.kind).toBe("settled");
    expect(collection.quote.feeSats).toBe(0);
    expect(finalizationNeedsNewOwnerInvoice(collection)).toBe(false);
  });

  it("reuses a lower open invoice instead of raising it", () => {
    const pending = record({
      id: "pending",
      feeRateBps: 500,
      feeSats: 500,
    });
    const collection = resolveFinalizationCollection({
      current: quote(750, 750),
      records: [pending],
      nowMs: NOW,
    });
    expect(collection.kind).toBe("honor_pending");
    expect(collection.quote.feeSats).toBe(500);
    expect(finalizationNeedsNewOwnerInvoice(collection)).toBe(false);
  });

  it("does not collect a higher open invoice after the rate drops", () => {
    const pending = record({
      id: "high",
      feeRateBps: 1000,
      feeSats: 1000,
    });
    const collection = resolveFinalizationCollection({
      current: quote(500, 500),
      records: [pending],
      nowMs: NOW,
    });
    expect(collection.kind).toBe("collect");
    expect(collection.quote.feeSats).toBe(500);
    if (collection.kind === "collect") {
      expect(collection.expireIds).toEqual(["high"]);
    }
    expect(finalizationNeedsNewOwnerInvoice(collection)).toBe(true);
  });

  it("leaves a completed payment record out of a new charge", () => {
    const completed = record({
      id: "done",
      status: "PAID",
      paymentStatus: "COMPLETED",
      feeRateBps: 1000,
      feeSats: 1000,
      lockConfigHash: "other-preview",
    });
    const collection = resolveFinalizationCollection({
      current: quote(750, 750),
      records: [completed],
      nowMs: NOW,
    });
    expect(collection.kind).toBe("collect");
    expect(collection.quote.feeSats).toBe(750);
    if (collection.kind === "collect") expect(collection.expireIds).toEqual([]);
  });
});
