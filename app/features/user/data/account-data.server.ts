import {
  purgeReferralRecords,
  removeReferralDataForDeletedAccount,
} from "~/features/referral/repositories/referral-data.server";
import {
  ACCOUNT_DELETE_CONFIRMATION,
  ACCOUNT_DELETE_RELAY_ACK,
  FINANCIAL_RECORD_RETENTION_DAYS,
} from "~/features/user/account-data.constants";
import { enqueueOwnedObjectDeletions } from "~/features/user/data/account-object-cleanup.server";
import { prisma } from "~/lib/prisma.server";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PaymentRetentionInput {
  id: string;
  amount: number;
  status: string;
  purpose: string;
  paymentHash: string;
  paidAt: Date | null;
  createdAt: Date;
}

export function deletionRequestIsConfirmed(input: {
  confirm: string | null;
  acknowledgeRelays: string | null;
}): boolean {
  return (
    input.confirm === ACCOUNT_DELETE_CONFIRMATION &&
    input.acknowledgeRelays === ACCOUNT_DELETE_RELAY_ACK
  );
}

export function toRetainedFinancialRecord(payment: PaymentRetentionInput) {
  return {
    paymentId: payment.id,
    amountSats: payment.amount,
    status: payment.status,
    purpose: payment.purpose,
    paymentHash: payment.paymentHash,
    paidAt: payment.paidAt,
    paymentCreatedAt: payment.createdAt,
  };
}

/**
 * JSON export of the signed-in account. Omits the encrypted wallet connection,
 * session secrets, and Lightning preimages.
 */
export async function exportAccountData(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      npub: true,
      createdAt: true,
      timezone: true,
      userRelays: true,
      publishRelaySource: true,
      uploadProvider: true,
      customBlossomUrl: true,
      nwcEnabled: true,
      preferredNostrClient: true,
      themePreference: true,
    },
  });
  if (!user) return null;

  const [
    posts,
    longFormPosts,
    templates,
    queues,
    subscription,
    payments,
    media,
  ] = await Promise.all([
    prisma.post.findMany({
      where: { userId },
      select: {
        id: true,
        content: true,
        currentState: true,
        nostrEventId: true,
        scheduledAtUtc: true,
        createdAt: true,
        postKind: true,
      },
    }),
    prisma.longFormPost.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        content: true,
        currentState: true,
        nostrEventId: true,
        createdAt: true,
      },
    }),
    prisma.template.findMany({
      where: { userId },
      select: { id: true, name: true, templateType: true, createdAt: true },
    }),
    prisma.queueType.findMany({
      where: { userId },
      select: { id: true, name: true, createdAt: true },
    }),
    prisma.subscription.findUnique({
      where: { userId },
      select: {
        planId: true,
        status: true,
        currentPeriodEnd: true,
        renewalMode: true,
      },
    }),
    prisma.payment.findMany({
      where: { userId },
      select: {
        id: true,
        amount: true,
        status: true,
        purpose: true,
        paymentHash: true,
        paidAt: true,
        createdAt: true,
      },
    }),
    prisma.media.findMany({
      where: { userId },
      select: {
        id: true,
        url: true,
        sha256: true,
        size: true,
        mimeType: true,
        provider: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    limitations: {
      nostrRelays:
        "Events already accepted by relays are not included as deletions. Relays keep their own copies.",
      wallet:
        "The encrypted NWC connection and Lightning preimages are omitted.",
      mediaBytes:
        "This file lists media metadata. Bytes in object storage are not embedded.",
      financialRecords:
        "Deleting the account keeps payment amount, status, purpose, and payment hash without the public key for 12 months.",
      referralRecords:
        "Deleting the account removes your public key from referral records. Commissions that have not been paid out are forfeited.",
    },
    user,
    posts,
    longFormPosts,
    templates,
    queues,
    subscription,
    payments,
    media,
  };
}

/**
 * Deletes the account row and cascaded content. Copies payment facts first,
 * and removes the public key from referral rows. Does not remove events from
 * relays.
 */
export async function deleteAccountData(
  userId: string,
  options?: { ownedObjectKeys?: readonly string[] }
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, npub: true },
  });
  if (!user) return false;

  const payments = await prisma.payment.findMany({
    where: { userId },
    select: {
      id: true,
      amount: true,
      status: true,
      purpose: true,
      paymentHash: true,
      paidAt: true,
      createdAt: true,
    },
  });

  await prisma.$transaction(async (tx) => {
    if (options?.ownedObjectKeys && options.ownedObjectKeys.length > 0) {
      await enqueueOwnedObjectDeletions(tx, userId, options.ownedObjectKeys);
    }
    if (payments.length > 0) {
      await tx.retainedFinancialRecord.createMany({
        data: payments.map((payment) =>
          toRetainedFinancialRecord({
            id: payment.id,
            amount: payment.amount,
            status: payment.status,
            purpose: payment.purpose,
            paymentHash: payment.paymentHash,
            paidAt: payment.paidAt,
            createdAt: payment.createdAt,
          })
        ),
        skipDuplicates: true,
      });
    }
    await tx.referrerPayoutConfig.deleteMany({
      where: { referrerNpub: user.npub },
    });
    await removeReferralDataForDeletedAccount(tx, user.npub);
    await tx.user.delete({ where: { id: userId } });
  });
  return true;
}

/**
 * Deletes retained payment rows and referral payout audit rows older than the
 * retention window, plus referral earnings left behind by deleted accounts.
 */
export async function purgeRetainedRecords(now: Date = new Date()): Promise<{
  success: true;
  cutoffIso: string;
  retainedFinancialRecords: number;
  payoutAuditRows: number;
  deletedAccountEarnings: number;
}> {
  const cutoff = new Date(
    now.getTime() - FINANCIAL_RECORD_RETENTION_DAYS * DAY_MS
  );
  const retained = await prisma.retainedFinancialRecord.deleteMany({
    where: { retainedAt: { lt: cutoff } },
  });
  const referral = await purgeReferralRecords(cutoff);
  return {
    success: true,
    cutoffIso: cutoff.toISOString(),
    retainedFinancialRecords: retained.count,
    payoutAuditRows: referral.payoutAuditRows,
    deletedAccountEarnings: referral.deletedAccountEarnings,
  };
}
