import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => {
  const client = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [] as Array<Record<string, unknown>>),
    referral: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    referralEarning: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(
        (_args: {
          where: { id: string };
          data: {
            status?: string;
            payoutFailureReason?: string | null;
            payoutAttemptCount?: number;
          };
        }): Promise<unknown> => Promise.resolve({})
      ),
      updateMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 3 })),
    },
    referralPayoutAuditLog: {
      findUnique: vi.fn(),
      findMany: vi.fn((_args: { take: number }): Promise<unknown[]> =>
        Promise.resolve([])
      ),
      aggregate: vi.fn(async () => ({
        _sum: { amountSats: null as number | null },
      })),
      create: vi.fn(async () => ({ id: "audit-1" })),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 2 })),
    },
    referrerPayoutConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation(
    (fn: (trx: typeof client) => Promise<unknown>) => fn(client)
  );
  return client;
});

vi.mock("~/lib/prisma.server", () => ({
  prisma: tx,
}));

import { ReferralEarningStatus } from "~/features/referral/data/referral-prisma-types.server";
import {
  aggregateEarningsByStatus,
  aggregatePendingCommissionByReferrer,
  beginReferralPayout,
  bindReferralInTransaction,
  completeReferralPayoutAttempt,
  countEarningsAdmin,
  countReferralEarningsPaidInRange,
  countReferralsAdmin,
  createReferralEarning,
  failReferralPayoutAttempt,
  findEarningByIdForRetry,
  findEarningsAdmin,
  findInProgressReferralClaim,
  findPendingEarningsForPayout,
  findPendingEarningsWithAttemptCount,
  findReferralByReferredNpub,
  findReferralByReferredNpubSelectReferrer,
  findReferralsAdmin,
  findReferrerPayoutConfig,
  findReferrerPayoutConfigForSettings,
  findUserNostrProfileByNpub,
  findUserNpubById,
  groupByReferrerPendingSats,
  holdReferralPayoutAsUnknown,
  insertReferralPayoutAuditLog,
  listReferralPayoutAuditLogs,
  markEarningPaid,
  markEarningPayoutAttempt,
  purgeReferralRecords,
  removeReferralDataForDeletedAccount,
  updateEarningToPendingRetry,
  upsertReferrerPayoutConfig,
} from "~/features/referral/repositories/referral-data.server";

const payoutInput = {
  referrerNpub: "npub1referrer",
  amountSats: 100,
  paymentHash: "hash-1",
  channel: "manual" as const,
  dailyCapSats: 1_000,
  dayStart: new Date("2026-01-01T00:00:00.000Z"),
};

describe("referral data repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.referralEarning.updateMany.mockResolvedValue({ count: 1 });
    tx.referralPayoutAuditLog.aggregate.mockResolvedValue({
      _sum: { amountSats: 0 },
    });
    tx.referralPayoutAuditLog.create.mockResolvedValue({ id: "audit-1" });
    tx.$queryRaw.mockResolvedValue([]);
  });

  it("reads and writes referral rows", async () => {
    tx.referral.findUnique.mockResolvedValueOnce({ referrerNpub: "npub1r" });
    await expect(findReferralByReferredNpub("npub1a")).resolves.toEqual({
      referrerNpub: "npub1r",
    });
    await expect(
      findReferralByReferredNpubSelectReferrer("npub1a")
    ).resolves.toBeUndefined();

    tx.user.findUnique
      .mockResolvedValueOnce({ nostrProfile: { name: "Ada" } })
      .mockResolvedValueOnce({ npub: "npub1a" });
    await expect(findUserNostrProfileByNpub("npub1a")).resolves.toEqual({
      nostrProfile: { name: "Ada" },
    });
    await expect(findUserNpubById("user-1")).resolves.toEqual({
      npub: "npub1a",
    });

    const earning = {
      referrerNpub: "npub1r",
      referredNpub: "npub1a",
      paymentId: "pay-1",
      amountPaidSats: 1000,
      commissionSats: 100,
      status: ReferralEarningStatus.PENDING,
    };
    tx.referralEarning.create.mockResolvedValueOnce({ id: "earn-1" });
    await expect(createReferralEarning(earning)).resolves.toEqual({
      id: "earn-1",
    });
    expect(tx.referralEarning.create).toHaveBeenCalledWith({ data: earning });

    tx.referral.findMany.mockResolvedValueOnce([]);
    tx.referral.count.mockResolvedValueOnce(0);
    tx.referralEarning.findMany.mockResolvedValueOnce([]);
    tx.referralEarning.count.mockResolvedValueOnce(2);
    tx.referralEarning.findUnique.mockResolvedValueOnce({
      id: "earn-1",
      status: "FAILED",
    });
    const where = {
      referrerNpub: { contains: "ada", mode: "insensitive" as const },
    };
    await findReferralsAdmin(where, 0, 20);
    await countReferralsAdmin(where);
    await findEarningsAdmin(where, 5, 10);
    await expect(countEarningsAdmin(where)).resolves.toBe(2);
    await findEarningByIdForRetry("earn-1");
    await updateEarningToPendingRetry("earn-1");
    expect(tx.referralEarning.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "earn-1" },
        data: {
          status: "PENDING",
          payoutAttemptCount: 0,
          payoutFailureReason: null,
        },
      })
    );
  });

  it("binds a referral only when one does not already exist", async () => {
    tx.referral.findUnique.mockResolvedValueOnce({ referredNpub: "npub1a" });
    await bindReferralInTransaction(tx, "npub1a", "npub1r");
    expect(tx.referral.create).not.toHaveBeenCalled();

    tx.referral.findUnique.mockResolvedValueOnce(null);
    await bindReferralInTransaction(tx, "npub1a", "npub1r");
    expect(tx.referral.create).toHaveBeenCalledWith({
      data: { referrerNpub: "npub1r", referredNpub: "npub1a" },
    });
  });

  it("aggregates payout rows and clamps the audit list size", async () => {
    tx.referralEarning.aggregate.mockResolvedValueOnce({
      _sum: { commissionSats: 40 },
    });
    await aggregatePendingCommissionByReferrer("npub1r");
    await countReferralEarningsPaidInRange({
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-02-01T00:00:00.000Z"),
    });
    await findPendingEarningsForPayout("npub1r");
    await findPendingEarningsWithAttemptCount("npub1r");
    const paidAt = new Date("2026-03-01T00:00:00.000Z");
    await markEarningPaid("earn-1", paidAt);
    await markEarningPayoutAttempt("earn-1", {
      payoutAttemptCount: 2,
      payoutFailureReason: "timeout",
      status: ReferralEarningStatus.PENDING,
    });
    await groupByReferrerPendingSats();
    await aggregateEarningsByStatus("npub1r");
    tx.referrerPayoutConfig.findUnique.mockResolvedValue({
      payoutDestination: "ada@example.com",
      payoutDestinationType: "lnurl",
    });
    await expect(findReferrerPayoutConfig("npub1r")).resolves.toMatchObject({
      payoutDestination: "ada@example.com",
    });
    await findReferrerPayoutConfigForSettings("npub1r");
    await upsertReferrerPayoutConfig("npub1r", {
      payoutDestination: "ada@example.com",
      payoutDestinationType: null,
    });
    await insertReferralPayoutAuditLog({
      channel: "batch",
      status: "success",
    });
    await insertReferralPayoutAuditLog({
      channel: "manual",
      status: "failed",
      referrerNpub: "npub1r",
      amountSats: 10,
      batchSummary: { ok: 1 },
      errorMessage: "nope",
      operatorNpub: "npub1op",
    });
    await listReferralPayoutAuditLogs(0);
    await listReferralPayoutAuditLogs(900);
    await listReferralPayoutAuditLogs(12);
    const takes = tx.referralPayoutAuditLog.findMany.mock.calls.map(
      (call) => call[0].take
    );
    expect(takes).toEqual([1, 500, 12]);
  });

  it("starts, completes, fails, and holds a referral payout", async () => {
    tx.referralPayoutAuditLog.findUnique.mockResolvedValueOnce({
      status: "success",
    });
    await expect(beginReferralPayout(payoutInput)).resolves.toEqual({
      ok: false,
      error: "ALREADY_PAID",
    });

    tx.referralPayoutAuditLog.findUnique.mockResolvedValueOnce({
      status: "unknown",
    });
    await expect(beginReferralPayout(payoutInput)).resolves.toEqual({
      ok: false,
      error: "PAYOUT_OUTCOME_UNKNOWN",
    });

    tx.referralPayoutAuditLog.findUnique.mockResolvedValueOnce({
      status: "started",
    });
    await expect(
      beginReferralPayout({ ...payoutInput, operatorNpub: "npub1op" })
    ).resolves.toEqual({ ok: false, error: "PAYOUT_OUTCOME_UNKNOWN" });

    tx.referralPayoutAuditLog.findUnique.mockResolvedValueOnce({
      status: "failed",
    });
    await expect(beginReferralPayout(payoutInput)).resolves.toEqual({
      ok: false,
      error: "INVOICE_ALREADY_SUBMITTED",
    });

    tx.referralPayoutAuditLog.findUnique.mockResolvedValueOnce(null);
    tx.referralPayoutAuditLog.aggregate.mockResolvedValueOnce({
      _sum: { amountSats: 950 },
    });
    await expect(beginReferralPayout(payoutInput)).resolves.toEqual({
      ok: false,
      error: "DAILY_CAP",
    });

    tx.referralPayoutAuditLog.findUnique.mockResolvedValueOnce(null);
    tx.referralPayoutAuditLog.aggregate.mockResolvedValueOnce({
      _sum: { amountSats: null },
    });
    tx.$queryRaw.mockResolvedValueOnce([
      { id: "earn-1", commission_sats: 100, payout_claim_hash: "other" },
    ]);
    await expect(beginReferralPayout(payoutInput)).resolves.toEqual({
      ok: false,
      error: "PAYOUT_IN_PROGRESS",
    });

    tx.referralPayoutAuditLog.findUnique.mockResolvedValueOnce(null);
    tx.$queryRaw.mockResolvedValueOnce([
      { id: "earn-1", commission_sats: 40, payout_claim_hash: null },
    ]);
    await expect(beginReferralPayout(payoutInput)).resolves.toEqual({
      ok: false,
      error: "AMOUNT_NOT_EXACT",
    });

    tx.referralPayoutAuditLog.findUnique.mockResolvedValueOnce(null);
    tx.$queryRaw.mockResolvedValueOnce([
      { id: "earn-1", commission_sats: 100, payout_claim_hash: null },
    ]);
    tx.referralEarning.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(beginReferralPayout(payoutInput)).resolves.toEqual({
      ok: false,
      error: "PAYOUT_IN_PROGRESS",
    });

    tx.referralPayoutAuditLog.findUnique.mockResolvedValueOnce(null);
    tx.$queryRaw.mockResolvedValueOnce([
      { id: "earn-1", commission_sats: 100, payout_claim_hash: null },
    ]);
    tx.referralEarning.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(beginReferralPayout(payoutInput)).resolves.toEqual({
      ok: true,
      auditId: "audit-1",
      earningIds: ["earn-1"],
    });

    tx.$transaction.mockImplementationOnce(() => {
      throw { code: "P2002" };
    });
    await expect(beginReferralPayout(payoutInput)).resolves.toEqual({
      ok: false,
      error: "INVOICE_ALREADY_SUBMITTED",
    });

    const paidAt = new Date("2026-04-01T00:00:00.000Z");
    tx.referralEarning.updateMany.mockResolvedValueOnce({ count: 1 });
    await completeReferralPayoutAttempt({
      auditId: "audit-1",
      earningIds: ["earn-1"],
      paymentHash: "hash-1",
      paidAt,
    });

    tx.referralEarning.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      completeReferralPayoutAttempt({
        auditId: "audit-1",
        earningIds: ["earn-1"],
        paymentHash: "hash-1",
        paidAt,
      })
    ).rejects.toThrow("PAYOUT_LEDGER_MISMATCH");

    tx.referralEarning.findMany.mockResolvedValueOnce([
      { id: "earn-1", payoutAttemptCount: 1 },
      { id: "earn-2", payoutAttemptCount: 4 },
    ]);
    await failReferralPayoutAttempt({
      auditId: "audit-1",
      earningIds: ["earn-1", "earn-2"],
      paymentHash: "hash-1",
      reason: "x".repeat(600),
    });
    const failureUpdates = tx.referralEarning.update.mock.calls.map(
      (call) => call[0].data
    );
    expect(failureUpdates[0]?.status).toBe(ReferralEarningStatus.PENDING);
    expect(failureUpdates[1]?.status).toBe(ReferralEarningStatus.FAILED);
    expect(failureUpdates[0]?.payoutFailureReason).toHaveLength(500);

    await holdReferralPayoutAsUnknown({
      auditId: "audit-1",
      earningIds: ["earn-1"],
      paymentHash: "hash-1",
      reason: "unknown result",
    });
    expect(tx.referralPayoutAuditLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "unknown", errorMessage: "unknown result" },
      })
    );
  });

  it("reports in-progress claims and purges deleted-account rows", async () => {
    tx.referralEarning.findMany.mockResolvedValueOnce([]);
    await expect(findInProgressReferralClaim("npub1r")).resolves.toBeNull();

    tx.referralEarning.findMany.mockResolvedValueOnce([
      { id: "a", commissionSats: 10, payoutClaimHash: "h1" },
      { id: "b", commissionSats: 10, payoutClaimHash: "h2" },
    ]);
    await expect(findInProgressReferralClaim("npub1r")).resolves.toEqual({
      ambiguous: true,
    });

    tx.referralEarning.findMany.mockResolvedValueOnce([
      { id: "a", commissionSats: 10, payoutClaimHash: "" },
    ]);
    await expect(findInProgressReferralClaim("npub1r")).resolves.toEqual({
      ambiguous: true,
    });

    tx.referralEarning.findMany.mockResolvedValueOnce([
      { id: "a", commissionSats: 10, payoutClaimHash: "h1" },
      { id: "b", commissionSats: 15, payoutClaimHash: "h1" },
    ]);
    tx.referralPayoutAuditLog.findUnique.mockResolvedValueOnce(null);
    await expect(findInProgressReferralClaim("npub1r")).resolves.toEqual({
      ambiguous: false,
      paymentHash: "h1",
      earningIds: ["a", "b"],
      amountSats: 25,
      auditId: null,
    });

    tx.referralEarning.findMany.mockResolvedValueOnce([
      { id: "a", commissionSats: 10, payoutClaimHash: "h1" },
    ]);
    tx.referralPayoutAuditLog.findUnique.mockResolvedValueOnce({
      id: "audit-9",
      amountSats: 10,
    });
    await expect(findInProgressReferralClaim("npub1r")).resolves.toMatchObject({
      auditId: "audit-9",
      amountSats: 10,
    });

    await removeReferralDataForDeletedAccount(tx, "Not Plain");
    await removeReferralDataForDeletedAccount(tx, "npub1abc");
    expect(tx.$executeRaw).toHaveBeenCalled();

    await expect(
      purgeReferralRecords(new Date("2025-01-01T00:00:00.000Z"))
    ).resolves.toEqual({
      payoutAuditRows: 2,
      deletedAccountEarnings: 3,
    });
  });
});
