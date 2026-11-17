import crypto from "node:crypto";

import {
  fetchPrimalProfileData,
  processPrimalData,
} from "~/features/auth/profile.server";
import {
  readSpendCap,
  sumPayableSats,
  type BudgetWinner,
} from "~/features/payments/campaign-payout-budget";
import { resolutionHoldMs } from "~/features/payments/campaign-payout-resolution";
import {
  lookupAuthorizedPayment,
  nwcTimeouts,
  payAuthorizedBolt11,
} from "~/features/payments/nwc-authorized-pay.server";
import {
  claimCampaignPayoutItem,
  recordUnpayableCampaignItem,
  settleCampaignPayoutAttempt,
  type CampaignClaimResult,
} from "~/features/payments/repositories/campaign-payout-claim.server";
import {
  findOrCreatePayoutRunByIdempotencyKey,
  findPayoutRunByIdempotencyKey,
  updatePayoutRun,
  withPayoutLedgerTransaction,
} from "~/features/payments/repositories/payout-ledger-data.server";
import { assertBolt11MatchesAuthorizedAmount } from "~/features/referral/bolt11-invoice.server";
import { fetchLnurlPayInvoice } from "~/features/referral/lnurl-pay.server";
import { getDecryptedUserNWC } from "~/features/user";
import { logError } from "~/lib/error-logger.server";
import { nostrAdapter } from "~/lib/nostr-adapter.server";

export type CampaignPayoutScope = "CONTEST" | "GIVEAWAY";
export type CampaignWalletMode = "manual" | "nwc_creator";
export type CampaignPayoutTrigger = "manual_trigger" | "autorun";

export type PayoutEligibility =
  | { eligible: true; walletMode: "nwc_creator"; nwc: string }
  | {
      eligible: false;
      walletMode: "manual";
      errorCode:
        | "nwc_not_connected"
        | "nwc_disabled"
        | "nwc_decrypt_failed"
        | "nwc_missing";
      errorMessage: string;
    };

export interface WinnerPayoutInput {
  winnerPubkeyHex: string;
  amountSats: number;
  /** Optional. If not provided, will be derived from pubkey. */
  winnerNpub?: string | null;
  /** Optional. If already known, avoids profile fetch. */
  lnAddressSnapshot?: string | null;
}

export interface ExecuteCampaignPayoutBatchInput {
  scope: CampaignPayoutScope;
  contestId?: string;
  giveawayId?: string;
  creatorUserId: string;
  trigger: CampaignPayoutTrigger;
  walletMode: CampaignWalletMode;
  spendCapSats?: number | null;
  winners: WinnerPayoutInput[];
}

export interface ExecuteCampaignPayoutBatchResult {
  runId: string | null;
  walletMode: CampaignWalletMode;
  eligible: boolean;
  eligibilityErrorCode?: string;
  eligibilityErrorMessage?: string;
  totals: {
    items: number;
    paid: number;
    failed: number;
    claimNeeded: number;
    skipped: number;
  };
}

export interface ExecuteCampaignPayoutBatchStepResult extends ExecuteCampaignPayoutBatchResult {
  stepIndex: number;
  totalSteps: number;
  /** True when this response finished the last winner (or batch was ineligible). */
  done: boolean;
  /** Next step index to POST, or null when done. */
  nextStep: number | null;
}

interface PayoutDelta {
  paid: number;
  failed: number;
  claimNeeded: number;
  skipped: number;
}

function winnerAmountClass(value: number): "pay" | "skip" | "reject" {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    return "reject";
  if (value < 0) return "reject";
  if (value === 0) return "skip";
  return "pay";
}

function requestedWinners(
  winners: readonly WinnerPayoutInput[]
): BudgetWinner[] {
  return winners.flatMap((winner) =>
    winnerAmountClass(winner.amountSats) === "pay"
      ? [
          {
            winnerPubkey: winner.winnerPubkeyHex,
            amountSats: winner.amountSats,
          },
        ]
      : []
  );
}

async function recordWinnerIssue(args: {
  runId: string;
  winnerPubkey: string;
  amountSats: number;
  idempotencyKey: string;
  status: "claim_needed" | "failed";
  errorCode: string;
  errorMessage: string;
  lnAddressSnapshot?: string | null;
}): Promise<void> {
  await recordUnpayableCampaignItem(args);
}

async function reconcileHeldWinner(args: {
  nwc: string;
  claim: Extract<CampaignClaimResult, { ok: false }>;
}): Promise<PayoutDelta> {
  const neutral = { paid: 0, failed: 0, claimNeeded: 1, skipped: 0 };
  if (!args.claim.itemId) return neutral;
  const amountSats = args.claim.amountSats;
  const lookup =
    args.claim.paymentHash &&
    typeof amountSats === "number" &&
    Number.isSafeInteger(amountSats) &&
    amountSats > 0
      ? await lookupAuthorizedPayment({
          nwcUrl: args.nwc,
          paymentHash: args.claim.paymentHash,
          authorizedSats: amountSats,
          timeoutMs: nwcTimeouts().reconcileMs,
        })
      : { kind: "inconclusive" as const };
  if (lookup.kind === "settled" && lookup.preimage) {
    await settleCampaignPayoutAttempt({
      itemId: args.claim.itemId,
      outcome: "paid",
      preimage: lookup.preimage,
    });
    return { paid: 1, failed: 0, claimNeeded: 0, skipped: 0 };
  }
  if (args.claim.reason === "paying") {
    await settleCampaignPayoutAttempt({
      itemId: args.claim.itemId,
      outcome: "unknown",
      errorCode: "reconciliation_required",
      errorMessage:
        "Payment outcome is unknown. Automatic retry is blocked until the wallet is checked.",
    });
  }
  return neutral;
}

async function processOneWinnerForCampaignPayout(args: {
  runId: string;
  nwc: string;
  input: ExecuteCampaignPayoutBatchInput;
  w: WinnerPayoutInput;
  spendCapSats: number | null;
}): Promise<PayoutDelta> {
  const { runId, nwc, input, w, spendCapSats } = args;
  const amountClass = winnerAmountClass(w.amountSats);
  if (amountClass === "skip") {
    return { paid: 0, failed: 0, claimNeeded: 0, skipped: 1 };
  }
  if (amountClass === "reject") {
    return { paid: 0, failed: 1, claimNeeded: 0, skipped: 0 };
  }
  const amountSats = w.amountSats;

  const itemKey = winnerItemIdempotencyKey({
    scope: input.scope,
    contestId: input.contestId,
    giveawayId: input.giveawayId,
    winnerPubkeyHex: w.winnerPubkeyHex,
    amountSats,
  });
  const winnerNpub = (w.winnerNpub ?? "").trim()
    ? (w.winnerNpub ?? "").trim()
    : nostrAdapter.encodeNpub(w.winnerPubkeyHex);
  if (!winnerNpub) {
    await recordWinnerIssue({
      runId,
      winnerPubkey: w.winnerPubkeyHex,
      amountSats,
      idempotencyKey: itemKey,
      status: "claim_needed",
      errorCode: "missing_destination",
      errorMessage: "Invalid winner pubkey (cannot derive npub)",
    });
    return { paid: 0, failed: 0, claimNeeded: 1, skipped: 0 };
  }

  const inv = await resolveInvoiceForWinner({
    winnerNpub,
    amountSats,
    lnAddressSnapshot: w.lnAddressSnapshot ?? null,
  });
  if (!inv.ok) {
    await recordWinnerIssue({
      runId,
      winnerPubkey: w.winnerPubkeyHex,
      amountSats,
      idempotencyKey: itemKey,
      status: "claim_needed",
      errorCode: inv.code,
      errorMessage: inv.detail,
      lnAddressSnapshot: inv.lnAddressSnapshot,
    });
    return { paid: 0, failed: 0, claimNeeded: 1, skipped: 0 };
  }

  const decoded = assertBolt11MatchesAuthorizedAmount({
    invoice: inv.invoice,
    authorizedSats: amountSats,
  });
  if (!decoded.ok) {
    await recordWinnerIssue({
      runId,
      winnerPubkey: w.winnerPubkeyHex,
      amountSats,
      idempotencyKey: itemKey,
      status: "failed",
      errorCode: "invoice_rejected",
      errorMessage: decoded.error,
      lnAddressSnapshot: inv.lnAddressSnapshot,
    });
    return { paid: 0, failed: 1, claimNeeded: 0, skipped: 0 };
  }

  const timeouts = nwcTimeouts();
  const claim = await claimCampaignPayoutItem({
    runId,
    winnerPubkey: w.winnerPubkeyHex,
    amountSats,
    idempotencyKey: itemKey,
    invoice: decoded.invoice,
    paymentHash: decoded.paymentHash,
    invoiceExpiresAt: new Date(decoded.expiresAtMs),
    lnAddressSnapshot: inv.lnAddressSnapshot,
    requestedSpendCapSats: spendCapSats,
    requestedWinners: requestedWinners(input.winners),
    resolutionHoldMs: resolutionHoldMs(timeouts),
  });
  if (!claim.ok) {
    if (claim.reason === "already_paid" || claim.reason === "skipped") {
      return { paid: 0, failed: 0, claimNeeded: 0, skipped: 1 };
    }
    if (claim.reason === "paying" || claim.reason === "unknown") {
      return reconcileHeldWinner({ nwc, claim });
    }
    if (
      claim.reason === "budget_exhausted" ||
      claim.reason === "amount_mismatch" ||
      claim.reason === "duplicate_invoice"
    ) {
      await recordWinnerIssue({
        runId,
        winnerPubkey: w.winnerPubkeyHex,
        amountSats,
        idempotencyKey: itemKey,
        status: "failed",
        errorCode: claim.reason,
        errorMessage: claim.message ?? "Payout was refused before payment",
        lnAddressSnapshot: inv.lnAddressSnapshot,
      });
    }
    return { paid: 0, failed: 1, claimNeeded: 0, skipped: 0 };
  }

  const payRes = await payAuthorizedBolt11({
    nwcUrl: nwc,
    invoice: decoded.invoice,
    authorizedSats: amountSats,
    timeoutMs: timeouts.payMs,
    reconcileTimeoutMs: timeouts.reconcileMs,
  });
  if (!payRes.ok) {
    logError(new Error(payRes.message), {
      message: "Payout payInvoice failed",
      scope: input.scope,
      contestId: input.contestId ?? null,
      giveawayId: input.giveawayId ?? null,
      winnerPubkey: w.winnerPubkeyHex,
      disposition: payRes.disposition,
    });
    await settleCampaignPayoutAttempt({
      itemId: claim.itemId,
      attemptKey: claim.attemptKey,
      outcome: payRes.disposition === "unknown" ? "unknown" : "failed",
      errorCode: payRes.code,
      errorMessage: payRes.message,
    });
    if (payRes.disposition === "unknown") {
      return { paid: 0, failed: 0, claimNeeded: 1, skipped: 0 };
    }
    return { paid: 0, failed: 1, claimNeeded: 0, skipped: 0 };
  }

  await settleCampaignPayoutAttempt({
    itemId: claim.itemId,
    attemptKey: claim.attemptKey,
    outcome: "paid",
    preimage: payRes.preimage,
    walletResponse: payRes.walletResponse,
  });
  return { paid: 1, failed: 0, claimNeeded: 0, skipped: 0 };
}

function addDelta(
  acc: { paid: number; failed: number; claimNeeded: number; skipped: number },
  d: PayoutDelta
) {
  acc.paid += d.paid;
  acc.failed += d.failed;
  acc.claimNeeded += d.claimNeeded;
  acc.skipped += d.skipped;
}

function finalizeRunStatus(totals: {
  paid: number;
  failed: number;
  claimNeeded: number;
}): "complete" | "partial" | "failed" {
  const { paid, failed, claimNeeded } = totals;
  if (paid > 0 && failed === 0 && claimNeeded === 0) return "complete";
  if (paid > 0) return "partial";
  if (failed > 0) return "failed";
  return "partial";
}

type PayoutTx = Parameters<
  Parameters<typeof withPayoutLedgerTransaction>[0]
>[0];

function stableHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function campaignIdempotencyKey(input: {
  scope: CampaignPayoutScope;
  contestId?: string;
  giveawayId?: string;
}): string {
  if (input.scope === "CONTEST" && input.contestId) {
    return `contest:${input.contestId}`;
  }
  if (input.scope === "GIVEAWAY" && input.giveawayId) {
    return `giveaway:${input.giveawayId}`;
  }
  return `${input.scope.toLowerCase()}:unknown`;
}

function winnerItemIdempotencyKey(args: {
  scope: CampaignPayoutScope;
  contestId?: string;
  giveawayId?: string;
  winnerPubkeyHex: string;
  amountSats: number;
}): string {
  const campaignKey = campaignIdempotencyKey(args);
  return stableHash(
    `${campaignKey}:winner:${args.winnerPubkeyHex}:amount:${args.amountSats}`
  );
}

function lud16ToLnurlPayUrl(lud16: string): string | null {
  const trimmed = lud16.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const user = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return `https://${domain}/.well-known/lnurlp/${user}`;
}

async function fetchLud16ForNpub(npub: string): Promise<string | null> {
  try {
    const primalData = await fetchPrimalProfileData(npub);
    const { profile } = processPrimalData(primalData);
    return typeof profile.lud16 === "string" && profile.lud16.trim() !== ""
      ? profile.lud16.trim()
      : null;
  } catch {
    return null;
  }
}

async function resolveInvoiceForWinner(args: {
  winnerNpub: string;
  amountSats: number;
  lnAddressSnapshot?: string | null;
}): Promise<
  | { ok: true; lnAddressSnapshot: string; invoice: string }
  | {
      ok: false;
      code: "missing_destination" | "invoice_fetch_failed";
      detail: string;
      lnAddressSnapshot?: string;
    }
> {
  const snapshotAddress = args.lnAddressSnapshot?.trim();
  const fetchedAddress = snapshotAddress
    ? null
    : await fetchLud16ForNpub(args.winnerNpub);
  const lnAddress = snapshotAddress ?? fetchedAddress ?? "";
  if (!lnAddress) {
    return {
      ok: false,
      code: "missing_destination",
      detail: "Winner has no Lightning address",
    };
  }
  const lnurlPayUrl = lud16ToLnurlPayUrl(lnAddress);
  if (!lnurlPayUrl) {
    return {
      ok: false,
      code: "missing_destination",
      detail: "Winner Lightning address is not a LUD-16 address",
      lnAddressSnapshot: lnAddress,
    };
  }
  const invoice = await fetchLnurlPayInvoice(lnurlPayUrl, args.amountSats);
  if (!invoice.ok) {
    return {
      ok: false,
      code:
        invoice.code === "invalid_destination"
          ? "missing_destination"
          : "invoice_fetch_failed",
      detail: invoice.detail,
      lnAddressSnapshot: lnAddress,
    };
  }
  return { ok: true, lnAddressSnapshot: lnAddress, invoice: invoice.invoice };
}

async function getEligibility(
  creatorUserId: string,
  walletMode: CampaignWalletMode
): Promise<PayoutEligibility> {
  if (walletMode !== "nwc_creator") {
    return {
      eligible: false,
      walletMode: "manual",
      errorCode: "nwc_disabled",
      errorMessage: "Payout method is manual",
    };
  }
  const decrypted = await getDecryptedUserNWC(creatorUserId);
  if (!decrypted) {
    return {
      eligible: false,
      walletMode: "manual",
      errorCode: "nwc_not_connected",
      errorMessage: "Creator has no connected NWC wallet",
    };
  }
  return { eligible: true, walletMode: "nwc_creator", nwc: decrypted };
}

async function ensureRun(tx: PayoutTx, input: ExecuteCampaignPayoutBatchInput) {
  const idKey = campaignIdempotencyKey(input);
  const spendCap = readSpendCap(input.spendCapSats);
  return findOrCreatePayoutRunByIdempotencyKey(tx, {
    idempotencyKey: idKey,
    scope: input.scope,
    userId: input.creatorUserId,
    walletMode: input.walletMode,
    trigger: input.trigger,
    contestId: input.contestId ?? null,
    giveawayId: input.giveawayId ?? null,
    spendCapSats: spendCap.ok ? spendCap.spendCapSats : null,
    totalItems: input.winners.length,
    totalSats: sumPayableSats(input.winners.map((winner) => winner.amountSats)),
  });
}

function invalidSpendCapResult(
  input: ExecuteCampaignPayoutBatchInput,
  runId: string,
  message: string
): ExecuteCampaignPayoutBatchResult {
  return {
    runId,
    walletMode: input.walletMode,
    eligible: true,
    eligibilityErrorCode: "invalid_spend_cap",
    eligibilityErrorMessage: message,
    totals: {
      items: input.winners.length,
      paid: 0,
      failed: input.winners.length,
      claimNeeded: 0,
      skipped: 0,
    },
  };
}

export async function executeCampaignPayoutBatch(
  input: ExecuteCampaignPayoutBatchInput
): Promise<ExecuteCampaignPayoutBatchResult> {
  const eligibility = await getEligibility(
    input.creatorUserId,
    input.walletMode
  );

  // Always create the run record (idempotent per campaign) so UI/cron can explain why nothing happened.
  const run = await withPayoutLedgerTransaction(async (tx) => {
    const r = await ensureRun(tx, input);
    if (!eligibility.eligible) {
      await updatePayoutRun(
        r.id,
        {
          status: "skipped",
          eligibilityErrorCode: eligibility.errorCode,
          eligibilityErrorMessage: eligibility.errorMessage,
          completedAt: new Date(),
        },
        tx
      );
    } else {
      await updatePayoutRun(
        r.id,
        {
          status: "running",
          startedAt: r.startedAt ?? new Date(),
          eligibilityErrorCode: null,
          eligibilityErrorMessage: null,
        },
        tx
      );
    }
    return r;
  });

  if (!eligibility.eligible) {
    return {
      runId: run.id,
      walletMode: "manual",
      eligible: false,
      eligibilityErrorCode: eligibility.errorCode,
      eligibilityErrorMessage: eligibility.errorMessage,
      totals: {
        items: input.winners.length,
        paid: 0,
        failed: 0,
        claimNeeded: 0,
        skipped: input.winners.length,
      },
    };
  }

  const spendCap = readSpendCap(input.spendCapSats);
  if (!spendCap.ok) {
    await updatePayoutRun(run.id, {
      status: "failed",
      eligibilityErrorCode: "invalid_spend_cap",
      eligibilityErrorMessage: spendCap.error,
      completedAt: new Date(),
    });
    return invalidSpendCapResult(input, run.id, spendCap.error);
  }

  const nwc = eligibility.nwc;
  const totals = { paid: 0, failed: 0, claimNeeded: 0, skipped: 0 };

  for (const w of input.winners) {
    const delta = await processOneWinnerForCampaignPayout({
      runId: run.id,
      nwc,
      input,
      w,
      spendCapSats: spendCap.spendCapSats,
    });
    addDelta(totals, delta);
  }

  const totalItems = input.winners.length;
  const finalStatus = finalizeRunStatus(totals);

  await updatePayoutRun(run.id, {
    status: finalStatus,
    completedAt: new Date(),
    totalItems,
    totalSats: sumPayableSats(input.winners.map((winner) => winner.amountSats)),
    metadataJson: { ...totals },
  });

  return {
    runId: run.id,
    walletMode: "nwc_creator",
    eligible: true,
    totals: { items: totalItems, ...totals },
  };
}

/**
 * Process a single winner row (by index) so the client can refresh UI between payments.
 * Step 0 creates/updates the run; later steps reuse the same run idempotency key.
 */
export async function executeCampaignPayoutBatchStep(
  input: ExecuteCampaignPayoutBatchInput,
  stepIndex: number
): Promise<ExecuteCampaignPayoutBatchStepResult> {
  const totalSteps = input.winners.length;
  const idKey = campaignIdempotencyKey(input);

  if (totalSteps === 0 || stepIndex < 0 || stepIndex >= totalSteps) {
    return {
      runId: null,
      walletMode: "nwc_creator",
      eligible: false,
      eligibilityErrorCode: "nwc_missing",
      eligibilityErrorMessage: "No winners to process",
      totals: { items: 0, paid: 0, failed: 0, claimNeeded: 0, skipped: 0 },
      stepIndex: Math.max(0, stepIndex),
      totalSteps: 0,
      done: true,
      nextStep: null,
    };
  }

  const eligibility = await getEligibility(
    input.creatorUserId,
    input.walletMode
  );

  let runId: string;

  if (stepIndex === 0) {
    const run = await withPayoutLedgerTransaction(async (tx) => {
      const r = await ensureRun(tx, input);
      if (!eligibility.eligible) {
        await updatePayoutRun(
          r.id,
          {
            status: "skipped",
            eligibilityErrorCode: eligibility.errorCode,
            eligibilityErrorMessage: eligibility.errorMessage,
            completedAt: new Date(),
          },
          tx
        );
      } else {
        await updatePayoutRun(
          r.id,
          {
            status: "running",
            startedAt: r.startedAt ?? new Date(),
            eligibilityErrorCode: null,
            eligibilityErrorMessage: null,
          },
          tx
        );
      }
      return r;
    });
    runId = run.id;

    if (!eligibility.eligible) {
      return {
        runId,
        walletMode: "manual",
        eligible: false,
        eligibilityErrorCode: eligibility.errorCode,
        eligibilityErrorMessage: eligibility.errorMessage,
        totals: {
          items: totalSteps,
          paid: 0,
          failed: 0,
          claimNeeded: 0,
          skipped: totalSteps,
        },
        stepIndex: 0,
        totalSteps,
        done: true,
        nextStep: null,
      };
    }
  } else {
    const existing = await findPayoutRunByIdempotencyKey(idKey);
    if (!existing) {
      return {
        runId: null,
        walletMode: "nwc_creator",
        eligible: false,
        eligibilityErrorCode: "nwc_missing",
        eligibilityErrorMessage:
          "Payout run not found  -  start batch from step 0",
        totals: {
          items: totalSteps,
          paid: 0,
          failed: 0,
          claimNeeded: 0,
          skipped: 0,
        },
        stepIndex,
        totalSteps,
        done: true,
        nextStep: null,
      };
    }
    runId = existing.id;

    if (!eligibility.eligible) {
      return {
        runId,
        walletMode: "manual",
        eligible: false,
        eligibilityErrorCode: eligibility.errorCode,
        eligibilityErrorMessage: eligibility.errorMessage,
        totals: {
          items: totalSteps,
          paid: 0,
          failed: 0,
          claimNeeded: 0,
          skipped: totalSteps,
        },
        stepIndex,
        totalSteps,
        done: true,
        nextStep: null,
      };
    }
  }

  const spendCap = readSpendCap(input.spendCapSats);
  if (!spendCap.ok) {
    await updatePayoutRun(runId, {
      status: "failed",
      eligibilityErrorCode: "invalid_spend_cap",
      eligibilityErrorMessage: spendCap.error,
      completedAt: new Date(),
    });
    return {
      ...invalidSpendCapResult(input, runId, spendCap.error),
      stepIndex,
      totalSteps,
      done: true,
      nextStep: null,
    };
  }

  const nwc = eligibility.nwc;
  const existingRun = await findPayoutRunByIdempotencyKey(idKey);
  const prevMeta =
    (existingRun?.metadataJson as Record<string, number> | null) ?? {};
  const cumulative = {
    paid: prevMeta["paid"] ?? 0,
    failed: prevMeta["failed"] ?? 0,
    claimNeeded: prevMeta["claimNeeded"] ?? 0,
    skipped: prevMeta["skipped"] ?? 0,
  };

  const w = input.winners[stepIndex]!;
  const delta = await processOneWinnerForCampaignPayout({
    runId,
    nwc,
    input,
    w,
    spendCapSats: spendCap.spendCapSats,
  });
  addDelta(cumulative, delta);

  const done = stepIndex >= totalSteps - 1;
  const totalItems = totalSteps;
  const totalSats = sumPayableSats(
    input.winners.map((winner) => winner.amountSats)
  );

  if (done) {
    const finalStatus = finalizeRunStatus(cumulative);
    await updatePayoutRun(runId, {
      status: finalStatus,
      completedAt: new Date(),
      totalItems,
      totalSats,
      metadataJson: { ...cumulative },
    });
  } else {
    await updatePayoutRun(runId, {
      status: "running",
      metadataJson: {
        ...cumulative,
        currentStep: stepIndex,
        totalSteps,
      },
    });
  }

  return {
    runId,
    walletMode: "nwc_creator",
    eligible: true,
    totals: { items: totalItems, ...cumulative },
    stepIndex,
    totalSteps,
    done,
    nextStep: done ? null : stepIndex + 1,
  };
}
