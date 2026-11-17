/**
 * Manual resolution of a campaign payout whose wallet result was lost.
 * `confirmed_unpaid` releases the claim so a later run may pay a new invoice.
 * That decision is refused while the original request can still be in flight.
 *
 * The hold is not a fixed constant. It is the longest path through
 * `payAuthorizedBolt11` for the timeouts that were in effect, plus a margin
 * for the gap between the attempt row and the wallet call and for the settle
 * write after the call returns. Legacy rows that have no stored deadline use
 * the maximum permitted timeouts.
 */

/** Inclusive upper bound accepted for either NWC timeout. */
export const MAX_NWC_TIMEOUT_MS = 120_000;

/**
 * Time after the bounded NWC calls for scheduling and the settle write.
 * This is not another wallet round trip.
 */
export const PAYOUT_RESOLUTION_SAFETY_MARGIN_MS = 30_000;

/**
 * How long `payAuthorizedBolt11` can still be inside the process.
 *
 * 1. Wait for `pay_invoice` until `payMs`.
 * 2. If that wait times out, race the late response against `lookup_invoice`
 *    until `reconcileMs`.
 * 3. A pay response from either wait that has no valid preimage performs one
 *    more `lookup_invoice` (including `get_info`) until `reconcileMs`.
 *
 * A lookup that never returns ends that phase. It does not add a fourth wait.
 */
export function authorizedPayActiveWindowMs(args: {
  payMs: number;
  reconcileMs: number;
}): number {
  return positiveMs(args.payMs) + positiveMs(args.reconcileMs) * 2;
}

export function resolutionHoldMs(args?: {
  payMs?: number;
  reconcileMs?: number;
  safetyMarginMs?: number;
}): number {
  const payMs = args?.payMs ?? MAX_NWC_TIMEOUT_MS;
  const reconcileMs = args?.reconcileMs ?? MAX_NWC_TIMEOUT_MS;
  const margin =
    args?.safetyMarginMs === undefined
      ? PAYOUT_RESOLUTION_SAFETY_MARGIN_MS
      : nonnegativeMs(args.safetyMarginMs);
  return authorizedPayActiveWindowMs({ payMs, reconcileMs }) + margin;
}

/**
 * Instant before which `confirmed_unpaid` is refused.
 * A stored deadline wins. Without one, the maximum legal budget is used so a
 * later, shorter timeout configuration cannot release an older attempt early.
 * Returns null when the attempt has no start time and no stored deadline.
 */
export function resolutionDeadlineMs(args: {
  attemptStartedAtMs: number | null;
  resolutionNotBeforeMs?: number | null;
  payTimeoutMs?: number;
  reconcileTimeoutMs?: number;
  safetyMarginMs?: number;
}): number | null {
  if (isFiniteMs(args.resolutionNotBeforeMs)) return args.resolutionNotBeforeMs;
  if (!isFiniteMs(args.attemptStartedAtMs)) return null;
  return (
    args.attemptStartedAtMs +
    resolutionHoldMs({
      payMs: args.payTimeoutMs,
      reconcileMs: args.reconcileTimeoutMs,
      safetyMarginMs: args.safetyMarginMs,
    })
  );
}

export function unpaidResolutionAllowed(args: {
  status: string;
  attemptStartedAtMs: number | null;
  nowMs: number;
  resolutionNotBeforeMs?: number | null;
  payTimeoutMs?: number;
  reconcileTimeoutMs?: number;
  safetyMarginMs?: number;
}): { ok: true } | { ok: false; error: string } {
  if (args.status !== "paying" && args.status !== "unknown") {
    return {
      ok: false,
      error: "Only an in-flight or unknown payout can be resolved by hand",
    };
  }
  const deadline = resolutionDeadlineMs(args);
  if (deadline === null || args.nowMs < deadline) {
    return {
      ok: false,
      error:
        "This payment attempt may still be running. Check the wallet after the resolution deadline, then resolve it. Marking it unpaid now could pay the winner twice.",
    };
  }
  return { ok: true };
}

function isFiniteMs(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) return MAX_NWC_TIMEOUT_MS;
  return value;
}

function nonnegativeMs(value: number): number {
  if (!Number.isFinite(value) || value < 0)
    return PAYOUT_RESOLUTION_SAFETY_MARGIN_MS;
  return value;
}
