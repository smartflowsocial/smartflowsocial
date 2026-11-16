import type { StoredFinalizationRecord } from "~/features/payments/campaign-finalization-charge";
import { recordReferralEarningIfAny } from "~/features/referral/record-referral-earning.server";
import { prisma } from "~/lib/prisma.server";

export async function findPaidContestFinalizationForLock(
  contestId: string,
  userId: string,
  lockConfigHash: string
): Promise<boolean> {
  const row = await prisma.contestFinalizationPayment.findFirst({
    where: {
      contestId,
      userId,
      lockConfigHash,
      status: "PAID",
    },
    select: { id: true },
  });
  return !!row;
}

export async function listContestFinalizationRecords(
  contestId: string,
  userId: string
): Promise<StoredFinalizationRecord[]> {
  const rows = await prisma.contestFinalizationPayment.findMany({
    where: { contestId, userId },
    select: {
      id: true,
      status: true,
      feeRateBps: true,
      feeSats: true,
      lockConfigHash: true,
      paymentId: true,
      payment: { select: { status: true, expiresAt: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    feeRateBps: row.feeRateBps,
    feeSats: row.feeSats,
    lockConfigHash: row.lockConfigHash,
    paymentId: row.paymentId,
    paymentStatus: row.payment?.status ?? null,
    paymentExpiresAtMs: row.payment?.expiresAt?.getTime() ?? null,
  }));
}

export async function findReusableContestFinalizationInvoice(
  paymentId: string
) {
  return prisma.payment.findFirst({
    where: {
      id: paymentId,
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
}

export async function expireContestFinalizationByIds(
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  const pending = await prisma.contestFinalizationPayment.findMany({
    where: { id: { in: ids }, status: "PENDING" },
    select: { id: true, paymentId: true },
  });
  for (const row of pending) {
    await prisma.$transaction(async (tx) => {
      await tx.contestFinalizationPayment.update({
        where: { id: row.id },
        data: { status: "EXPIRED" },
      });
      if (row.paymentId) {
        await tx.payment.updateMany({
          where: { id: row.paymentId, status: "PENDING" },
          data: {
            status: "EXPIRED",
            failedAt: new Date(),
            failureReason: "Superseded by new finalization invoice",
          },
        });
      }
    });
  }
}

export async function completeContestFinalizationPayment(
  paymentId: string
): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      purpose: true,
      userId: true,
      amount: true,
    },
  });
  if (payment?.purpose !== "CONTEST_FINALIZATION") {
    throw new Error("Not a contest finalization payment");
  }
  if (payment.status === "COMPLETED") return;

  const finalization = await prisma.contestFinalizationPayment.findFirst({
    where: { paymentId },
  });
  if (finalization?.status !== "PENDING") return;

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: "COMPLETED", paidAt: new Date() },
    });
    await tx.contestFinalizationPayment.update({
      where: { id: finalization.id },
      data: { status: "PAID", paidAt: new Date() },
    });
  });

  if (payment.amount > 0) {
    await recordReferralEarningIfAny(payment.userId, paymentId, payment.amount);
  }
}

export async function expireStaleFinalizationPaymentsForContest(
  contestId: string
): Promise<void> {
  await prisma.contestFinalizationPayment.updateMany({
    where: {
      contestId,
      status: "PENDING",
      payment: {
        status: { in: ["EXPIRED", "FAILED", "CANCELED"] },
      },
    },
    data: { status: "EXPIRED" },
  });
}
