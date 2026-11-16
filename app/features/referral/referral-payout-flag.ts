export interface ReferralPayoutContext {
  nodeEnv?: string;
  ownerNwc?: string;
}

export interface ReferralPayoutDecision {
  enabled: boolean;
}

function isExplicitOn(value: string): boolean {
  return value === "true" || value === "1" || value === "yes";
}

/**
 * Payouts run only when the flag is exactly enabled.
 * A configured wallet, including OWNER_NWC in production, does not turn them on.
 * Any other value, including empty or malformed text, stays off.
 */
export function decideReferralPayouts(
  flag: string | undefined,
  _context: ReferralPayoutContext = {}
): ReferralPayoutDecision {
  if (flag == null || flag.trim() === "") {
    return { enabled: false };
  }
  const normalized = flag.trim().toLowerCase();
  if (isExplicitOn(normalized)) {
    return { enabled: true };
  }
  return { enabled: false };
}
