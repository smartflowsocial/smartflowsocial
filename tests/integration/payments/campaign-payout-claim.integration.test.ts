/**
 * Campaign payout claims against Postgres.
 * Requires TEST_DATABASE_URL. No wallet is called.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  claimCampaignPayoutItem,
  recordUnpayableCampaignItem,
  resolveUnknownCampaignPayoutItem,
  settleCampaignPayoutAttempt,
} from "~/features/payments/repositories/campaign-payout-claim.server";
import { prisma } from "~/lib/prisma.server";
import { explicitTestDatabaseUrl } from "~/lib/test-database-target";

const TEST_DATABASE_URL = explicitTestDatabaseUrl(process.env);
const SHOULD_SKIP_DB_TESTS = process.env["SKIP_DATABASE_TESTS"] === "true";

function claimArgs(args: {
  runId: string;
  winner: string;
  amountSats: number;
  paymentHash: string;
  spendCapSats: number | null;
  requested: Array<{ winnerPubkey: string; amountSats: number }>;
}) {
  return {
    runId: args.runId,
    winnerPubkey: args.winner,
    amountSats: args.amountSats,
    idempotencyKey: `${args.runId}:${args.winner}:${args.amountSats}`,
    invoice: `lnbc-test-${args.paymentHash}`,
    paymentHash: args.paymentHash,
    invoiceExpiresAt: new Date(Date.now() + 60_000),
    lnAddressSnapshot: "winner@example.com",
    requestedSpendCapSats: args.spendCapSats,
    requestedWinners: args.requested,
  };
}

describe.skipIf(!TEST_DATABASE_URL || SHOULD_SKIP_DB_TESTS)(
  "campaign payout claims",
  () => {
    const userIds: string[] = [];

    afterEach(async () => {
      if (userIds.length === 0) return;
      await prisma.user.deleteMany({
        where: { id: { in: userIds.splice(0) } },
      });
    });

    async function createRun(spendCapSats: number | null) {
      const user = await prisma.user.create({
        data: {
          npub: `payout-test-${crypto.randomUUID()}`,
          isEnabled: true,
        },
      });
      userIds.push(user.id);
      const run = await prisma.payoutRun.create({
        data: {
          scope: "GIVEAWAY",
          userId: user.id,
          walletMode: "nwc_creator",
          trigger: "manual_trigger",
          idempotencyKey: `giveaway:test:${crypto.randomUUID()}`,
          spendCapSats,
          status: "running",
        },
      });
      return run;
    }

    it("lets only one of two concurrent claims pay the same winner", async () => {
      const run = await createRun(1000);
      const winner = "aa".repeat(32);
      const requested = [{ winnerPubkey: winner, amountSats: 600 }];
      const results = await Promise.all([
        claimCampaignPayoutItem(
          claimArgs({
            runId: run.id,
            winner,
            amountSats: 600,
            paymentHash: "11".repeat(32),
            spendCapSats: 1000,
            requested,
          })
        ),
        claimCampaignPayoutItem(
          claimArgs({
            runId: run.id,
            winner,
            amountSats: 600,
            paymentHash: "22".repeat(32),
            spendCapSats: 1000,
            requested,
          })
        ),
      ]);
      const claimed = results.filter((result) => result.ok);
      expect(claimed).toHaveLength(1);
      const held = results.find((result) => !result.ok);
      if (!held) throw new Error("expected one claim to stay held");
      expect(held.reason).toBe("paying");
      const items = await prisma.payoutItem.findMany({
        where: { runId: run.id },
      });
      expect(items).toHaveLength(1);
      expect(items[0]?.status).toBe("paying");
    });

    it("does not claim a second winner after the budget is reserved", async () => {
      const run = await createRun(600);
      const first = "ab".repeat(32);
      const second = "cd".repeat(32);
      const requested = [
        { winnerPubkey: first, amountSats: 600 },
        { winnerPubkey: second, amountSats: 600 },
      ];
      const paid = await claimCampaignPayoutItem(
        claimArgs({
          runId: run.id,
          winner: first,
          amountSats: 600,
          paymentHash: "33".repeat(32),
          spendCapSats: 600,
          requested,
        })
      );
      expect(paid.ok).toBe(true);
      const blocked = await claimCampaignPayoutItem(
        claimArgs({
          runId: run.id,
          winner: second,
          amountSats: 600,
          paymentHash: "44".repeat(32),
          spendCapSats: 600,
          requested,
        })
      );
      expect(blocked.ok).toBe(false);
      if (blocked.ok) return;
      expect(blocked.reason).toBe("budget_exhausted");
    });

    it("rejects a second use of the same payment hash", async () => {
      const run = await createRun(null);
      const hash = "55".repeat(32);
      const requested = [
        { winnerPubkey: "a1".repeat(32), amountSats: 100 },
        { winnerPubkey: "a2".repeat(32), amountSats: 100 },
      ];
      const first = await claimCampaignPayoutItem(
        claimArgs({
          runId: run.id,
          winner: "a1".repeat(32),
          amountSats: 100,
          paymentHash: hash,
          spendCapSats: null,
          requested,
        })
      );
      expect(first.ok).toBe(true);
      const duplicate = await claimCampaignPayoutItem(
        claimArgs({
          runId: run.id,
          winner: "a2".repeat(32),
          amountSats: 100,
          paymentHash: hash,
          spendCapSats: null,
          requested,
        })
      );
      expect(duplicate).toMatchObject({
        ok: false,
        reason: "duplicate_invoice",
      });
    });

    it("keeps an unknown payout out of a later claim and blocks a failed overwrite", async () => {
      const run = await createRun(1000);
      const winner = "ee".repeat(32);
      const requested = [{ winnerPubkey: winner, amountSats: 100 }];
      const claimed = await claimCampaignPayoutItem(
        claimArgs({
          runId: run.id,
          winner,
          amountSats: 100,
          paymentHash: "66".repeat(32),
          spendCapSats: 1000,
          requested,
        })
      );
      expect(claimed.ok).toBe(true);
      if (!claimed.ok) return;
      await recordUnpayableCampaignItem({
        runId: run.id,
        winnerPubkey: winner,
        amountSats: 100,
        idempotencyKey: `${run.id}:${winner}:100`,
        status: "failed",
        errorCode: "should_not_apply",
        errorMessage: "A failed overwrite must not clear a claim",
      });
      const stillPaying = await prisma.payoutItem.findUnique({
        where: { id: claimed.itemId },
      });
      expect(stillPaying?.status).toBe("paying");

      const settled = await settleCampaignPayoutAttempt({
        itemId: claimed.itemId,
        attemptKey: claimed.attemptKey,
        outcome: "unknown",
        errorCode: "UNCONFIRMED",
        errorMessage: "timeout",
      });
      expect(settled).toBe("updated");
      const again = await claimCampaignPayoutItem(
        claimArgs({
          runId: run.id,
          winner,
          amountSats: 100,
          paymentHash: "77".repeat(32),
          spendCapSats: 1000,
          requested,
        })
      );
      expect(again).toMatchObject({ ok: false, reason: "unknown" });
      const row = await prisma.payoutItem.findUnique({
        where: { id: claimed.itemId },
      });
      expect(row?.paymentHash).toBe("66".repeat(32));
    });

    it("pays again only after an operator confirms the wallet did not pay", async () => {
      const run = await createRun(1000);
      const winner = "ff".repeat(32);
      const requested = [{ winnerPubkey: winner, amountSats: 100 }];
      const claimed = await claimCampaignPayoutItem(
        claimArgs({
          runId: run.id,
          winner,
          amountSats: 100,
          paymentHash: "88".repeat(32),
          spendCapSats: 1000,
          requested,
        })
      );
      expect(claimed.ok).toBe(true);
      if (!claimed.ok) return;
      await settleCampaignPayoutAttempt({
        itemId: claimed.itemId,
        attemptKey: claimed.attemptKey,
        outcome: "unknown",
        errorCode: "UNCONFIRMED",
        errorMessage: "timeout",
      });
      const resolved = await resolveUnknownCampaignPayoutItem({
        itemId: claimed.itemId,
        decision: "confirmed_unpaid",
        note: "Wallet history has no payment for this hash",
      });
      expect(resolved).toEqual({ ok: true });
      const next = await claimCampaignPayoutItem(
        claimArgs({
          runId: run.id,
          winner,
          amountSats: 100,
          paymentHash: "99".repeat(32),
          spendCapSats: 1000,
          requested,
        })
      );
      expect(next.ok).toBe(true);
      const items = await prisma.payoutItem.findMany({
        where: { runId: run.id },
      });
      expect(items).toHaveLength(1);
      expect(items[0]?.status).toBe("paying");
      expect(items[0]?.paymentHash).toBe("99".repeat(32));
    });
  }
);
