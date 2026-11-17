/**
 * Manual resolution of a campaign payout whose wallet result was lost.
 * `confirmed_unpaid` releases the claim so a later run may pay a new invoice.
 * That decision is refused while the original request can still be in flight.
 */

/** Pay timeout plus reconciliation timeout, with room for a slow worker. */
export const ACTIVE_PAYOUT_RESOLUTION_HOLD_MS = 120_000;

export function unpaidResolutionAllowed(args: {
  status: string;
  attemptStartedAtMs: number | null;
  nowMs: number;
  holdMs?: number;
}): { ok: true } | { ok: false; error: string } {
  if (args.status !== "paying" && args.status !== "unknown") {
    return {
      ok: false,
      error: "Only an in-flight or unknown payout can be resolved by hand",
    };
  }
  const holdMs = args.holdMs ?? ACTIVE_PAYOUT_RESOLUTION_HOLD_MS;
  const started = args.attemptStartedAtMs ?? args.nowMs;
  if (args.nowMs - started < holdMs) {
    return {
      ok: false,
      error:
        "This payment is still inside the wallet timeout. Check the wallet after the hold, then resolve it. Marking it unpaid now could pay the winner twice.",
    };
  }
  return { ok: true };
}
