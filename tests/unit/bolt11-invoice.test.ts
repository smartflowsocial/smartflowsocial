import { describe, expect, it } from "vitest";

import {
  FIXTURE_NOW_MS,
  invoiceForSats,
  makeBolt11,
} from "../helpers/bolt11-fixture";

import {
  amountSatsFromMillisatoshis,
  assertBolt11MatchesAuthorizedAmount,
  millisatsFromSats,
  readBolt11ForPayout,
} from "~/features/referral/bolt11-invoice.server";

const KNOWN_INVOICE =
  "lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567";
const KNOWN_TIMESTAMP_MS = 1648859703 * 1000;

describe("bolt11 invoice reading", () => {
  it("reads the amount and payment hash from a mainnet invoice", () => {
    const result = readBolt11ForPayout(KNOWN_INVOICE, KNOWN_TIMESTAMP_MS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amountSats).toBe(2000);
    expect(result.paymentHash).toBe(
      "f5636521e98000697a6700b979c288ddad56cb3995a2eb07550872c466ccc3e5"
    );
  });

  it("rejects an expired invoice", () => {
    const result = readBolt11ForPayout(KNOWN_INVOICE, Date.now());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("expired");
  });

  it("rejects an invoice that stays valid longer than the audit retention window", () => {
    const fourHundredDaysMs = 400 * 24 * 60 * 60 * 1000;
    const result = readBolt11ForPayout(
      KNOWN_INVOICE,
      KNOWN_TIMESTAMP_MS - fourHundredDaysMs
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("too long");
  });

  it("rejects malformed invoices", () => {
    expect(readBolt11ForPayout("").ok).toBe(false);
    expect(readBolt11ForPayout("not-an-invoice").ok).toBe(false);
    expect(readBolt11ForPayout("lnbc1notvalid").ok).toBe(false);
  });

  it("rejects amountless and sub-sat amounts", () => {
    expect(amountSatsFromMillisatoshis(undefined).ok).toBe(false);
    expect(amountSatsFromMillisatoshis(null).ok).toBe(false);
    const fractional = amountSatsFromMillisatoshis("1500");
    expect(fractional.ok).toBe(false);
    const whole = amountSatsFromMillisatoshis("2000000");
    expect(whole).toEqual({ ok: true, amountSats: 2000 });
  });
});

describe("authorized BOLT11 payout checks", () => {
  it("accepts an invoice for the exact authorized amount", () => {
    const invoice = invoiceForSats(125);
    const result = assertBolt11MatchesAuthorizedAmount({
      invoice,
      authorizedSats: 125,
      nowMs: FIXTURE_NOW_MS,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amountSats).toBe(125);
    expect(result.paymentHash).toHaveLength(64);
  });

  it("rejects one sat above and one sat below the authorized amount", () => {
    const invoice = invoiceForSats(100);
    const above = assertBolt11MatchesAuthorizedAmount({
      invoice,
      authorizedSats: 99,
      nowMs: FIXTURE_NOW_MS,
    });
    const below = assertBolt11MatchesAuthorizedAmount({
      invoice,
      authorizedSats: 101,
      nowMs: FIXTURE_NOW_MS,
    });
    expect(above.ok).toBe(false);
    expect(below.ok).toBe(false);
  });

  it("accepts a large whole-sat amount and rejects one past the safe integer range", () => {
    const large = invoiceForSats(21_000_000n * 100_000_000n);
    const accepted = readBolt11ForPayout(large, FIXTURE_NOW_MS);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.amountSats).toBe(2_100_000_000_000_000);

    const tooLarge = makeBolt11({
      amountSats: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    });
    const rejected = readBolt11ForPayout(tooLarge, FIXTURE_NOW_MS);
    expect(rejected.ok).toBe(false);
  });

  it("rejects sub-sat millisatoshi boundaries and amountless invoices", () => {
    expect(millisatsFromSats(1)).toBe(1000n);
    expect(millisatsFromSats(1.5)).toBeNull();
    expect(millisatsFromSats(0)).toBeNull();
    const oneMillisat = makeBolt11({ millisats: 1n });
    const almostOneSat = makeBolt11({ millisats: 999n });
    const exactOneSat = makeBolt11({ millisats: 1000n });
    expect(readBolt11ForPayout(oneMillisat, FIXTURE_NOW_MS).ok).toBe(false);
    expect(readBolt11ForPayout(almostOneSat, FIXTURE_NOW_MS).ok).toBe(false);
    const whole = readBolt11ForPayout(exactOneSat, FIXTURE_NOW_MS);
    expect(whole.ok).toBe(true);
    if (whole.ok) expect(whole.amountSats).toBe(1);
    expect(
      readBolt11ForPayout(makeBolt11({ amountSats: null }), FIXTURE_NOW_MS).ok
    ).toBe(false);
  });

  it("rejects expired, wrong-network, corrupt, and hashless invoices", () => {
    const invoice = invoiceForSats(50);
    expect(readBolt11ForPayout(invoice, FIXTURE_TIMESTAMP_MS()).ok).toBe(false);
    expect(
      readBolt11ForPayout(
        makeBolt11({ amountSats: 50, network: "tb" }),
        FIXTURE_NOW_MS
      ).ok
    ).toBe(false);
    expect(readBolt11ForPayout("lnbc1notvalid", FIXTURE_NOW_MS).ok).toBe(false);
    expect(
      readBolt11ForPayout(
        makeBolt11({ amountSats: 50, paymentHashHex: null }),
        FIXTURE_NOW_MS
      ).ok
    ).toBe(false);
  });
});

function FIXTURE_TIMESTAMP_MS(): number {
  return (1_700_000_000 + 3600) * 1000;
}
