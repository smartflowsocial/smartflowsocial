/**
 * Server import path for giveaway payout helpers.
 * The implementation is client-safe and lives in giveaway-payout.shared.ts.
 */
export {
  allWinnersPayoutSettled,
  budgetSatsFromGiveawayRow,
  buildInitialPayoutState,
  computeGiveawayPlannedPayoutSats,
  countPayoutCompleted,
  normalizePayoutState,
  resolveWinnerSatsPerWinner,
  totalSatsBudgetFromSnapshot,
  totalSatsPaidFromState,
} from "./giveaway-payout.shared";

export type {
  GiveawayPayoutAmountContext,
  GiveawayPayoutEntry,
  GiveawayPayoutEntryStatus,
  GiveawayPayoutStateMap,
} from "./giveaway-payout.shared";
