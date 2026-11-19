import { decideReferralPayouts } from "~/features/referral/referral-payout-flag";

export interface ProductionSecretInput {
  nodeEnv: string | undefined;
  e2eTest: string | undefined;
  cronSecret: string | undefined;
  referralManualPayoutSecret: string | undefined;
  /** When explicitly on, production also requires the referral payout secret. */
  referralPayoutsEnabled: string | undefined;
}

export interface ProductionSecretProblem {
  key: string;
  reason: string;
}

/**
 * Production boot refuses to start when secrets that gate administrative HTTP
 * routes are missing. Referral payouts are optional: the manual route stays
 * closed until its secret is set, and production requires that secret only
 * when referral payouts are explicitly enabled. Development and E2E boots may
 * omit the cron secret; those routes still reject requests.
 */
export function productionSecretErrors(
  input: ProductionSecretInput
): ProductionSecretProblem[] {
  if (input.nodeEnv !== "production" || input.e2eTest === "true") return [];

  const problems: ProductionSecretProblem[] = [];
  if ((input.cronSecret?.trim() ?? "").length < 32) {
    problems.push({
      key: "CRON_SECRET",
      reason:
        "is required in production and must be at least 32 characters. Generate one with: openssl rand -base64 32",
    });
  }
  if (
    decideReferralPayouts(input.referralPayoutsEnabled).enabled &&
    (input.referralManualPayoutSecret?.trim() ?? "").length < 32
  ) {
    problems.push({
      key: "REFERRAL_MANUAL_PAYOUT_SECRET",
      reason:
        "is required in production when referral payouts are enabled and must be at least 32 characters. Generate one with: openssl rand -base64 32",
    });
  }
  return problems;
}
