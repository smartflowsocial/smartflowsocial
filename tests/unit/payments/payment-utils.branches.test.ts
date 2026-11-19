import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({
  logError: vi.fn(
    (_error: unknown, _context?: Record<string, unknown>): void => undefined
  ),
}));

vi.mock("~/lib/error-logger.server", () => logger);

import {
  extractAmountFromRequest,
  extractInvoiceFromRequest,
  extractPaymentHashFromRequest,
  parseLightningInvoiceAmount,
} from "~/features/payments/data/payment-utils.server";

describe("extractInvoiceFromRequest", () => {
  it("returns an empty string for missing and non-object requests", () => {
    expect(extractInvoiceFromRequest(null)).toBe("");
    expect(extractInvoiceFromRequest(undefined)).toBe("");
    expect(extractInvoiceFromRequest(4)).toBe("");
    expect(extractInvoiceFromRequest("lnbc1")).toBe("");
    expect(extractInvoiceFromRequest(["lnbc1"])).toBe("");
    expect(extractInvoiceFromRequest({})).toBe("");
  });

  it("returns a string invoice and a nested payment request", () => {
    expect(extractInvoiceFromRequest({ invoice: "lnbc1direct" })).toBe(
      "lnbc1direct"
    );
    expect(
      extractInvoiceFromRequest({
        invoice: { paymentRequest: "lnbc1nested" },
      })
    ).toBe("lnbc1nested");
  });

  it("returns an empty string for invoice shapes that are not payment requests", () => {
    expect(extractInvoiceFromRequest({ invoice: null })).toBe("");
    expect(extractInvoiceFromRequest({ invoice: ["lnbc1"] })).toBe("");
    expect(extractInvoiceFromRequest({ invoice: { other: "lnbc1" } })).toBe("");
    expect(extractInvoiceFromRequest({ invoice: { paymentRequest: 12 } })).toBe(
      ""
    );
  });
});

describe("extractPaymentHashFromRequest", () => {
  it("prefers a direct string payment hash", () => {
    expect(
      extractPaymentHashFromRequest({
        paymentHash: "direct",
        invoice: { paymentHash: "nested" },
      })
    ).toBe("direct");
    expect(extractPaymentHashFromRequest({ paymentHash: "" })).toBe("");
  });

  it("stringifies a hash stored on the invoice object", () => {
    expect(
      extractPaymentHashFromRequest({
        paymentHash: 12,
        invoice: { paymentHash: 99 },
      })
    ).toBe("99");
    expect(
      extractPaymentHashFromRequest({ invoice: { paymentHash: null } })
    ).toBe("null");
    expect(
      extractPaymentHashFromRequest({ invoice: { paymentHash: { id: 1 } } })
    ).toBe("[object Object]");
  });

  it("returns an empty string when no hash is present", () => {
    expect(extractPaymentHashFromRequest(null)).toBe("");
    expect(extractPaymentHashFromRequest(["hash"])).toBe("");
    expect(extractPaymentHashFromRequest({ invoice: ["hash"] })).toBe("");
    expect(extractPaymentHashFromRequest({ invoice: {} })).toBe("");
  });
});

describe("parseLightningInvoiceAmount", () => {
  it("converts each BOLT11 amount multiplier into sats", () => {
    expect(parseLightningInvoiceAmount("LNBC10M1rest")).toBe(1_000_000);
    expect(parseLightningInvoiceAmount("lnbc5u")).toBe(500);
    expect(parseLightningInvoiceAmount("lnbc15n")).toBe(2);
    expect(parseLightningInvoiceAmount("lnbc25000p")).toBe(3);
    expect(parseLightningInvoiceAmount("lnbc2rest")).toBe(200_000_000);
    expect(parseLightningInvoiceAmount("lnbc0")).toBe(0);
  });

  it("returns null when the invoice has no lnbc amount", () => {
    expect(parseLightningInvoiceAmount("")).toBeNull();
    expect(parseLightningInvoiceAmount("lnbc")).toBeNull();
    expect(parseLightningInvoiceAmount("bc1address")).toBeNull();
  });

  it("does not log while parsing a string invoice", () => {
    expect(parseLightningInvoiceAmount("lnbc1u")).toBe(100);
    expect(logger.logError).not.toHaveBeenCalled();
  });
});

describe("extractAmountFromRequest", () => {
  const fallback = vi.fn(
    async (amountUsd: number): Promise<number> => amountUsd * 1000
  );

  beforeEach(() => {
    fallback.mockClear();
  });

  it("uses a truthy direct amount before invoice, request, or lightning", async () => {
    await expect(
      extractAmountFromRequest(
        { amount: 7, satoshi: 3, invoice: { satoshi: 4 } },
        "lnbc9u",
        2,
        fallback
      )
    ).resolves.toBe(7);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("skips a zero or non-numeric direct amount and reads invoice satoshis", async () => {
    await expect(
      extractAmountFromRequest(
        { amount: 0, invoice: { satoshi: "11" } },
        "lnbc9u",
        2,
        fallback
      )
    ).resolves.toBe(11);
    await expect(
      extractAmountFromRequest(
        { amount: "4", invoice: { satoshi: 8 } },
        "",
        2,
        fallback
      )
    ).resolves.toBe(8);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("skips an unusable invoice amount and uses request satoshis, including zero", async () => {
    await expect(
      extractAmountFromRequest(
        { invoice: { satoshi: "nope" }, satoshi: 0 },
        "lnbc9u",
        2,
        fallback
      )
    ).resolves.toBe(0);
    await expect(
      extractAmountFromRequest(
        { invoice: ["5"], satoshi: 6 },
        "not-lightning",
        2,
        fallback
      )
    ).resolves.toBe(6);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("parses a lightning invoice when the request has no numeric amount", async () => {
    await expect(
      extractAmountFromRequest(null, "lnbc2u", 9, fallback)
    ).resolves.toBe(200);
    await expect(
      extractAmountFromRequest({}, "lnbc1m", 9, fallback)
    ).resolves.toBe(100_000);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("asks for the fallback amount when no invoice amount can be read", async () => {
    await expect(
      extractAmountFromRequest(
        { invoice: { satoshi: "nope" } },
        "",
        2.5,
        fallback
      )
    ).resolves.toBe(2500);
    await expect(
      extractAmountFromRequest(null, "not-an-invoice", 4, fallback)
    ).resolves.toBe(4000);
    expect(fallback).toHaveBeenNthCalledWith(1, 2.5);
    expect(fallback).toHaveBeenNthCalledWith(2, 4);
  });
});
