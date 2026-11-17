/**
 * Referral data access. All prisma usage for referral confined here.
 */

import type { Prisma } from "@prisma/client";

import { ReferralEarningStatus } from "~/features/referral/data/referral-prisma-types.server";
import { selectExactOldestPrefix } from "~/features/referral/referral-payout-selection";
import { DELETED_ACCOUNT_NPUB } from "~/features/user/account-data.constants";
import { prisma } from "~/lib/prisma.server";

/** Serializes referral wallet payouts so two requests cannot pass the cap together. */
const REFERRAL_PAYOUT_LOCK_KEY = 87234101;
const REFERRAL_PAYOUT_MAX_ATTEMPTS = 5;

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// --- get-referred-by
export async function findReferralByReferredNpub(referredNpub: string) {
  return prisma.referral.findUnique({
    where: { referredNpub },
    select: { referrerNpub: true },
  });
}

export async function findUserNostrProfileByNpub(npub: string) {
  return prisma.user.findUnique({
    where: { npub },
    select: { nostrProfile: true },
  });
}

// --- record-referral-earning
export async function findUserNpubById(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { npub: true },
  });
}

export async function findReferralByReferredNpubSelectReferrer(
  referredNpub: string
) {
  return findReferralByReferredNpub(referredNpub);
}

export async function createReferralEarning(data: {
  referrerNpub: string;
  referredNpub: string;
  paymentId: string;
  amountPaidSats: number;
  commissionSats: number;
  status: ReferralEarningStatus;
}) {
  return prisma.referralEarning.create({ data });
}

// --- referral-admin
export async function findReferralsAdmin(
  where: {
    referrerNpub?: { contains: string; mode: "insensitive" };
    referredNpub?: { contains: string; mode: "insensitive" };
    createdAt?: { gte?: Date; lte?: Date };
  },
  skip: number,
  take: number
) {
  return prisma.referral.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip,
    take,
  });
}

export async function countReferralsAdmin(where: {
  referrerNpub?: { contains: string; mode: "insensitive" };
  referredNpub?: { contains: string; mode: "insensitive" };
  createdAt?: { gte?: Date; lte?: Date };
}) {
  return prisma.referral.count({ where });
}

export async function findEarningsAdmin(
  where: {
    referrerNpub?: { contains: string; mode: "insensitive" };
    status?: ReferralEarningStatus;
    createdAt?: { gte?: Date; lte?: Date };
  },
  skip: number,
  take: number
) {
  return prisma.referralEarning.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip,
    take,
  });
}

export async function countEarningsAdmin(where: {
  referrerNpub?: { contains: string; mode: "insensitive" };
  status?: ReferralEarningStatus;
  createdAt?: { gte?: Date; lte?: Date };
}) {
  return prisma.referralEarning.count({ where });
}

export async function findEarningByIdForRetry(earningId: string) {
  return prisma.referralEarning.findUnique({
    where: { id: earningId },
    select: { id: true, status: true },
  });
}

export async function updateEarningToPendingRetry(earningId: string) {
  return prisma.referralEarning.update({
    where: { id: earningId },
    data: {
      status: "PENDING" as ReferralEarningStatus,
      payoutAttemptCount: 0,
      payoutFailureReason: null,
    },
  });
}

// --- referral-binding (transactional)
export async function bindReferralInTransaction(
  tx: Tx,
  referredNpub: string,
  referrerNpub: string
): Promise<void> {
  const existing = await tx.referral.findUnique({
    where: { referredNpub },
    select: { referredNpub: true },
  });
  if (existing) return;

  await tx.referral.create({
    data: { referrerNpub, referredNpub },
  });
}

// --- referral-payout
export async function aggregatePendingCommissionByReferrer(
  referrerNpub: string
) {
  return prisma.referralEarning.aggregate({
    where: { referrerNpub, status: ReferralEarningStatus.PENDING },
    _sum: { commissionSats: true },
  });
}

export async function countReferralEarningsPaidInRange(params: {
  from: Date;
  to: Date;
}): Promise<number> {
  return prisma.referralEarning.count({
    where: {
      status: ReferralEarningStatus.PAID,
      paidAt: { gte: params.from, lt: params.to },
    },
  });
}

export async function findPendingEarningsForPayout(referrerNpub: string) {
  return prisma.referralEarning.findMany({
    where: { referrerNpub, status: ReferralEarningStatus.PENDING },
    orderBy: { createdAt: "asc" },
    select: { id: true, commissionSats: true },
  });
}

export async function findPendingEarningsWithAttemptCount(
  referrerNpub: string
) {
  return prisma.referralEarning.findMany({
    where: { referrerNpub, status: ReferralEarningStatus.PENDING },
    orderBy: { createdAt: "asc" },
    select: { id: true, payoutAttemptCount: true, commissionSats: true },
  });
}

export async function markEarningPaid(earningId: string, paidAt: Date) {
  return prisma.referralEarning.update({
    where: { id: earningId },
    data: {
      status: "PAID" as ReferralEarningStatus,
      paidAt,
      payoutFailureReason: null,
    },
  });
}

export async function markEarningPayoutAttempt(
  earningId: string,
  data: {
    payoutAttemptCount: number;
    payoutFailureReason: string;
    status: ReferralEarningStatus;
  }
) {
  return prisma.referralEarning.update({
    where: { id: earningId },
    data,
  });
}

export type BeginReferralPayoutResult =
  | { ok: true; auditId: string; earningIds: string[] }
  | { ok: false; error: string };

/**
 * Locks pending earnings, checks the daily cap, and records a started audit row
 * keyed by the BOLT11 payment hash. The wallet call happens after this commits.
 */
export async function beginReferralPayout(input: {
  referrerNpub: string;
  amountSats: number;
  paymentHash: string;
  channel: "batch" | "manual";
  operatorNpub?: string | null;
  dailyCapSats: number;
  dayStart: Date;
}): Promise<BeginReferralPayoutResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${REFERRAL_PAYOUT_LOCK_KEY})`;

      const existing = await tx.referralPayoutAuditLog.findUnique({
        where: { paymentHash: input.paymentHash },
        select: { status: true },
      });
      if (existing?.status === "success") {
        return { ok: false, error: "ALREADY_PAID" };
      }
      if (existing?.status === "unknown" || existing?.status === "started") {
        return { ok: false, error: "PAYOUT_OUTCOME_UNKNOWN" };
      }
      if (existing) {
        return { ok: false, error: "INVOICE_ALREADY_SUBMITTED" };
      }

      const spent = await tx.referralPayoutAuditLog.aggregate({
        where: {
          status: "success",
          createdAt: { gte: input.dayStart },
        },
        _sum: { amountSats: true },
      });
      const used = spent._sum.amountSats ?? 0;
      if (used + input.amountSats > input.dailyCapSats) {
        return { ok: false, error: "DAILY_CAP" };
      }

      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          commission_sats: number;
          payout_claim_hash: string | null;
        }>
      >`
        SELECT id, commission_sats, payout_claim_hash
        FROM "ReferralEarning"
        WHERE referrer_npub = ${input.referrerNpub}
          AND status = 'PENDING'::"ReferralEarningStatus"
        ORDER BY created_at ASC
        FOR UPDATE
      `;

      if (rows.some((row) => row.payout_claim_hash)) {
        return { ok: false, error: "PAYOUT_IN_PROGRESS" };
      }

      const earningIds = selectExactOldestPrefix(
        rows.map((row) => ({
          id: row.id,
          commissionSats: row.commission_sats,
        })),
        input.amountSats
      );
      if (!earningIds) {
        return { ok: false, error: "AMOUNT_NOT_EXACT" };
      }

      const claimed = await tx.referralEarning.updateMany({
        where: {
          id: { in: earningIds },
          status: "PENDING",
          payoutClaimHash: null,
        },
        data: { payoutClaimHash: input.paymentHash },
      });
      if (claimed.count !== earningIds.length) {
        throw new Error("CLAIM_CONFLICT");
      }

      const audit = await tx.referralPayoutAuditLog.create({
        data: {
          channel: input.channel,
          referrerNpub: input.referrerNpub,
          amountSats: input.amountSats,
          status: "started",
          paymentHash: input.paymentHash,
          operatorNpub: input.operatorNpub ?? null,
        },
      });

      return { ok: true, auditId: audit.id, earningIds };
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      return { ok: false, error: "INVOICE_ALREADY_SUBMITTED" };
    }
    if (error instanceof Error && error.message === "CLAIM_CONFLICT") {
      return { ok: false, error: "PAYOUT_IN_PROGRESS" };
    }
    throw error;
  }
}

export async function completeReferralPayoutAttempt(input: {
  auditId: string;
  earningIds: string[];
  paymentHash: string;
  paidAt: Date;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.referralEarning.updateMany({
      where: {
        id: { in: input.earningIds },
        payoutClaimHash: input.paymentHash,
        status: "PENDING",
      },
      data: {
        status: "PAID",
        paidAt: input.paidAt,
        payoutClaimHash: null,
        payoutFailureReason: null,
      },
    });
    if (updated.count !== input.earningIds.length) {
      throw new Error("PAYOUT_LEDGER_MISMATCH");
    }
    await tx.referralPayoutAuditLog.update({
      where: { id: input.auditId },
      data: { status: "success", errorMessage: null },
    });
  });
}

export async function failReferralPayoutAttempt(input: {
  auditId: string;
  earningIds: string[];
  paymentHash: string;
  reason: string;
}): Promise<void> {
  const reason = input.reason.slice(0, 500);
  await prisma.$transaction(async (tx) => {
    const rows = await tx.referralEarning.findMany({
      where: {
        id: { in: input.earningIds },
        payoutClaimHash: input.paymentHash,
      },
      select: { id: true, payoutAttemptCount: true },
    });
    for (const row of rows) {
      const nextCount = row.payoutAttemptCount + 1;
      await tx.referralEarning.update({
        where: { id: row.id },
        data: {
          payoutClaimHash: null,
          payoutAttemptCount: nextCount,
          payoutFailureReason: reason,
          status:
            nextCount >= REFERRAL_PAYOUT_MAX_ATTEMPTS
              ? ReferralEarningStatus.FAILED
              : ReferralEarningStatus.PENDING,
        },
      });
    }
    await tx.referralPayoutAuditLog.update({
      where: { id: input.auditId },
      data: { status: "failed", errorMessage: reason },
    });
  });
}

/**
 * Keeps the earnings claim after a wallet call whose result was not confirmed.
 * A later payout cannot start while `payoutClaimHash` is set.
 */
export async function holdReferralPayoutAsUnknown(input: {
  auditId: string;
  earningIds: string[];
  paymentHash: string;
  reason: string;
}): Promise<void> {
  const reason = input.reason.slice(0, 500);
  await prisma.$transaction(async (tx) => {
    await tx.referralEarning.updateMany({
      where: {
        id: { in: input.earningIds },
        payoutClaimHash: input.paymentHash,
        status: "PENDING",
      },
      data: { payoutFailureReason: reason },
    });
    await tx.referralPayoutAuditLog.update({
      where: { id: input.auditId },
      data: { status: "unknown", errorMessage: reason },
    });
  });
}

export async function findInProgressReferralClaim(
  referrerNpub: string
): Promise<
  | {
      ambiguous: false;
      paymentHash: string;
      earningIds: string[];
      amountSats: number;
      auditId: string | null;
    }
  | { ambiguous: true }
  | null
> {
  const rows = await prisma.referralEarning.findMany({
    where: {
      referrerNpub,
      status: "PENDING",
      NOT: { payoutClaimHash: null },
    },
    select: { id: true, commissionSats: true, payoutClaimHash: true },
  });
  if (rows.length === 0) return null;
  const hashes = new Set(
    rows
      .map((row) => row.payoutClaimHash)
      .filter((hash): hash is string => typeof hash === "string" && hash !== "")
  );
  if (hashes.size !== 1) return { ambiguous: true };
  const paymentHash = [...hashes][0];
  if (!paymentHash) return { ambiguous: true };
  const audit = await prisma.referralPayoutAuditLog.findUnique({
    where: { paymentHash },
    select: { id: true, amountSats: true },
  });
  const amountFromRows = rows.reduce((sum, row) => sum + row.commissionSats, 0);
  return {
    ambiguous: false,
    paymentHash,
    earningIds: rows.map((row) => row.id),
    amountSats: audit?.amountSats ?? amountFromRows,
    auditId: audit?.id ?? null,
  };
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function findReferrerPayoutConfig(referrerNpub: string) {
  return prisma.referrerPayoutConfig.findUnique({
    where: { referrerNpub },
    select: { payoutDestination: true, payoutDestinationType: true },
  });
}

export async function groupByReferrerPendingSats() {
  return prisma.referralEarning.groupBy({
    by: ["referrerNpub"],
    where: { status: ReferralEarningStatus.PENDING },
    _sum: { commissionSats: true },
  });
}

// --- referral-settings
export async function aggregateEarningsByStatus(referrerNpub: string) {
  return prisma.referralEarning.groupBy({
    by: ["status"],
    where: { referrerNpub },
    _sum: { commissionSats: true },
  });
}

export async function findReferrerPayoutConfigForSettings(
  referrerNpub: string
) {
  return findReferrerPayoutConfig(referrerNpub);
}

// --- settings referral-actions (upsert payout config)
export async function upsertReferrerPayoutConfig(
  referrerNpub: string,
  data: { payoutDestination: string; payoutDestinationType: string | null }
) {
  return prisma.referrerPayoutConfig.upsert({
    where: { referrerNpub },
    create: {
      referrerNpub,
      payoutDestination: data.payoutDestination,
      payoutDestinationType: data.payoutDestinationType,
    },
    update: {
      payoutDestination: data.payoutDestination,
      payoutDestinationType: data.payoutDestinationType,
    },
  });
}

// --- referral payout audit (admin ledger)
export async function insertReferralPayoutAuditLog(input: {
  channel: "batch" | "manual";
  referrerNpub?: string | null;
  amountSats?: number | null;
  status: "success" | "failed";
  batchSummary?: unknown;
  errorMessage?: string | null;
  operatorNpub?: string | null;
}): Promise<void> {
  await prisma.referralPayoutAuditLog.create({
    data: {
      channel: input.channel,
      referrerNpub: input.referrerNpub ?? null,
      amountSats: input.amountSats ?? null,
      status: input.status,
      batchSummary:
        input.batchSummary === undefined
          ? undefined
          : (input.batchSummary as Prisma.InputJsonValue),
      errorMessage: input.errorMessage ?? null,
      operatorNpub: input.operatorNpub ?? null,
    },
  });
}

export async function listReferralPayoutAuditLogs(limit: number) {
  return prisma.referralPayoutAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
  });
}

// --- account deletion and retention
const PLAIN_KEY_TEXT = /^[0-9a-z]+$/;

/**
 * Removes a deleted account's public key from referral rows, inside the
 * account-deletion transaction. Takes the payout lock first, so a payout
 * cannot claim earnings while they are being removed.
 *
 * Unpaid earnings with no payout in flight are forfeited. Paid earnings and
 * earnings with a payout in flight stay, with the public key replaced, until
 * the retention purge. Payment hashes in the audit log are left as they are.
 */
export async function removeReferralDataForDeletedAccount(
  tx: Tx,
  npub: string
): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${REFERRAL_PAYOUT_LOCK_KEY})`;

  await tx.referralEarning.deleteMany({
    where: {
      referrerNpub: npub,
      payoutClaimHash: null,
      status: {
        in: [ReferralEarningStatus.PENDING, ReferralEarningStatus.FAILED],
      },
    },
  });
  await tx.referralEarning.updateMany({
    where: { referrerNpub: npub },
    data: { referrerNpub: DELETED_ACCOUNT_NPUB },
  });
  await tx.referralEarning.updateMany({
    where: { referredNpub: npub },
    data: { referredNpub: DELETED_ACCOUNT_NPUB },
  });
  await tx.referral.deleteMany({
    where: { OR: [{ referrerNpub: npub }, { referredNpub: npub }] },
  });
  await tx.referralPayoutAuditLog.updateMany({
    where: { referrerNpub: npub },
    data: { referrerNpub: null },
  });
  await tx.referralPayoutAuditLog.updateMany({
    where: { operatorNpub: npub },
    data: { operatorNpub: null },
  });

  // Batch summaries and error text name referrers inside free text. The text
  // replace is only safe for keys that cannot contain JSON syntax.
  if (!PLAIN_KEY_TEXT.test(npub)) return;
  await tx.$executeRaw`
    UPDATE "referral_payout_audit_log"
    SET "batch_summary" =
      replace("batch_summary"::text, ${npub}::text, ${DELETED_ACCOUNT_NPUB}::text)::jsonb
    WHERE "batch_summary" IS NOT NULL
      AND position(${npub}::text in "batch_summary"::text) > 0
  `;
  await tx.$executeRaw`
    UPDATE "referral_payout_audit_log"
    SET "error_message" =
      replace("error_message", ${npub}::text, ${DELETED_ACCOUNT_NPUB}::text)
    WHERE "error_message" IS NOT NULL
      AND position(${npub}::text in "error_message") > 0
  `;
}

/**
 * Deletes payout audit rows and anonymised earnings older than the cutoff.
 * Rows inside the window stay, including payment hashes that block a second
 * payment of the same invoice. An in-flight payout is not deleted.
 */
export async function purgeReferralRecords(cutoff: Date): Promise<{
  payoutAuditRows: number;
  deletedAccountEarnings: number;
}> {
  const audit = await prisma.referralPayoutAuditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  const earnings = await prisma.referralEarning.deleteMany({
    where: {
      referrerNpub: DELETED_ACCOUNT_NPUB,
      payoutClaimHash: null,
      createdAt: { lt: cutoff },
    },
  });
  return {
    payoutAuditRows: audit.count,
    deletedAccountEarnings: earnings.count,
  };
}
