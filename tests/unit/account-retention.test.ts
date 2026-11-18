import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTx, mockPrisma, calls } = vi.hoisted(() => {
  const calls: string[] = [];
  const record =
    (name: string, result: unknown = { count: 0 }) =>
    (..._args: unknown[]) => {
      calls.push(name);
      return Promise.resolve(result);
    };

  const mockTx = {
    $queryRaw: vi.fn(async (query: TemplateStringsArray) => {
      calls.push("lock");
      const text = Array.isArray(query) ? query.join(" ") : "";
      if (text.includes("deletionStartedAt")) {
        return [{ deletionStartedAt: null }];
      }
      return [];
    }),
    $executeRaw: vi.fn(record("scrubText", 0)),
    retainedFinancialRecord: {
      createMany: vi.fn(record("retainPayments")),
    },
    referrerPayoutConfig: {
      deleteMany: vi.fn(record("deletePayoutConfig")),
    },
    referralEarning: {
      deleteMany: vi.fn(record("deleteEarnings")),
      updateMany: vi.fn(record("anonymiseEarnings")),
    },
    referral: {
      deleteMany: vi.fn(record("deleteReferrals")),
    },
    referralPayoutAuditLog: {
      updateMany: vi.fn(record("blankAuditKeys")),
    },
    media: {
      findMany: vi.fn(async () => []),
    },
    mediaVariant: {
      findMany: vi.fn(async () => []),
    },
    user: {
      update: vi.fn(record("markDeleting", {})),
      delete: vi.fn(record("deleteUser", {})),
    },
  };

  const mockPrisma = {
    $transaction: vi.fn(async (run: (tx: typeof mockTx) => Promise<void>) =>
      run(mockTx)
    ),
    user: { findUnique: vi.fn() },
    payment: { findMany: vi.fn() },
    retainedFinancialRecord: { deleteMany: vi.fn() },
    referralPayoutAuditLog: { deleteMany: vi.fn() },
    referralEarning: { deleteMany: vi.fn() },
  };

  return { mockTx, mockPrisma, calls };
});

vi.mock("~/lib/prisma.server", () => ({
  prisma: mockPrisma,
}));

import {
  DELETED_ACCOUNT_NPUB,
  FINANCIAL_RECORD_RETENTION_DAYS,
} from "~/features/user/account-data.constants";
import {
  deleteAccountData,
  purgeRetainedRecords,
} from "~/features/user/data/account-data.server";

const NPUB = "npub1examplekey0000000000000000000000000000000000000000000000";

describe("account deletion and referral rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user_1", npub: NPUB });
    mockPrisma.payment.findMany.mockResolvedValue([]);
  });

  it("takes the payout lock before touching referral rows and deletes the user last", async () => {
    await expect(deleteAccountData("user_1")).resolves.toBe(true);

    expect(calls.indexOf("lock")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("lock")).toBeLessThan(calls.indexOf("deleteEarnings"));
    expect(calls.at(-1)).toBe("deleteUser");
  });

  it("forfeits unpaid earnings and keeps paid rows for anonymisation", async () => {
    await deleteAccountData("user_1");

    expect(mockTx.referralEarning.deleteMany).toHaveBeenCalledWith({
      where: {
        referrerNpub: NPUB,
        payoutClaimHash: null,
        status: { in: ["PENDING", "FAILED"] },
      },
    });
    expect(mockTx.referralEarning.updateMany).toHaveBeenCalledWith({
      where: { referrerNpub: NPUB },
      data: { referrerNpub: DELETED_ACCOUNT_NPUB },
    });
  });

  it("keeps a referrer's earning from a deleted referred user without that user's key", async () => {
    await deleteAccountData("user_1");

    expect(mockTx.referralEarning.updateMany).toHaveBeenCalledWith({
      where: { referredNpub: NPUB },
      data: { referredNpub: DELETED_ACCOUNT_NPUB },
    });
  });

  it("deletes referral links on both sides", async () => {
    await deleteAccountData("user_1");

    expect(mockTx.referral.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ referrerNpub: NPUB }, { referredNpub: NPUB }] },
    });
  });

  it("blanks the key in payout audit rows and never deletes them or their payment hash", async () => {
    await deleteAccountData("user_1");

    expect(mockTx.referralPayoutAuditLog.updateMany).toHaveBeenCalledWith({
      where: { referrerNpub: NPUB },
      data: { referrerNpub: null },
    });
    expect(mockTx.referralPayoutAuditLog.updateMany).toHaveBeenCalledWith({
      where: { operatorNpub: NPUB },
      data: { operatorNpub: null },
    });
    for (const [args] of mockTx.referralPayoutAuditLog.updateMany.mock
      .calls as unknown as Array<[{ data: Record<string, unknown> }]>) {
      expect(args.data).not.toHaveProperty("paymentHash");
    }
    expect(mockTx.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it("skips the free-text scrub for a key that could contain JSON syntax", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user_1",
      npub: 'odd"key\\',
    });

    await deleteAccountData("user_1");

    expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockTx.$executeRaw.mock.calls)).toContain(
      "pg_advisory_xact_lock"
    );
    expect(JSON.stringify(mockTx.$executeRaw.mock.calls)).not.toContain(
      'odd"key'
    );
    expect(mockTx.user.delete).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the account does not exist", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(deleteAccountData("missing")).resolves.toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("retained record purge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.retainedFinancialRecord.deleteMany.mockResolvedValue({
      count: 3,
    });
    mockPrisma.referralPayoutAuditLog.deleteMany.mockResolvedValue({
      count: 2,
    });
    mockPrisma.referralEarning.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("deletes rows older than the retention window and reports the counts", async () => {
    const now = new Date("2027-12-01T00:00:00.000Z");
    const cutoff = new Date(
      now.getTime() - FINANCIAL_RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000
    );

    const result = await purgeRetainedRecords(now);

    expect(mockPrisma.retainedFinancialRecord.deleteMany).toHaveBeenCalledWith({
      where: { retainedAt: { lt: cutoff } },
    });
    expect(mockPrisma.referralPayoutAuditLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: cutoff } },
    });
    expect(result).toEqual({
      success: true,
      cutoffIso: cutoff.toISOString(),
      retainedFinancialRecords: 3,
      payoutAuditRows: 2,
      deletedAccountEarnings: 1,
    });
  });

  it("keeps anonymised earnings inside the retention window", async () => {
    const now = new Date("2027-12-01T00:00:00.000Z");
    const cutoff = new Date(
      now.getTime() - FINANCIAL_RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000
    );
    await purgeRetainedRecords(now);

    expect(mockPrisma.referralEarning.deleteMany).toHaveBeenCalledWith({
      where: {
        referrerNpub: DELETED_ACCOUNT_NPUB,
        payoutClaimHash: null,
        createdAt: { lt: cutoff },
      },
    });
  });
});
