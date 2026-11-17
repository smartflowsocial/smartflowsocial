import { LN, SATS } from "@getalby/sdk/lnclient";

import { appendContestEventLog } from "~/features/contest/contest-actions-crud.server";
import { getContestById } from "~/features/contest/contest-actions-queries.server";
import { quoteContestFinalization } from "~/features/contest/contest-finalization-fee.server";
import {
  expireContestFinalizationByIds,
  findReusableContestFinalizationInvoice,
  listContestFinalizationRecords,
} from "~/features/contest/repositories/contest-finalization-payment.server";
import type { ContestRankReward } from "~/features/contest/types";
import { resolveFinalizationCollection } from "~/features/payments/campaign-finalization-charge";
import {
  acceptFinalizationWalletInvoice,
  acceptedStoredFinalizationInvoice,
} from "~/features/payments/finalization-invoice-guard";
import type { UserSubscription } from "~/features/payments/types";
import { getPlanDisplayName, getUserPlanType } from "~/features/payments/types";
import { env } from "~/lib/env.server";
import { logError } from "~/lib/error-logger.server";
import { ExternalServiceError } from "~/lib/errors";

import {
  isUniqueConstraintError,
  runLockedFinalizationCreate,
} from "./finalization-invoice-lock.server";
import {
  OWNER_NWC_MISSING,
  withOwnerWalletInvoiceRequestTimeout,
} from "./payment-owner-wallet-invoice-timeout.server";
import {
  getOwnerNwcWithRelayOverrides,
  isLikelyWebsocketRelayError,
} from "./payment-shared.server";
import {
  handlePaymentCompleted,
  handlePaymentTimeout,
} from "./payment.handlers.server";
import { getUserSubscription } from "./payment.queries.server";

const NO_CONTEST_FINALIZATION_FEE =
  "No finalization fee is due for this contest";

async function recoverContestFinalizationRace(args: {
  contestId: string;
  userId: string;
  current: Parameters<typeof resolveFinalizationCollection>[0]["current"];
}): Promise<ContestFinalizationInvoiceResponse | null> {
  const again = resolveFinalizationCollection({
    current: args.current,
    records: await listContestFinalizationRecords(args.contestId, args.userId),
    nowMs: Date.now(),
  });
  if (again.kind !== "honor_pending") return null;
  const existing = acceptedStoredFinalizationInvoice(
    await findReusableContestFinalizationInvoice(again.paymentId),
    again.quote.feeSats
  );
  if (!existing) return null;
  return {
    ...existing,
    lockConfigHash: again.quote.lockConfigHash,
  };
}

export interface ContestFinalizationInvoiceResponse {
  invoice: string;
  paymentHash: string;
  amount: number;
  expiresAt: Date;
  paymentId: string;
  lockConfigHash: string;
}

/**
 * Lightning invoice for a contest finalization fee. A zero fee never calls
 * the operator wallet. An already-open invoice at the same or lower amount
 * is returned instead of creating another one.
 */
export async function createContestFinalizationInvoice(params: {
  contestId: string;
  userId: string;
  lockConfigHash: string;
}): Promise<ContestFinalizationInvoiceResponse> {
  const { contestId, userId, lockConfigHash: clientHash } = params;
  const contest = await getContestById(contestId, userId);
  if (!contest) throw new Error("Contest not found");
  if (contest.status !== "ENDED_REVIEW") {
    throw new Error("Only contests in review can pay a finalization fee");
  }
  const sourceNoteId = contest.sourceNoteId?.trim() ?? "";
  if (!sourceNoteId) throw new Error("Contest is missing a source note id.");

  const subscription = await getUserSubscription(userId);
  const planType = getUserPlanType(subscription as UserSubscription | null);
  const quote = quoteContestFinalization({
    contest: {
      sourceNoteId,
      rankingMetric: contest.rankingMetric,
      contestEndAt: contest.contestEndAt,
      prizeMode: contest.prizeMode,
      winnerCount: contest.winnerCount,
      equalRewardSats: contest.equalRewardSats,
      rankRewards: (contest.rankRewards as ContestRankReward[] | null) ?? [],
      fairnessConfig: contest.fairnessConfig,
      tieBreakRule: contest.tieBreakRule,
      snapshotId: contest.freezeSnapshotAt?.toISOString() ?? null,
    },
    planType,
  });
  if (clientHash !== quote.lockConfigHash) {
    throw new Error(
      "This preview changed after the fee was quoted. Refresh and try again."
    );
  }

  const records = await listContestFinalizationRecords(contestId, userId);
  const collection = resolveFinalizationCollection({
    current: quote,
    records,
    nowMs: Date.now(),
  });
  if (collection.kind === "waived" || collection.quote.feeSats <= 0) {
    await expireContestFinalizationByIds(
      collection.kind === "waived" ? collection.expireIds : []
    );
    throw new Error(NO_CONTEST_FINALIZATION_FEE);
  }
  if (collection.kind === "settled") {
    throw new Error("The finalization fee for this preview is already paid");
  }
  if (collection.kind === "honor_pending") {
    const existing = acceptedStoredFinalizationInvoice(
      await findReusableContestFinalizationInvoice(collection.paymentId),
      collection.quote.feeSats
    );
    if (existing) {
      return {
        ...existing,
        lockConfigHash: collection.quote.lockConfigHash,
      };
    }
    await expireContestFinalizationByIds([collection.recordId]);
  }

  const due = collection.quote;
  if (due.feeSats <= 0) {
    throw new Error(NO_CONTEST_FINALIZATION_FEE);
  }

  const credentials = env.OWNER_NWC;
  if (!credentials) throw new Error(OWNER_NWC_MISSING);

  const { credentials: ownerNwcCredentials, relays: ownerRelays } =
    getOwnerNwcWithRelayOverrides(credentials);
  const ln = new LN(ownerNwcCredentials) as unknown as {
    requestPayment: (amount: { amount: number }) => Promise<{
      onPaid: (callback: () => void) => {
        onTimeout: (seconds: number, callback: () => void) => void;
      };
    }>;
  };

  const lockKey = `contest-finalization:${contestId}:${due.lockConfigHash}`;
  try {
    const created = await runLockedFinalizationCreate(lockKey, async (tx) => {
      const again = resolveFinalizationCollection({
        current: due,
        records: await listContestFinalizationRecords(contestId, userId),
        nowMs: Date.now(),
      });
      if (again.kind === "settled") {
        throw new Error(
          "The finalization fee for this preview is already paid"
        );
      }
      if (again.kind === "honor_pending") {
        const existing = acceptedStoredFinalizationInvoice(
          await findReusableContestFinalizationInvoice(again.paymentId),
          again.quote.feeSats
        );
        if (existing) {
          return {
            response: {
              ...existing,
              lockConfigHash: again.quote.lockConfigHash,
            },
            attach() {
              return;
            },
          };
        }
      }
      if (again.kind !== "collect" || again.quote.feeSats !== due.feeSats) {
        throw new Error(NO_CONTEST_FINALIZATION_FEE);
      }
      await expireContestFinalizationByIds(again.expireIds);
      const request = await withOwnerWalletInvoiceRequestTimeout(
        ln.requestPayment(SATS(due.feeSats) as unknown as { amount: number })
      );
      const accepted = acceptFinalizationWalletInvoice({
        request,
        authorizedSats: due.feeSats,
      });
      if (!accepted.ok) {
        throw new Error(
          `Invalid response from payment provider - ${accepted.error}`
        );
      }
      const paymentId = `cf_${contestId}_${Date.now()}_${userId}`;
      const expiresAtMs = Math.min(
        accepted.expiresAtMs,
        Date.now() + 30 * 60 * 1000
      );
      const expiresAt = new Date(expiresAtMs);
      const planLabel = getPlanDisplayName(
        subscription as UserSubscription | null
      );
      await tx.payment.create({
        data: {
          id: paymentId,
          userId,
          amount: accepted.amountSats,
          amountUsd: null,
          invoice: accepted.invoice,
          paymentHash: accepted.paymentHash,
          status: "PENDING",
          purpose: "CONTEST_FINALIZATION",
          description: `Contest finalization: ${contestId}`,
          expiresAt,
        },
      });
      await tx.contestFinalizationPayment.create({
        data: {
          contestId,
          userId,
          planName: planLabel,
          feeRateBps: due.feeRateBps,
          plannedPayoutSats: due.plannedPayoutSats,
          feeSats: due.feeSats,
          lockConfigHash: due.lockConfigHash,
          status: "PENDING",
          paymentId,
        },
      });
      await appendContestEventLog(
        userId,
        contestId,
        "fee_quoted",
        "Finalization fee invoice created",
        { feeSats: due.feeSats, feeRateBps: due.feeRateBps }
      );
      const timeoutSeconds = Math.max(
        1,
        Math.floor((expiresAtMs - Date.now()) / 1000)
      );
      return {
        response: {
          invoice: accepted.invoice,
          paymentHash: accepted.paymentHash,
          amount: accepted.amountSats,
          expiresAt,
          paymentId,
          lockConfigHash: due.lockConfigHash,
        },
        attach: () => {
          request
            .onPaid(() => {
              void handlePaymentCompleted(paymentId, userId, "");
            })
            .onTimeout(timeoutSeconds, () => {
              void handlePaymentTimeout(paymentId);
            });
        },
      };
    });
    created.attach();
    return created.response;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const recovered = await recoverContestFinalizationRace({
        contestId,
        userId,
        current: due,
      });
      if (recovered) return recovered;
    }
    if (error instanceof ExternalServiceError) throw error;
    const err = error instanceof Error ? error : new Error(String(error));
    logError(err, {
      contestId,
      userId,
      ownerRelays,
      message: "Failed to create contest finalization invoice",
    });
    if (isLikelyWebsocketRelayError(err.message)) {
      throw new ExternalServiceError(
        "Payments are temporarily unavailable (cannot reach the Lightning relay). Please try again in a few minutes.",
        503,
        { contestId, userId, ownerRelays, originalError: err.message }
      );
    }
    if (
      err.message.startsWith("Invalid response") ||
      err.message.startsWith("Contest") ||
      err.message.startsWith("No finalization") ||
      err.message.startsWith("The finalization") ||
      err.message.startsWith("This preview") ||
      err.message === OWNER_NWC_MISSING
    ) {
      throw err;
    }
    throw new ExternalServiceError(
      "Failed to create payment invoice. Please try again later.",
      502,
      { contestId, userId, ownerRelays, originalError: err.message }
    );
  }
}
