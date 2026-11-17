import {
  isNonNegativeWholeSats,
  isPositiveWholeSats,
} from "~/features/referral/bolt11-invoice.server";

export const RESERVED_PAYOUT_STATUSES = ["paid", "paying", "unknown"] as const;

export function isReservedPayoutStatus(status: string): boolean {
  return (RESERVED_PAYOUT_STATUSES as readonly string[]).includes(status);
}

export interface BudgetWinner {
  winnerPubkey: string;
  amountSats: number;
}

export interface BudgetItem {
  winnerPubkey: string;
  amountSats: number;
  status: string;
}

/**
 * The smaller of the stored cap and the cap on this request.
 * A later request cannot raise a cap that was already recorded.
 * Null means that side did not set a cap.
 */
export function tighterSpendCap(
  stored: number | null,
  requested: number | null
): number | null {
  if (stored === null) return requested;
  if (requested === null) return stored;
  return Math.min(stored, requested);
}

export function readSpendCap(
  value: number | null | undefined
): { ok: true; spendCapSats: number | null } | { ok: false; error: string } {
  if (value === null || value === undefined) {
    return { ok: true, spendCapSats: null };
  }
  if (!isNonNegativeWholeSats(value)) {
    return {
      ok: false,
      error: "Spend cap must be a whole number of sats, or unset",
    };
  }
  return { ok: true, spendCapSats: value };
}

export function sumPayableSats(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!isPositiveWholeSats(value)) continue;
    if (total > Number.MAX_SAFE_INTEGER - value) return null;
    total += value;
  }
  return total;
}

/**
 * Authorized campaign budget in sats.
 * Each winner contributes their stored allocation. A request cannot raise it.
 * When a spend cap is set, the budget is the smaller of that cap and the
 * allocation total.
 */
export function authorizedCampaignBudgetSats(args: {
  spendCapSats: number | null;
  items: readonly BudgetItem[];
  requested: readonly BudgetWinner[];
}): { ok: true; capSats: number } | { ok: false; error: string } {
  if (
    args.spendCapSats !== null &&
    !isNonNegativeWholeSats(args.spendCapSats)
  ) {
    return {
      ok: false,
      error: "Campaign spend cap is not a whole number of sats",
    };
  }

  const amounts = new Map<string, number>();
  for (const item of args.items) {
    if (!isPositiveWholeSats(item.amountSats)) {
      return {
        ok: false,
        error: "Stored payout amount is not a whole number of sats",
      };
    }
    amounts.set(item.winnerPubkey, item.amountSats);
  }
  for (const winner of args.requested) {
    if (!isPositiveWholeSats(winner.amountSats)) continue;
    if (!amounts.has(winner.winnerPubkey)) {
      amounts.set(winner.winnerPubkey, winner.amountSats);
    }
  }

  let allocation = 0;
  for (const amount of amounts.values()) {
    if (allocation > Number.MAX_SAFE_INTEGER - amount) {
      return { ok: false, error: "Campaign budget overflow" };
    }
    allocation += amount;
  }

  const cap =
    args.spendCapSats === null
      ? allocation
      : Math.min(args.spendCapSats, allocation);
  return { ok: true, capSats: cap };
}

export function reservedPayoutSats(
  items: readonly BudgetItem[],
  excludeWinner?: string
): number | null {
  let reserved = 0;
  for (const item of items) {
    if (excludeWinner !== undefined && item.winnerPubkey === excludeWinner) {
      continue;
    }
    if (!isReservedPayoutStatus(item.status)) continue;
    if (!isPositiveWholeSats(item.amountSats)) return null;
    if (reserved > Number.MAX_SAFE_INTEGER - item.amountSats) return null;
    reserved += item.amountSats;
  }
  return reserved;
}

export function budgetAllowsNextPayment(args: {
  capSats: number;
  reservedSats: number;
  nextSats: number;
}): { ok: true } | { ok: false; error: string } {
  if (
    !isNonNegativeWholeSats(args.capSats) ||
    !isNonNegativeWholeSats(args.reservedSats) ||
    !isPositiveWholeSats(args.nextSats)
  ) {
    return { ok: false, error: "Payout budget amounts must be whole sats" };
  }
  if (args.reservedSats > args.capSats) {
    return { ok: false, error: "Campaign budget is already exhausted" };
  }
  if (args.nextSats > args.capSats - args.reservedSats) {
    return {
      ok: false,
      error: "Invoice amount exceeds the campaign's remaining budget",
    };
  }
  return { ok: true };
}
