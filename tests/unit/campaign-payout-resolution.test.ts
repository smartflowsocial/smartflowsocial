import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_NOW_MS, invoiceForSats } from "../helpers/bolt11-fixture";

import {
  MAX_NWC_TIMEOUT_MS,
  PAYOUT_RESOLUTION_SAFETY_MARGIN_MS,
  authorizedPayActiveWindowMs,
  resolutionHoldMs,
  unpaidResolutionAllowed,
} from "~/features/payments/campaign-payout-resolution";
import {
  DEFAULT_NWC_PAY_TIMEOUT_MS,
  DEFAULT_NWC_RECONCILE_TIMEOUT_MS,
  payAuthorizedBolt11,
  readPositiveTimeoutMs,
  type AuthorizedNwcClient,
} from "~/features/payments/nwc-authorized-pay.server";

const NOW = 1_800_000_000_000;
const PREIMAGE = "ab".repeat(32);
const HASH = createHash("sha256")
  .update(Buffer.from(PREIMAGE, "hex"))
  .digest("hex");

function gate(args: {
  status?: string;
  startedAt?: number | null;
  now: number;
  payMs?: number;
  reconcileMs?: number;
  margin?: number;
  resolutionNotBeforeMs?: number | null;
}) {
  return unpaidResolutionAllowed({
    status: args.status ?? "paying",
    attemptStartedAtMs: args.startedAt === undefined ? NOW : args.startedAt,
    nowMs: args.now,
    payTimeoutMs: args.payMs,
    reconcileTimeoutMs: args.reconcileMs,
    safetyMarginMs: args.margin,
    resolutionNotBeforeMs: args.resolutionNotBeforeMs,
  });
}

describe("manual payout resolution budget", () => {
  it("keeps the default 45s pay and 15s reconciliation timeouts closed until both lookups can finish", () => {
    expect(DEFAULT_NWC_PAY_TIMEOUT_MS).toBe(45_000);
    expect(DEFAULT_NWC_RECONCILE_TIMEOUT_MS).toBe(15_000);
    const hold = resolutionHoldMs({
      payMs: DEFAULT_NWC_PAY_TIMEOUT_MS,
      reconcileMs: DEFAULT_NWC_RECONCILE_TIMEOUT_MS,
    });
    expect(
      authorizedPayActiveWindowMs({ payMs: 45_000, reconcileMs: 15_000 })
    ).toBe(75_000);
    expect(hold).toBe(75_000 + PAYOUT_RESOLUTION_SAFETY_MARGIN_MS);
    expect(
      gate({ now: NOW + hold - 1, payMs: 45_000, reconcileMs: 15_000 }).ok
    ).toBe(false);
    expect(
      gate({
        status: "unknown",
        now: NOW + hold,
        payMs: 45_000,
        reconcileMs: 15_000,
      })
    ).toEqual({ ok: true });
  });

  it("keeps the maximum 120s pay and 120s reconciliation timeouts closed past the old fixed hold", () => {
    expect(readPositiveTimeoutMs("120000", 1)).toBe(MAX_NWC_TIMEOUT_MS);
    expect(readPositiveTimeoutMs("120001", 45_000)).toBe(45_000);
    const hold = resolutionHoldMs({
      payMs: MAX_NWC_TIMEOUT_MS,
      reconcileMs: MAX_NWC_TIMEOUT_MS,
    });
    expect(hold).toBe(360_000 + PAYOUT_RESOLUTION_SAFETY_MARGIN_MS);
    expect(hold).toBeGreaterThan(120_000);
    expect(
      gate({
        status: "unknown",
        now: NOW + 120_000,
        payMs: MAX_NWC_TIMEOUT_MS,
        reconcileMs: MAX_NWC_TIMEOUT_MS,
      }).ok
    ).toBe(false);
    expect(
      gate({
        status: "paying",
        now: NOW + hold - 1,
        payMs: MAX_NWC_TIMEOUT_MS,
        reconcileMs: MAX_NWC_TIMEOUT_MS,
      }).ok
    ).toBe(false);
    expect(
      gate({
        status: "unknown",
        now: NOW + hold,
        payMs: MAX_NWC_TIMEOUT_MS,
        reconcileMs: MAX_NWC_TIMEOUT_MS,
      })
    ).toEqual({ ok: true });
  });

  it("uses a stored deadline when a later configuration is shorter", () => {
    const stored =
      NOW + resolutionHoldMs({ payMs: 120_000, reconcileMs: 120_000 });
    expect(
      gate({
        status: "unknown",
        now: NOW + resolutionHoldMs({ payMs: 45_000, reconcileMs: 15_000 }),
        payMs: 45_000,
        reconcileMs: 15_000,
        resolutionNotBeforeMs: stored,
      }).ok
    ).toBe(false);
    expect(
      gate({
        status: "unknown",
        now: stored,
        payMs: 45_000,
        reconcileMs: 15_000,
        resolutionNotBeforeMs: stored,
      })
    ).toEqual({ ok: true });
  });

  it("uses the maximum budget for a legacy attempt with no stored deadline", () => {
    const hold = resolutionHoldMs();
    expect(hold).toBe(
      MAX_NWC_TIMEOUT_MS * 3 + PAYOUT_RESOLUTION_SAFETY_MARGIN_MS
    );
    expect(gate({ status: "unknown", now: NOW + 120_000 }).ok).toBe(false);
    expect(gate({ status: "unknown", now: NOW + hold })).toEqual({ ok: true });
  });

  it("refuses a crashed worker's paying record until the deadline, then allows a noted release", () => {
    const hold = resolutionHoldMs({ payMs: 45_000, reconcileMs: 15_000 });
    expect(
      gate({
        status: "paying",
        now: NOW + hold - 1,
        payMs: 45_000,
        reconcileMs: 15_000,
      }).ok
    ).toBe(false);
    expect(
      gate({
        status: "paying",
        now: NOW + hold,
        payMs: 45_000,
        reconcileMs: 15_000,
      })
    ).toEqual({ ok: true });
  });

  it("keeps an unknown payout with no wallet proof on the same deadline", () => {
    const hold = resolutionHoldMs({ payMs: 120_000, reconcileMs: 120_000 });
    expect(
      gate({
        status: "unknown",
        now: NOW + hold - 1,
        payMs: 120_000,
        reconcileMs: 120_000,
      }).ok
    ).toBe(false);
    expect(
      gate({
        status: "unknown",
        now: NOW + hold,
        payMs: 120_000,
        reconcileMs: 120_000,
      })
    ).toEqual({ ok: true });
  });

  it("refuses when the attempt has no start and no deadline", () => {
    expect(gate({ startedAt: null, now: NOW + 10_000_000 }).ok).toBe(false);
  });

  it("does not resolve a payout that is already paid or failed", () => {
    expect(gate({ status: "paid", now: NOW + 10_000_000 }).ok).toBe(false);
    expect(gate({ status: "failed", now: NOW + 10_000_000 }).ok).toBe(false);
  });
});

describe("payout attempt still inside payAuthorizedBolt11", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function hangingWallet(): {
    payInvoice: ReturnType<typeof vi.fn>;
    resolvePay: (value: unknown) => void;
    client: AuthorizedNwcClient;
  } {
    let resolvePay: (value: unknown) => void = () => undefined;
    const payInvoice = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePay = resolve;
        })
    );
    return {
      payInvoice,
      resolvePay: (value) => resolvePay(value),
      client: {
        payInvoice,
        lookupInvoice: vi.fn(() => new Promise(() => undefined)),
        getInfo: async () => ({ methods: ["pay_invoice", "lookup_invoice"] }),
        close: vi.fn(),
      },
    };
  }

  async function startAttempt(args: {
    payMs: number;
    reconcileMs: number;
    wallet: ReturnType<typeof hangingWallet>;
  }) {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const started = Date.now();
    let finished = started;
    const pending = payAuthorizedBolt11({
      nwcUrl: "nostr+walletconnect://test",
      invoice: invoiceForSats(100, HASH),
      authorizedSats: 100,
      timeoutMs: args.payMs,
      reconcileTimeoutMs: args.reconcileMs,
      nowMs: FIXTURE_NOW_MS,
      clientFactory: () => args.wallet.client,
    }).then((result) => {
      finished = Date.now();
      return result;
    });
    return { started, pending, finished: () => finished };
  }

  function stillClosed(started: number, payMs: number, reconcileMs: number) {
    expect(
      unpaidResolutionAllowed({
        status: "paying",
        attemptStartedAtMs: started,
        nowMs: Date.now(),
        payTimeoutMs: payMs,
        reconcileTimeoutMs: reconcileMs,
        safetyMarginMs: 0,
      }).ok
    ).toBe(false);
  }

  it("does not release while a pay response just before the timeout is followed by a hanging lookup", async () => {
    const payMs = 45_000;
    const reconcileMs = 15_000;
    const wallet = hangingWallet();
    const attempt = await startAttempt({ payMs, reconcileMs, wallet });
    await vi.advanceTimersByTimeAsync(payMs - 1);
    wallet.resolvePay({ payment_hash: HASH });
    await vi.advanceTimersByTimeAsync(reconcileMs - 1);
    stillClosed(attempt.started, payMs, reconcileMs);
    await vi.advanceTimersByTimeAsync(2);
    const result = await attempt.pending;
    expect(result).toMatchObject({ ok: false, disposition: "unknown" });
    expect(wallet.payInvoice).toHaveBeenCalledTimes(1);
    const elapsed = attempt.finished() - attempt.started;
    expect(elapsed).toBeGreaterThanOrEqual(payMs - 1 + reconcileMs - 1);
    expect(elapsed).toBeLessThanOrEqual(
      authorizedPayActiveWindowMs({ payMs, reconcileMs })
    );
  });

  it("does not release when the pay response arrives after the first timeout and the next lookup hangs", async () => {
    const payMs = 45_000;
    const reconcileMs = 15_000;
    const wallet = hangingWallet();
    const attempt = await startAttempt({ payMs, reconcileMs, wallet });
    await vi.advanceTimersByTimeAsync(payMs + reconcileMs - 1);
    stillClosed(attempt.started, payMs, reconcileMs);
    wallet.resolvePay({ payment_hash: HASH });
    await vi.advanceTimersByTimeAsync(reconcileMs - 1);
    stillClosed(attempt.started, payMs, reconcileMs);
    await vi.advanceTimersByTimeAsync(2);
    const result = await attempt.pending;
    expect(result).toMatchObject({ ok: false, disposition: "unknown" });
    expect(wallet.payInvoice).toHaveBeenCalledTimes(1);
    const elapsed = attempt.finished() - attempt.started;
    expect(elapsed).toBeGreaterThanOrEqual(payMs + reconcileMs * 2 - 2);
    expect(elapsed).toBeLessThanOrEqual(
      authorizedPayActiveWindowMs({ payMs, reconcileMs })
    );
  });

  it("returns unknown when lookup hangs for good and still calls payInvoice only once", async () => {
    const payMs = 120_000;
    const reconcileMs = 120_000;
    const wallet = hangingWallet();
    const attempt = await startAttempt({ payMs, reconcileMs, wallet });
    await vi.advanceTimersByTimeAsync(payMs + reconcileMs - 1);
    stillClosed(attempt.started, payMs, reconcileMs);
    await vi.advanceTimersByTimeAsync(1);
    const result = await attempt.pending;
    expect(result).toMatchObject({ ok: false, disposition: "unknown" });
    if (result.ok) return;
    expect(["reconciliation_timeout", "reconciliation_required"]).toContain(
      result.code
    );
    expect(wallet.payInvoice).toHaveBeenCalledTimes(1);
    const windowMs = authorizedPayActiveWindowMs({ payMs, reconcileMs });
    expect(
      unpaidResolutionAllowed({
        status: "unknown",
        attemptStartedAtMs: attempt.started,
        nowMs: attempt.started + windowMs - 1,
        payTimeoutMs: payMs,
        reconcileTimeoutMs: reconcileMs,
        safetyMarginMs: 0,
      }).ok
    ).toBe(false);
    expect(
      unpaidResolutionAllowed({
        status: "unknown",
        attemptStartedAtMs: attempt.started,
        nowMs: attempt.started + resolutionHoldMs({ payMs, reconcileMs }),
        payTimeoutMs: payMs,
        reconcileTimeoutMs: reconcileMs,
      })
    ).toEqual({ ok: true });
    expect(wallet.payInvoice).toHaveBeenCalledTimes(1);
  });
});
