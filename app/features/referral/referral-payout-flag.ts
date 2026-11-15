export interface ReferralPayoutContext {
  nodeEnv?: string;
  ownerNwc?: string;
}

export interface ReferralPayoutDecision {
  enabled: boolean;
  /**
   * True only for an existing production process that already has OWNER_NWC
   * and has not set the flag yet. New installs and every non-production
   * process stay off until the flag is exactly enabled.
   */
  implicitProduction: boolean;
}

function isExplicitOn(value: string): boolean {
  return value === "true" || value === "1" || value === "yes";
}

/**
 * Payouts run only when explicitly enabled, except one production
 * compatibility path: an unset flag with a configured OWNER_NWC.
 * A missing wallet never turns payouts on. Any other value, including
 * empty-looking garbage, stays off.
 */
export function decideReferralPayouts(
  flag: string | undefined,
  context: ReferralPayoutContext = {}
): ReferralPayoutDecision {
  if (flag == null || flag.trim() === "") {
    const ownerNwc = context.ownerNwc?.trim() ?? "";
    if (context.nodeEnv === "production" && ownerNwc.length > 0) {
      return { enabled: true, implicitProduction: true };
    }
    return { enabled: false, implicitProduction: false };
  }

  const normalized = flag.trim().toLowerCase();
  if (isExplicitOn(normalized)) {
    return { enabled: true, implicitProduction: false };
  }
  return { enabled: false, implicitProduction: false };
}
