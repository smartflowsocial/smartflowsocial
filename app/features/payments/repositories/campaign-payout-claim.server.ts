import crypto from "node:crypto";

import type { PayoutItemStatus } from "@prisma/client";

import {
  authorizedCampaignBudgetSats,
  budgetAllowsNextPayment,
  reservedPayoutSats,
  tighterSpendCap,
  type BudgetItem,
  type BudgetWinner,
} from "~/features/payments/campaign-payout-budget";
import { unpaidResolutionAllowed } from "~/features/payments/campaign-payout-resolution";
import { isNonNegativeWholeSats } from "~/features/referral/bolt11-invoice.server";
import { prisma } from "~/lib/prisma.server";

const CLAIMABLE_STATUSES = ["pending", "failed", "claim_needed"] as const;

export interface ClaimCampaignPayoutItemArgs {
  runId: string;
  winnerPubkey: string;
  amountSats: number;
  idempotencyKey: string;
  invoice: string;
  paymentHash: string;
  invoiceExpiresAt: Date;
  lnAddressSnapshot: string;
  requestedSpendCapSats: number | null;
  requestedWinners: readonly BudgetWinner[];
}

export type CampaignClaimResult =
  | {
      ok: true;
      itemId: string;
      attemptKey: string;
      attemptNumber: number;
    }
  | {
      ok: false;
      reason:
        | "already_paid"
        | "skipped"
        | "paying"
        | "unknown"
        | "amount_mismatch"
        | "budget_exhausted"
        | "duplicate_invoice"
        | "not_claimable";
      message?: string;
      itemId?: string;
      paymentHash?: string | null;
      amountSats?: number;
    };

interface LockedItem {
  id: string;
  winnerPubkey: string;
  amountSats: number;
  status: string;
  paymentHash: string | null;
  attemptCount: number;
}

function stableHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  if (code === "P2002" || code === "23505") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("23505");
}

function heldResult(item: LockedItem): CampaignClaimResult | null {
  if (item.status === "paid") {
    return {
      ok: false,
      reason: "already_paid",
      itemId: item.id,
      paymentHash: item.paymentHash,
      amountSats: item.amountSats,
    };
  }
  if (item.status === "skipped") {
    return { ok: false, reason: "skipped", itemId: item.id };
  }
  if (item.status === "paying" || item.status === "unknown") {
    return {
      ok: false,
      reason: item.status,
      itemId: item.id,
      paymentHash: item.paymentHash,
      amountSats: item.amountSats,
      message:
        "This payout may already have been sent. Automatic retry is blocked.",
    };
  }
  return null;
}

/**
 * Claims one winner under the campaign row lock.
 * The wallet is not called here. A returned `ok` means this caller is the
 * only one allowed to submit the invoice. `paying` and `unknown` do not claim.
 */
export async function claimCampaignPayoutItem(
  args: ClaimCampaignPayoutItemArgs
): Promise<CampaignClaimResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "PayoutRun" WHERE id = ${args.runId} FOR UPDATE
      `;
      if (locked.length === 0) {
        return {
          ok: false,
          reason: "not_claimable",
          message: "Payout run was not found",
        };
      }

      await tx.$executeRaw`
        INSERT INTO "PayoutItem" (
          "id",
          "runId",
          "winnerPubkey",
          "amountSats",
          "idempotencyKey",
          "status",
          "attemptCount",
          "createdAt",
          "updatedAt"
        ) VALUES (
          ${crypto.randomUUID()},
          ${args.runId},
          ${args.winnerPubkey},
          ${args.amountSats},
          ${args.idempotencyKey},
          'pending'::"PayoutItemStatus",
          0,
          NOW(),
          NOW()
        )
        ON CONFLICT ("runId", "winnerPubkey") DO NOTHING
      `;

      const items = await tx.$queryRaw<LockedItem[]>`
        SELECT
          id,
          "winnerPubkey",
          "amountSats",
          status::text AS status,
          "paymentHash",
          "attemptCount"
        FROM "PayoutItem"
        WHERE "runId" = ${args.runId}
        FOR UPDATE
      `;
      const item = items.find((row) => row.winnerPubkey === args.winnerPubkey);
      if (!item) {
        return {
          ok: false,
          reason: "not_claimable",
          message: "Payout item was not found",
        };
      }
      const held = heldResult(item);
      if (held) return held;
      if (!(CLAIMABLE_STATUSES as readonly string[]).includes(item.status)) {
        return {
          ok: false,
          reason: "not_claimable",
          itemId: item.id,
          message: "Payout item cannot be claimed",
        };
      }
      if (item.amountSats !== args.amountSats) {
        return {
          ok: false,
          reason: "amount_mismatch",
          itemId: item.id,
          amountSats: item.amountSats,
          message: "Winner allocation does not match the stored payout amount",
        };
      }

      const run = await tx.payoutRun.findUnique({
        where: { id: args.runId },
        select: { spendCapSats: true },
      });
      const storedCap =
        run?.spendCapSats !== null &&
        run?.spendCapSats !== undefined &&
        isNonNegativeWholeSats(run.spendCapSats)
          ? run.spendCapSats
          : null;
      const tightened = tighterSpendCap(storedCap, args.requestedSpendCapSats);
      if (tightened !== null && tightened !== storedCap) {
        await tx.payoutRun.update({
          where: { id: args.runId },
          data: { spendCapSats: tightened },
        });
      }

      const budgetItems: BudgetItem[] = items.map((row) => ({
        winnerPubkey: row.winnerPubkey,
        amountSats: row.amountSats,
        status: row.status,
      }));
      const budget = authorizedCampaignBudgetSats({
        spendCapSats: tightened,
        items: budgetItems,
        requested: args.requestedWinners,
      });
      if (!budget.ok) {
        return {
          ok: false,
          reason: "budget_exhausted",
          itemId: item.id,
          message: budget.error,
        };
      }
      const reserved = reservedPayoutSats(budgetItems, item.winnerPubkey);
      if (reserved === null) {
        return {
          ok: false,
          reason: "budget_exhausted",
          itemId: item.id,
          message: "Campaign budget amounts are not whole sats",
        };
      }
      const allowed = budgetAllowsNextPayment({
        capSats: budget.capSats,
        reservedSats: reserved,
        nextSats: args.amountSats,
      });
      if (!allowed.ok) {
        return {
          ok: false,
          reason: "budget_exhausted",
          itemId: item.id,
          message: allowed.error,
        };
      }

      const hashOwner = await tx.payoutItem.findFirst({
        where: {
          paymentHash: args.paymentHash,
          NOT: { id: item.id },
        },
        select: { id: true },
      });
      if (hashOwner) {
        return {
          ok: false,
          reason: "duplicate_invoice",
          message: "This invoice was already used for a payout",
        };
      }

      const attemptNumber = item.attemptCount + 1;
      const attemptKey = stableHash(`${item.id}:attempt:${attemptNumber}`);
      const updated = await tx.payoutItem.updateMany({
        where: {
          id: item.id,
          status: { in: [...CLAIMABLE_STATUSES] },
        },
        data: {
          status: "paying",
          invoice: args.invoice,
          paymentHash: args.paymentHash,
          invoiceExpiresAt: args.invoiceExpiresAt,
          lnAddressSnapshot: args.lnAddressSnapshot,
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });
      if (updated.count !== 1) {
        return {
          ok: false,
          reason: "not_claimable",
          itemId: item.id,
          message: "Payout item was claimed by another worker",
        };
      }
      await tx.payoutAttempt.create({
        data: {
          runId: args.runId,
          itemId: item.id,
          attemptNumber,
          idempotencyKey: attemptKey,
          status: "started",
          startedAt: new Date(),
        },
      });
      return { ok: true, itemId: item.id, attemptKey, attemptNumber };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        reason: "duplicate_invoice",
        message: "This invoice was already used for a payout",
      };
    }
    throw error;
  }
}

export async function recordUnpayableCampaignItem(args: {
  runId: string;
  winnerPubkey: string;
  amountSats: number;
  idempotencyKey: string;
  status: "claim_needed" | "failed" | "skipped";
  errorCode: string;
  errorMessage: string;
  lnAddressSnapshot?: string | null;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "PayoutItem" (
        "id",
        "runId",
        "winnerPubkey",
        "amountSats",
        "idempotencyKey",
        "status",
        "attemptCount",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${crypto.randomUUID()},
        ${args.runId},
        ${args.winnerPubkey},
        ${args.amountSats},
        ${args.idempotencyKey},
        'pending'::"PayoutItemStatus",
        0,
        NOW(),
        NOW()
      )
      ON CONFLICT ("runId", "winnerPubkey") DO NOTHING
    `;
    await tx.payoutItem.updateMany({
      where: {
        runId: args.runId,
        winnerPubkey: args.winnerPubkey,
        status: { in: [...CLAIMABLE_STATUSES] },
      },
      data: {
        status: args.status,
        errorCode: args.errorCode,
        errorMessage: args.errorMessage.slice(0, 500),
        ...(args.lnAddressSnapshot !== undefined
          ? { lnAddressSnapshot: args.lnAddressSnapshot }
          : {}),
      },
    });
  });
}

function statusesForOutcome(
  outcome: "paid" | "failed" | "unknown"
): PayoutItemStatus[] {
  if (outcome === "paid") return ["paying", "unknown"];
  return ["paying"];
}

export async function settleCampaignPayoutAttempt(args: {
  itemId: string;
  outcome: "paid" | "failed" | "unknown";
  preimage?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  walletResponse?: unknown;
  attemptKey?: string | null;
}): Promise<"updated" | "ignored"> {
  const updated = await prisma.payoutItem.updateMany({
    where: {
      id: args.itemId,
      status: { in: statusesForOutcome(args.outcome) },
    },
    data: {
      status: args.outcome,
      ...(args.outcome === "paid"
        ? {
            paymentPreimage: args.preimage ?? null,
            errorCode: null,
            errorMessage: null,
          }
        : {
            errorCode: args.errorCode ?? null,
            errorMessage: args.errorMessage?.slice(0, 500) ?? null,
          }),
    },
  });
  if (updated.count !== 1) return "ignored";

  const attemptStatus =
    args.outcome === "paid"
      ? "succeeded"
      : args.outcome === "unknown"
        ? "unknown"
        : "failed";
  if (args.attemptKey) {
    await prisma.payoutAttempt.updateMany({
      where: { idempotencyKey: args.attemptKey, status: "started" },
      data: {
        status: attemptStatus,
        finishedAt: new Date(),
        errorCode: args.errorCode ?? null,
        errorMessage: args.errorMessage?.slice(0, 500) ?? null,
        ...(args.walletResponse !== undefined
          ? { walletResponseJson: args.walletResponse as never }
          : {}),
      },
    });
  } else {
    const open = await prisma.payoutAttempt.findFirst({
      where: { itemId: args.itemId, status: "started" },
      orderBy: { attemptNumber: "desc" },
      select: { id: true },
    });
    if (open) {
      await prisma.payoutAttempt.update({
        where: { id: open.id },
        data: {
          status: attemptStatus,
          finishedAt: new Date(),
          errorCode: args.errorCode ?? null,
          errorMessage: args.errorMessage?.slice(0, 500) ?? null,
          ...(args.walletResponse !== undefined
            ? { walletResponseJson: args.walletResponse as never }
            : {}),
        },
      });
    }
  }
  return "updated";
}

/**
 * Operator decision for a payout whose wallet result was lost.
 * This does not call a wallet. `confirmed_unpaid` is the only decision that
 * allows a later automatic payment, and only after the operator has checked
 * that the original invoice was not paid.
 */
export async function resolveUnknownCampaignPayoutItem(args: {
  itemId: string;
  decision: "confirmed_paid" | "confirmed_unpaid";
  note: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const note = args.note.trim();
  if (note.length < 8) {
    return {
      ok: false,
      error: "Record what the wallet showed before resolving this payout",
    };
  }
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        status: string;
        paymentHash: string | null;
        destinationSnapshot: unknown;
      }>
    >`
      SELECT id, status::text AS status, "paymentHash", "destinationSnapshot"
      FROM "PayoutItem"
      WHERE id = ${args.itemId}
      FOR UPDATE
    `;
    const item = rows[0];
    if (!item) return { ok: false, error: "Payout item was not found" };
    if (item.status !== "unknown" && item.status !== "paying") {
      return {
        ok: false,
        error: "Only an in-flight or unknown payout can be resolved by hand",
      };
    }
    if (args.decision === "confirmed_unpaid") {
      const attempt = await tx.payoutAttempt.findFirst({
        where: { itemId: item.id },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true },
      });
      const gate = unpaidResolutionAllowed({
        status: item.status,
        attemptStartedAtMs: attempt?.startedAt.getTime() ?? null,
        nowMs: Date.now(),
      });
      if (!gate.ok) return gate;
    }
    const previous =
      item.destinationSnapshot &&
      typeof item.destinationSnapshot === "object" &&
      !Array.isArray(item.destinationSnapshot)
        ? (item.destinationSnapshot as Record<string, unknown>)
        : {};
    if (args.decision === "confirmed_paid") {
      await tx.payoutItem.update({
        where: { id: item.id },
        data: {
          status: "paid",
          errorCode: null,
          errorMessage: note.slice(0, 500),
          destinationSnapshot: {
            ...previous,
            operatorResolution: "confirmed_paid",
            operatorNote: note.slice(0, 500),
          },
        },
      });
    } else {
      await tx.payoutItem.update({
        where: { id: item.id },
        data: {
          status: "failed",
          paymentHash: null,
          errorCode: "operator_confirmed_unpaid",
          errorMessage: note.slice(0, 500),
          destinationSnapshot: {
            ...previous,
            operatorResolution: "confirmed_unpaid",
            operatorNote: note.slice(0, 500),
            releasedPaymentHash: item.paymentHash,
          },
        },
      });
    }
    await tx.payoutAttempt.updateMany({
      where: { itemId: item.id, status: "started" },
      data: {
        status: args.decision === "confirmed_paid" ? "succeeded" : "failed",
        finishedAt: new Date(),
        errorMessage: note.slice(0, 500),
      },
    });
    return { ok: true };
  });
}
