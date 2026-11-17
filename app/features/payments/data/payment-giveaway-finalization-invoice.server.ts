import { LN, SATS } from "@getalby/sdk/lnclient";

import { appendGiveawayActivityLog } from "~/features/giveaway/giveaway-activity-log.server";
import { quoteGiveawayFinalization } from "~/features/giveaway/giveaway-finalization-fee.server";
import { findGiveawayByIdAndUser } from "~/features/giveaway/repositories/giveaway-actions-data.server";
import {
  expireGiveawayFinalizationByIds,
  findReusableGiveawayFinalizationInvoice,
  listGiveawayFinalizationRecords,
} from "~/features/giveaway/repositories/giveaway-finalization-payment.server";
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

const NO_GIVEAWAY_FINALIZATION_FEE =
  "No finalization fee is due for this giveaway";

export interface GiveawayFinalizationInvoiceResponse {
  invoice: string;
  paymentHash: string;
  amount: number;
  amountUsd: null;
  expiresAt: Date;
  paymentId: string;
  lockConfigHash: string;
}

/**
 * Lightning invoice for giveaway finalization fee (sats). Reuses Payment + GiveawayFinalizationPayment.
 */
export async function createGiveawayFinalizationInvoice(params: {
  giveawayId: string;
  userId: string;
  /** Client hash must match server recomputation (stale preview guard). */
  lockConfigHash: string;
}): Promise<GiveawayFinalizationInvoiceResponse> {
  const { giveawayId, userId, lockConfigHash: clientHash } = params;

  const g = await findGiveawayByIdAndUser(giveawayId, userId);
  if (!g) {
    throw new Error("Giveaway not found");
  }
  if (g.status !== "PREVIEWED") {
    throw new Error("Only previewed giveaways can pay a finalization fee");
  }

  const subscription = await getUserSubscription(userId);
  const planType = getUserPlanType(subscription as UserSubscription | null);
  const quote = quoteGiveawayFinalization({
    giveaway: {
      winnerSnapshot: g.winnerSnapshot,
      engagementConfig: g.engagementConfig,
      winnerCount: g.winnerCount,
      plannedPayoutSats: g.plannedPayoutSats,
      selectionMode: g.selectionMode,
      scopeType: g.scopeType,
      scopeReference: g.scopeReference,
      engagementTypes: g.engagementTypes,
      filters: g.filters,
      engagementWeights: g.engagementWeights,
    },
    planType,
  });

  if (clientHash !== quote.lockConfigHash) {
    throw new Error(
      "This preview changed after the fee was quoted. Refresh and try again."
    );
  }

  const records = await listGiveawayFinalizationRecords(giveawayId, userId);
  const collection = resolveFinalizationCollection({
    current: quote,
    records,
    nowMs: Date.now(),
  });

  if (collection.kind === "waived" || collection.quote.feeSats <= 0) {
    await expireGiveawayFinalizationByIds(
      collection.kind === "waived" ? collection.expireIds : []
    );
    throw new Error(NO_GIVEAWAY_FINALIZATION_FEE);
  }

  if (collection.kind === "settled") {
    throw new Error("The finalization fee for this preview is already paid");
  }

  if (collection.kind === "honor_pending") {
    const existing = acceptedStoredFinalizationInvoice(
      await findReusableGiveawayFinalizationInvoice(collection.paymentId),
      collection.quote.feeSats
    );
    if (existing) {
      return {
        ...existing,
        amountUsd: null,
        lockConfigHash: collection.quote.lockConfigHash,
      };
    }
    await expireGiveawayFinalizationByIds([collection.recordId]);
  }

  const due = collection.quote;
  if (due.feeSats <= 0) {
    throw new Error(NO_GIVEAWAY_FINALIZATION_FEE);
  }

  const credentials = env.OWNER_NWC;
  if (!credentials) {
    throw new Error(OWNER_NWC_MISSING);
  }

  const { credentials: ownerNwcCredentials, relays: ownerRelays } =
    getOwnerNwcWithRelayOverrides(credentials);
  const ln = new LN(ownerNwcCredentials) as unknown as {
    requestPayment: (amount: { amount: number }) => Promise<{
      onPaid: (callback: () => void) => {
        onTimeout: (seconds: number, callback: () => void) => void;
      };
      onTimeout: (seconds: number, callback: () => void) => void;
    }>;
  };

  const lockKey = `giveaway-finalization:${giveawayId}:${due.lockConfigHash}`;
  try {
    const created = await runLockedFinalizationCreate(lockKey, async (tx) => {
      const again = resolveFinalizationCollection({
        current: due,
        records: await listGiveawayFinalizationRecords(giveawayId, userId),
        nowMs: Date.now(),
      });
      if (again.kind === "settled") {
        throw new Error(
          "The finalization fee for this preview is already paid"
        );
      }
      if (again.kind === "honor_pending") {
        const existing = acceptedStoredFinalizationInvoice(
          await findReusableGiveawayFinalizationInvoice(again.paymentId),
          again.quote.feeSats
        );
        if (existing) {
          return {
            response: {
              ...existing,
              amountUsd: null,
              lockConfigHash: again.quote.lockConfigHash,
            },
            attach() {
              return;
            },
          };
        }
      }
      if (again.kind !== "collect" || again.quote.feeSats !== due.feeSats) {
        throw new Error(NO_GIVEAWAY_FINALIZATION_FEE);
      }
      await expireGiveawayFinalizationByIds(again.expireIds);
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
      const paymentId = `gf_${giveawayId}_${Date.now()}_${userId}`;
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
          purpose: "GIVEAWAY_FINALIZATION",
          description: `Giveaway finalization: ${giveawayId}`,
          expiresAt,
        },
      });
      await tx.giveawayFinalizationPayment.create({
        data: {
          giveawayId,
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
      await tx.giveaway.update({
        where: { id: giveawayId },
        data: {
          activityLog: appendGiveawayActivityLog(g.activityLog, "fee_quoted", {
            feeSats: due.feeSats,
            feeRateBps: due.feeRateBps,
            plannedPayoutSats: due.plannedPayoutSats,
            planName: planLabel,
            lockConfigHash: due.lockConfigHash,
          }),
        },
      });
      const timeoutSeconds = Math.max(
        1,
        Math.floor((expiresAtMs - Date.now()) / 1000)
      );
      return {
        response: {
          invoice: accepted.invoice,
          paymentHash: accepted.paymentHash,
          amount: accepted.amountSats,
          amountUsd: null,
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
      const again = resolveFinalizationCollection({
        current: due,
        records: await listGiveawayFinalizationRecords(giveawayId, userId),
        nowMs: Date.now(),
      });
      if (again.kind === "honor_pending") {
        const existing = acceptedStoredFinalizationInvoice(
          await findReusableGiveawayFinalizationInvoice(again.paymentId),
          again.quote.feeSats
        );
        if (existing) {
          return {
            ...existing,
            amountUsd: null,
            lockConfigHash: again.quote.lockConfigHash,
          };
        }
      }
    }
    if (error instanceof ExternalServiceError) {
      logError(error, {
        giveawayId,
        userId,
        ownerRelays,
        message: "Failed to create giveaway finalization invoice",
      });
      throw error;
    }

    const err = error instanceof Error ? error : new Error(String(error));
    logError(err, {
      giveawayId,
      userId,
      ownerRelays,
      message: "Failed to create giveaway finalization invoice",
    });

    if (isLikelyWebsocketRelayError(err.message)) {
      throw new ExternalServiceError(
        "Payments are temporarily unavailable (cannot reach the Lightning relay). Please try again in a few minutes.",
        503,
        {
          giveawayId,
          userId,
          ownerRelays,
          originalError: err.message,
        }
      );
    }

    throw new ExternalServiceError(
      "Failed to create payment invoice. Please try again later.",
      502,
      {
        giveawayId,
        userId,
        ownerRelays,
        originalError: err.message,
      }
    );
  }
}
