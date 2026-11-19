import { beforeEach, describe, expect, it, vi } from "vitest";

const referral = vi.hoisted(() => ({
  recordReferralEarningIfAny: vi.fn(),
}));

const prismaMock = vi.hoisted(() => {
  const query = () => vi.fn<(...args: unknown[]) => Promise<unknown>>();
  return {
    $transaction:
      vi.fn<
        (callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>
      >(),
    contestFinalizationPayment: {
      findFirst: query(),
      findMany: query(),
      update: query(),
      updateMany: query(),
    },
    payment: {
      findFirst: query(),
      findUnique: query(),
      update: query(),
      updateMany: query(),
    },
  };
});

vi.mock("~/features/referral/record-referral-earning.server", () => referral);
vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));

import { anyDate } from "../contest-test-doubles";

import {
  completeContestFinalizationPayment,
  expireContestFinalizationByIds,
  expireStaleFinalizationPaymentsForContest,
  findPaidContestFinalizationForLock,
  findReusableContestFinalizationInvoice,
  listContestFinalizationRecords,
} from "~/features/contest/repositories/contest-finalization-payment.server";
import { recordReferralEarningIfAny } from "~/features/referral/record-referral-earning.server";

interface TxDouble {
  contestFinalizationPayment: {
    update: ReturnType<typeof vi.fn>;
  };
  payment: {
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
}

function isTxCallback(
  value: unknown
): value is (tx: TxDouble) => Promise<unknown> {
  return typeof value === "function";
}

describe("contest finalization payment repository", () => {
  const tx: TxDouble = {
    contestFinalizationPayment: { update: vi.fn() },
    payment: { update: vi.fn(), updateMany: vi.fn() },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => {
      if (!isTxCallback(callback)) {
        throw new Error("expected transaction callback");
      }
      return callback(tx);
    });
  });

  it("reports whether a paid lock row exists", async () => {
    prismaMock.contestFinalizationPayment.findFirst.mockResolvedValueOnce(null);
    await expect(
      findPaidContestFinalizationForLock("contest-1", "user-1", "hash-1")
    ).resolves.toBe(false);

    prismaMock.contestFinalizationPayment.findFirst.mockResolvedValueOnce({
      id: "fee-1",
    });
    await expect(
      findPaidContestFinalizationForLock("contest-1", "user-1", "hash-1")
    ).resolves.toBe(true);
    expect(
      prismaMock.contestFinalizationPayment.findFirst
    ).toHaveBeenCalledWith({
      where: {
        contestId: "contest-1",
        userId: "user-1",
        lockConfigHash: "hash-1",
        status: "PAID",
      },
      select: { id: true },
    });
  });

  it("maps records when the payment relation is missing or present", async () => {
    const expiresAt = new Date("2026-07-01T00:00:00.000Z");
    prismaMock.contestFinalizationPayment.findMany.mockResolvedValueOnce([
      {
        id: "fee-1",
        status: "PENDING",
        feeRateBps: 1000,
        feeSats: 300,
        lockConfigHash: "hash-1",
        paymentId: null,
        payment: null,
      },
      {
        id: "fee-2",
        status: "PAID",
        feeRateBps: 0,
        feeSats: 0,
        lockConfigHash: "hash-2",
        paymentId: "pay-2",
        payment: { status: "COMPLETED", expiresAt },
      },
      {
        id: "fee-3",
        status: "EXPIRED",
        feeRateBps: 750,
        feeSats: 10,
        lockConfigHash: "hash-3",
        paymentId: "pay-3",
        payment: { status: "EXPIRED", expiresAt: null },
      },
    ]);

    await expect(
      listContestFinalizationRecords("contest-1", "user-1")
    ).resolves.toEqual([
      {
        id: "fee-1",
        status: "PENDING",
        feeRateBps: 1000,
        feeSats: 300,
        lockConfigHash: "hash-1",
        paymentId: null,
        paymentStatus: null,
        paymentExpiresAtMs: null,
      },
      {
        id: "fee-2",
        status: "PAID",
        feeRateBps: 0,
        feeSats: 0,
        lockConfigHash: "hash-2",
        paymentId: "pay-2",
        paymentStatus: "COMPLETED",
        paymentExpiresAtMs: expiresAt.getTime(),
      },
      {
        id: "fee-3",
        status: "EXPIRED",
        feeRateBps: 750,
        feeSats: 10,
        lockConfigHash: "hash-3",
        paymentId: "pay-3",
        paymentStatus: "EXPIRED",
        paymentExpiresAtMs: null,
      },
    ]);
    expect(prismaMock.contestFinalizationPayment.findMany).toHaveBeenCalledWith(
      {
        where: { contestId: "contest-1", userId: "user-1" },
        select: {
          id: true,
          status: true,
          feeRateBps: true,
          feeSats: true,
          lockConfigHash: true,
          paymentId: true,
          payment: { select: { status: true, expiresAt: true } },
        },
      }
    );
  });

  it("finds a reusable pending contest invoice", async () => {
    const invoice = { id: "pay-1", invoice: "lnbc1" };
    prismaMock.payment.findFirst.mockResolvedValueOnce(null);
    await expect(findReusableContestFinalizationInvoice("pay-1")).resolves.toBe(
      null
    );
    prismaMock.payment.findFirst.mockResolvedValueOnce(invoice);
    await expect(findReusableContestFinalizationInvoice("pay-1")).resolves.toBe(
      invoice
    );
    expect(prismaMock.payment.findFirst).toHaveBeenCalledWith({
      where: {
        id: "pay-1",
        status: "PENDING",
        purpose: "CONTEST_FINALIZATION",
      },
      select: {
        id: true,
        invoice: true,
        paymentHash: true,
        amount: true,
        expiresAt: true,
      },
    });
  });

  it("does nothing when there are no finalization ids to expire", async () => {
    await expireContestFinalizationByIds([]);
    expect(
      prismaMock.contestFinalizationPayment.findMany
    ).not.toHaveBeenCalled();
  });

  it("expires pending rows and supersedes a linked pending payment", async () => {
    prismaMock.contestFinalizationPayment.findMany.mockResolvedValueOnce([
      { id: "fee-1", paymentId: null },
      { id: "fee-2", paymentId: "pay-2" },
    ]);

    await expireContestFinalizationByIds(["fee-1", "fee-2"]);

    expect(prismaMock.contestFinalizationPayment.findMany).toHaveBeenCalledWith(
      {
        where: { id: { in: ["fee-1", "fee-2"] }, status: "PENDING" },
        select: { id: true, paymentId: true },
      }
    );
    expect(tx.contestFinalizationPayment.update).toHaveBeenCalledTimes(2);
    expect(tx.payment.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: "pay-2", status: "PENDING" },
      data: {
        status: "EXPIRED",
        failedAt: anyDate(),
        failureReason: "Superseded by new finalization invoice",
      },
    });
  });

  it("throws when the payment is missing or is not a contest finalization", async () => {
    prismaMock.payment.findUnique.mockResolvedValueOnce(null);
    await expect(completeContestFinalizationPayment("pay-1")).rejects.toThrow(
      "Not a contest finalization payment"
    );

    prismaMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      status: "PENDING",
      purpose: "SUBSCRIPTION",
      userId: "user-1",
      amount: 10,
    });
    await expect(completeContestFinalizationPayment("pay-1")).rejects.toThrow(
      "Not a contest finalization payment"
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("returns when the payment is already completed or the fee row is not pending", async () => {
    prismaMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      status: "COMPLETED",
      purpose: "CONTEST_FINALIZATION",
      userId: "user-1",
      amount: 10,
    });
    await completeContestFinalizationPayment("pay-1");
    expect(
      prismaMock.contestFinalizationPayment.findFirst
    ).not.toHaveBeenCalled();

    prismaMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      status: "PENDING",
      purpose: "CONTEST_FINALIZATION",
      userId: "user-1",
      amount: 10,
    });
    prismaMock.contestFinalizationPayment.findFirst.mockResolvedValueOnce(null);
    await completeContestFinalizationPayment("pay-1");

    prismaMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      status: "PENDING",
      purpose: "CONTEST_FINALIZATION",
      userId: "user-1",
      amount: 10,
    });
    prismaMock.contestFinalizationPayment.findFirst.mockResolvedValueOnce({
      id: "fee-1",
      status: "PAID",
    });
    await completeContestFinalizationPayment("pay-1");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(recordReferralEarningIfAny).not.toHaveBeenCalled();
  });

  it("marks the payment and fee paid and records a referral for a positive amount", async () => {
    prismaMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      status: "PENDING",
      purpose: "CONTEST_FINALIZATION",
      userId: "user-1",
      amount: 25,
    });
    prismaMock.contestFinalizationPayment.findFirst.mockResolvedValueOnce({
      id: "fee-1",
      status: "PENDING",
    });

    await completeContestFinalizationPayment("pay-1");

    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: "pay-1" },
      data: { status: "COMPLETED", paidAt: anyDate() },
    });
    expect(tx.contestFinalizationPayment.update).toHaveBeenCalledWith({
      where: { id: "fee-1" },
      data: { status: "PAID", paidAt: anyDate() },
    });
    expect(recordReferralEarningIfAny).toHaveBeenCalledWith(
      "user-1",
      "pay-1",
      25
    );
  });

  it("skips the referral when the completed amount is zero", async () => {
    prismaMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      status: "PENDING",
      purpose: "CONTEST_FINALIZATION",
      userId: "user-1",
      amount: 0,
    });
    prismaMock.contestFinalizationPayment.findFirst.mockResolvedValueOnce({
      id: "fee-1",
      status: "PENDING",
    });

    await completeContestFinalizationPayment("pay-1");
    expect(recordReferralEarningIfAny).not.toHaveBeenCalled();
  });

  it("expires stale pending rows whose payments already failed", async () => {
    await expireStaleFinalizationPaymentsForContest("contest-1");
    expect(
      prismaMock.contestFinalizationPayment.updateMany
    ).toHaveBeenCalledWith({
      where: {
        contestId: "contest-1",
        status: "PENDING",
        payment: { status: { in: ["EXPIRED", "FAILED", "CANCELED"] } },
      },
      data: { status: "EXPIRED" },
    });
  });
});
