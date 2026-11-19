// @ts-nocheck -- mocked collaborators are narrower than the production types.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const queryRaw = vi.fn((..._args: unknown[]): Promise<unknown> =>
    Promise.resolve([])
  );
  const executeRaw = vi.fn((..._args: unknown[]): Promise<number> =>
    Promise.resolve(1)
  );
  const payoutRun = {
    findUnique: vi.fn(
      (_args: {
        where: { id: string };
        select?: { spendCapSats: boolean };
      }): Promise<unknown> => Promise.resolve(null)
    ),
    update: vi.fn(
      (_args: {
        where: { id: string };
        data: { spendCapSats: number };
      }): Promise<unknown> => Promise.resolve({ id: "run-1" })
    ),
  };
  const payoutItem = {
    findFirst: vi.fn(
      (_args: {
        where: Record<string, unknown>;
        select?: { id: boolean };
      }): Promise<unknown> => Promise.resolve(null)
    ),
    updateMany: vi.fn(
      (_args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }): Promise<{ count: number }> => Promise.resolve({ count: 1 })
    ),
    update: vi.fn(
      (_args: {
        where: { id: string };
        data: Record<string, unknown>;
      }): Promise<unknown> => Promise.resolve({ id: "item-1" })
    ),
  };
  const payoutAttempt = {
    create: vi.fn(
      (_args: {
        data: {
          runId: string;
          itemId: string;
          attemptNumber: number;
          idempotencyKey: string;
          status: string;
          startedAt: Date;
          resolutionNotBefore: Date;
        };
      }): Promise<unknown> => Promise.resolve({ id: "attempt-1" })
    ),
    updateMany: vi.fn(
      (_args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }): Promise<unknown> => Promise.resolve({ count: 1 })
    ),
    findFirst: vi.fn(
      (_args: {
        where: { itemId: string; status: string };
        orderBy: { attemptNumber: "desc" };
        select: { id: boolean };
      }): Promise<unknown> => Promise.resolve(null)
    ),
    findMany: vi.fn(
      (_args: {
        where: { itemId: string };
        select: { startedAt: boolean; resolutionNotBefore: boolean };
      }): Promise<
        Array<{ startedAt: Date; resolutionNotBefore: Date | null }>
      > => Promise.resolve([])
    ),
    update: vi.fn(
      (_args: {
        where: { id: string };
        data: Record<string, unknown>;
      }): Promise<unknown> => Promise.resolve({ id: "attempt-1" })
    ),
  };
  const tx = {
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    payoutRun,
    payoutItem,
    payoutAttempt,
  };
  const $transaction = vi.fn(
    (fn: (client: typeof tx) => Promise<unknown>): Promise<unknown> => fn(tx)
  );
  return {
    queryRaw,
    executeRaw,
    payoutRun,
    payoutItem,
    payoutAttempt,
    tx,
    $transaction,
  };
});

vi.mock("~/lib/prisma.server", () => ({
  prisma: {
    $transaction: db.$transaction,
    payoutItem: db.payoutItem,
    payoutAttempt: db.payoutAttempt,
    payoutRun: db.payoutRun,
  },
}));

import {
  PAYOUT_RESOLUTION_SAFETY_MARGIN_MS,
  resolutionHoldMs,
} from "~/features/payments/campaign-payout-resolution";
import {
  claimCampaignPayoutItem,
  recordUnpayableCampaignItem,
  resolveUnknownCampaignPayoutItem,
  settleCampaignPayoutAttempt,
} from "~/features/payments/repositories/campaign-payout-claim.server";

const WINNER = "ab".repeat(32);
const RUN_ID = "run-1";
const ITEM_ID = "item-1";

function lockedItem(
  overrides: Partial<{
    id: string;
    winnerPubkey: string;
    amountSats: number;
    status: string;
    paymentHash: string | null;
    attemptCount: number;
  }> = {}
) {
  return {
    id: ITEM_ID,
    winnerPubkey: WINNER,
    amountSats: 100,
    status: "pending",
    paymentHash: null as string | null,
    attemptCount: 0,
    ...overrides,
  };
}

function claimArgs(
  overrides: {
    runId?: string;
    winnerPubkey?: string;
    amountSats?: number;
    idempotencyKey?: string;
    invoice?: string;
    paymentHash?: string;
    invoiceExpiresAt?: Date;
    lnAddressSnapshot?: string;
    requestedSpendCapSats?: number | null;
    requestedWinners?: Array<{ winnerPubkey: string; amountSats: number }>;
    resolutionHoldMs?: number;
  } = {}
) {
  return {
    runId: RUN_ID,
    winnerPubkey: WINNER,
    amountSats: 100,
    idempotencyKey: "idem-1",
    invoice: "lnbc1test",
    paymentHash: "hash-1",
    invoiceExpiresAt: new Date("2026-12-01T00:00:00.000Z"),
    lnAddressSnapshot: "winner@example.com",
    requestedSpendCapSats: 1_000 as number | null,
    requestedWinners: [{ winnerPubkey: WINNER, amountSats: 100 }],
    ...overrides,
  };
}

function resetDb(): void {
  db.queryRaw.mockReset();
  db.queryRaw.mockResolvedValue([]);
  db.executeRaw.mockReset();
  db.executeRaw.mockResolvedValue(1);
  db.payoutRun.findUnique.mockReset();
  db.payoutRun.findUnique.mockResolvedValue({ spendCapSats: 1_000 });
  db.payoutRun.update.mockReset();
  db.payoutRun.update.mockResolvedValue({ id: RUN_ID });
  db.payoutItem.findFirst.mockReset();
  db.payoutItem.findFirst.mockResolvedValue(null);
  db.payoutItem.updateMany.mockReset();
  db.payoutItem.updateMany.mockResolvedValue({ count: 1 });
  db.payoutItem.update.mockReset();
  db.payoutItem.update.mockResolvedValue({ id: ITEM_ID });
  db.payoutAttempt.create.mockReset();
  db.payoutAttempt.create.mockResolvedValue({ id: "attempt-1" });
  db.payoutAttempt.updateMany.mockReset();
  db.payoutAttempt.updateMany.mockResolvedValue({ count: 1 });
  db.payoutAttempt.findFirst.mockReset();
  db.payoutAttempt.findFirst.mockResolvedValue(null);
  db.payoutAttempt.findMany.mockReset();
  db.payoutAttempt.findMany.mockResolvedValue([]);
  db.payoutAttempt.update.mockReset();
  db.payoutAttempt.update.mockResolvedValue({ id: "attempt-1" });
  db.$transaction.mockReset();
  db.$transaction.mockImplementation((fn) => fn(db.tx));
}

function primeClaim(
  options: {
    locked?: Array<{ id: string }>;
    items?: Array<ReturnType<typeof lockedItem>>;
    spendCapSats?: number | null;
    runFound?: boolean;
    hashOwner?: { id: string } | null;
    updatedCount?: number;
  } = {}
): void {
  resetDb();
  db.queryRaw
    .mockResolvedValueOnce(options.locked ?? [{ id: RUN_ID }])
    .mockResolvedValueOnce(options.items ?? [lockedItem()]);
  db.payoutRun.findUnique.mockResolvedValue(
    options.runFound === false
      ? null
      : {
          spendCapSats:
            options.spendCapSats === undefined ? 1_000 : options.spendCapSats,
        }
  );
  db.payoutItem.findFirst.mockResolvedValue(options.hashOwner ?? null);
  db.payoutItem.updateMany.mockResolvedValue({
    count: options.updatedCount ?? 1,
  });
}

function itemUpdate(): {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
} {
  const args = db.payoutItem.updateMany.mock.calls.at(-1)?.[0];
  if (!args) throw new Error("expected payoutItem.updateMany");
  return args;
}

function attemptCreate() {
  const data = db.payoutAttempt.create.mock.calls[0]?.[0].data;
  if (!data) throw new Error("expected payout attempt");
  return data;
}

describe("campaign payout claims", () => {
  beforeEach(() => {
    resetDb();
  });

  describe("claimCampaignPayoutItem", () => {
    it("claims a pending winner and records the attempt hold", async () => {
      primeClaim();
      const result = await claimCampaignPayoutItem(
        claimArgs({ resolutionHoldMs: PAYOUT_RESOLUTION_SAFETY_MARGIN_MS })
      );
      if (!result.ok) throw new Error(result.message ?? result.reason);
      expect(result.itemId).toBe(ITEM_ID);
      expect(result.attemptNumber).toBe(1);
      expect(result.attemptKey).toMatch(/^[0-9a-f]{64}$/);
      expect(itemUpdate().where).toEqual({
        id: ITEM_ID,
        status: { in: ["pending", "failed", "claim_needed"] },
      });
      expect(itemUpdate().data["status"]).toBe("paying");
      expect(itemUpdate().data["invoice"]).toBe("lnbc1test");
      expect(itemUpdate().data["paymentHash"]).toBe("hash-1");
      expect(itemUpdate().data["attemptCount"]).toEqual({ increment: 1 });
      expect(itemUpdate().data["errorCode"]).toBeNull();
      const created = attemptCreate();
      expect(created.attemptNumber).toBe(1);
      expect(created.idempotencyKey).toBe(result.attemptKey);
      expect(
        created.resolutionNotBefore.getTime() - created.startedAt.getTime()
      ).toBe(PAYOUT_RESOLUTION_SAFETY_MARGIN_MS);
      expect(db.payoutRun.update).not.toHaveBeenCalled();
    });

    it("claims failed and claim_needed rows and falls back to the max hold", async () => {
      primeClaim({
        items: [lockedItem({ status: "claim_needed", attemptCount: 2 })],
      });
      const claimed = await claimCampaignPayoutItem(claimArgs());
      if (!claimed.ok) throw new Error(claimed.reason);
      expect(claimed.attemptNumber).toBe(3);
      const maxHold = attemptCreate();
      expect(
        maxHold.resolutionNotBefore.getTime() - maxHold.startedAt.getTime()
      ).toBe(resolutionHoldMs());

      primeClaim({ items: [lockedItem({ status: "failed" })] });
      const failedRetry = await claimCampaignPayoutItem(
        claimArgs({ resolutionHoldMs: 1.5 })
      );
      if (!failedRetry.ok) throw new Error(failedRetry.reason);
      const fallback = attemptCreate();
      expect(
        fallback.resolutionNotBefore.getTime() - fallback.startedAt.getTime()
      ).toBe(resolutionHoldMs());

      primeClaim();
      const shortHold = await claimCampaignPayoutItem(
        claimArgs({ resolutionHoldMs: PAYOUT_RESOLUTION_SAFETY_MARGIN_MS - 1 })
      );
      if (!shortHold.ok) throw new Error(shortHold.reason);
      expect(shortHold.attemptNumber).toBe(1);
    });

    it("rejects payouts that are already paid, skipped, or in flight", async () => {
      const cases: Array<{
        status: string;
        paymentHash: string | null;
        expected: Record<string, unknown>;
      }> = [
        {
          status: "paid",
          paymentHash: "paid-hash",
          expected: {
            ok: false,
            reason: "already_paid",
            itemId: ITEM_ID,
            paymentHash: "paid-hash",
            amountSats: 100,
          },
        },
        {
          status: "skipped",
          paymentHash: null,
          expected: { ok: false, reason: "skipped", itemId: ITEM_ID },
        },
        {
          status: "paying",
          paymentHash: "paying-hash",
          expected: {
            ok: false,
            reason: "paying",
            itemId: ITEM_ID,
            paymentHash: "paying-hash",
            amountSats: 100,
            message:
              "This payout may already have been sent. Automatic retry is blocked.",
          },
        },
        {
          status: "unknown",
          paymentHash: null,
          expected: {
            ok: false,
            reason: "unknown",
            itemId: ITEM_ID,
            paymentHash: null,
            amountSats: 100,
            message:
              "This payout may already have been sent. Automatic retry is blocked.",
          },
        },
      ];

      for (const entry of cases) {
        primeClaim({
          items: [
            lockedItem({
              status: entry.status,
              paymentHash: entry.paymentHash,
            }),
          ],
        });
        await expect(claimCampaignPayoutItem(claimArgs())).resolves.toEqual(
          entry.expected
        );
        expect(db.payoutItem.updateMany).not.toHaveBeenCalled();
        expect(db.payoutRun.findUnique).not.toHaveBeenCalled();
      }
    });

    it("reports a missing run, a missing item, and an unclaimable status", async () => {
      primeClaim({ locked: [] });
      await expect(claimCampaignPayoutItem(claimArgs())).resolves.toEqual({
        ok: false,
        reason: "not_claimable",
        message: "Payout run was not found",
      });
      expect(db.executeRaw).not.toHaveBeenCalled();

      primeClaim({ items: [] });
      await expect(claimCampaignPayoutItem(claimArgs())).resolves.toEqual({
        ok: false,
        reason: "not_claimable",
        message: "Payout item was not found",
      });

      primeClaim({
        items: [lockedItem({ winnerPubkey: "cd".repeat(32) })],
      });
      await expect(claimCampaignPayoutItem(claimArgs())).resolves.toEqual({
        ok: false,
        reason: "not_claimable",
        message: "Payout item was not found",
      });

      primeClaim({ items: [lockedItem({ status: "cancelled" })] });
      await expect(claimCampaignPayoutItem(claimArgs())).resolves.toEqual({
        ok: false,
        reason: "not_claimable",
        itemId: ITEM_ID,
        message: "Payout item cannot be claimed",
      });
    });

    it("rejects an amount mismatch and a lost race", async () => {
      primeClaim({ items: [lockedItem({ amountSats: 80 })] });
      await expect(
        claimCampaignPayoutItem(claimArgs({ amountSats: 100 }))
      ).resolves.toEqual({
        ok: false,
        reason: "amount_mismatch",
        itemId: ITEM_ID,
        amountSats: 80,
        message: "Winner allocation does not match the stored payout amount",
      });
      expect(db.payoutRun.findUnique).not.toHaveBeenCalled();

      primeClaim({ updatedCount: 0 });
      await expect(claimCampaignPayoutItem(claimArgs())).resolves.toEqual({
        ok: false,
        reason: "not_claimable",
        itemId: ITEM_ID,
        message: "Payout item was claimed by another worker",
      });
      expect(db.payoutAttempt.create).not.toHaveBeenCalled();
    });

    it("tightens the spend cap and stops when the budget cannot pay", async () => {
      primeClaim({
        items: [lockedItem({ amountSats: 40 })],
        spendCapSats: 1_000,
      });
      const tightened = await claimCampaignPayoutItem(
        claimArgs({
          amountSats: 40,
          requestedSpendCapSats: 50,
          requestedWinners: [{ winnerPubkey: WINNER, amountSats: 40 }],
        })
      );
      if (!tightened.ok) throw new Error(tightened.reason);
      expect(db.payoutRun.update.mock.calls[0]?.[0]).toEqual({
        where: { id: RUN_ID },
        data: { spendCapSats: 50 },
      });

      primeClaim({ spendCapSats: 50 });
      await expect(
        claimCampaignPayoutItem(
          claimArgs({
            requestedSpendCapSats: 50,
            requestedWinners: [{ winnerPubkey: WINNER, amountSats: 100 }],
          })
        )
      ).resolves.toEqual({
        ok: false,
        reason: "budget_exhausted",
        itemId: ITEM_ID,
        message: "Invoice amount exceeds the campaign's remaining budget",
      });
      expect(db.payoutRun.update).not.toHaveBeenCalled();
      expect(db.payoutItem.updateMany).not.toHaveBeenCalled();

      primeClaim({
        items: [lockedItem({ amountSats: 0 })],
        spendCapSats: null,
      });
      await expect(
        claimCampaignPayoutItem(
          claimArgs({
            amountSats: 0,
            requestedSpendCapSats: null,
            requestedWinners: [{ winnerPubkey: WINNER, amountSats: 0 }],
          })
        )
      ).resolves.toEqual({
        ok: false,
        reason: "budget_exhausted",
        itemId: ITEM_ID,
        message: "Stored payout amount is not a whole number of sats",
      });

      primeClaim({
        items: [
          lockedItem(),
          lockedItem({
            id: "item-2",
            winnerPubkey: "cd".repeat(32),
            amountSats: 1.5,
          }),
        ],
      });
      await expect(claimCampaignPayoutItem(claimArgs())).resolves.toMatchObject(
        {
          ok: false,
          reason: "budget_exhausted",
          message: "Stored payout amount is not a whole number of sats",
        }
      );

      primeClaim({ spendCapSats: 1.5, runFound: true });
      const ignoredCap = await claimCampaignPayoutItem(
        claimArgs({ requestedSpendCapSats: null })
      );
      if (!ignoredCap.ok) throw new Error(ignoredCap.reason);
      expect(db.payoutRun.update).not.toHaveBeenCalled();

      primeClaim({ runFound: false });
      const missingRunRow = await claimCampaignPayoutItem(claimArgs());
      if (!missingRunRow.ok) throw new Error(missingRunRow.reason);
      expect(db.payoutRun.update.mock.calls[0]?.[0].data).toEqual({
        spendCapSats: 1_000,
      });

      primeClaim({ spendCapSats: 0 });
      await expect(
        claimCampaignPayoutItem(claimArgs({ requestedSpendCapSats: 0 }))
      ).resolves.toMatchObject({
        ok: false,
        reason: "budget_exhausted",
      });
    });

    it("rejects a duplicate invoice from a row or a unique violation", async () => {
      primeClaim({ hashOwner: { id: "other-item" } });
      await expect(claimCampaignPayoutItem(claimArgs())).resolves.toEqual({
        ok: false,
        reason: "duplicate_invoice",
        message: "This invoice was already used for a payout",
      });
      expect(db.payoutItem.findFirst.mock.calls[0]?.[0].where).toEqual({
        paymentHash: "hash-1",
        NOT: { id: ITEM_ID },
      });
      expect(db.payoutItem.updateMany).not.toHaveBeenCalled();

      const duplicate = {
        ok: false as const,
        reason: "duplicate_invoice" as const,
        message: "This invoice was already used for a payout",
      };
      const uniqueErrors: unknown[] = [
        { code: "P2002" },
        { code: "23505" },
        { code: 23505 },
        new Error("duplicate key value violates 23505"),
        { toString: () => "23505" },
      ];
      for (const error of uniqueErrors) {
        resetDb();
        db.$transaction.mockRejectedValueOnce(error);
        await expect(claimCampaignPayoutItem(claimArgs())).resolves.toEqual(
          duplicate
        );
      }

      resetDb();
      db.$transaction.mockRejectedValueOnce(new Error("boom"));
      await expect(claimCampaignPayoutItem(claimArgs())).rejects.toThrow(
        "boom"
      );

      resetDb();
      db.$transaction.mockRejectedValueOnce("boom");
      await expect(claimCampaignPayoutItem(claimArgs())).rejects.toBe("boom");

      resetDb();
      db.$transaction.mockRejectedValueOnce(null);
      await expect(claimCampaignPayoutItem(claimArgs())).rejects.toBeNull();

      resetDb();
      db.$transaction.mockRejectedValueOnce({ code: "P2003" });
      await expect(claimCampaignPayoutItem(claimArgs())).rejects.toEqual({
        code: "P2003",
      });
    });
  });

  describe("recordUnpayableCampaignItem", () => {
    it("inserts a pending row and then stores the unpayable status", async () => {
      await recordUnpayableCampaignItem({
        runId: RUN_ID,
        winnerPubkey: WINNER,
        amountSats: 25,
        idempotencyKey: "idem-1",
        status: "failed",
        errorCode: "no_ln",
        errorMessage: "x".repeat(520),
        lnAddressSnapshot: "a@b.c",
      });
      expect(db.executeRaw).toHaveBeenCalled();
      expect(itemUpdate().where).toEqual({
        runId: RUN_ID,
        winnerPubkey: WINNER,
        status: { in: ["pending", "failed", "claim_needed"] },
      });
      expect(itemUpdate().data).toEqual({
        status: "failed",
        errorCode: "no_ln",
        errorMessage: "x".repeat(500),
        lnAddressSnapshot: "a@b.c",
      });

      await recordUnpayableCampaignItem({
        runId: RUN_ID,
        winnerPubkey: WINNER,
        amountSats: 25,
        idempotencyKey: "idem-1",
        status: "skipped",
        errorCode: "no_ln",
        errorMessage: "skip",
      });
      expect(itemUpdate().data).toEqual({
        status: "skipped",
        errorCode: "no_ln",
        errorMessage: "skip",
      });

      await recordUnpayableCampaignItem({
        runId: RUN_ID,
        winnerPubkey: WINNER,
        amountSats: 25,
        idempotencyKey: "idem-1",
        status: "claim_needed",
        errorCode: "no_ln",
        errorMessage: "need",
        lnAddressSnapshot: null,
      });
      expect(itemUpdate().data["status"]).toBe("claim_needed");
      expect(itemUpdate().data["lnAddressSnapshot"]).toBeNull();
    });
  });

  describe("settleCampaignPayoutAttempt", () => {
    it("settles paid, failed, and unknown attempts", async () => {
      await expect(
        settleCampaignPayoutAttempt({
          itemId: ITEM_ID,
          outcome: "paid",
          preimage: "preimage",
          attemptKey: "attempt-key",
        })
      ).resolves.toBe("updated");
      expect(itemUpdate().where).toEqual({
        id: ITEM_ID,
        status: { in: ["paying", "unknown"] },
      });
      expect(itemUpdate().data).toEqual({
        status: "paid",
        paymentPreimage: "preimage",
        errorCode: null,
        errorMessage: null,
      });
      expect(db.payoutAttempt.updateMany.mock.calls[0]?.[0].where).toEqual({
        idempotencyKey: "attempt-key",
        status: "started",
      });
      expect(
        db.payoutAttempt.updateMany.mock.calls[0]?.[0].data["status"]
      ).toBe("succeeded");
      expect(
        db.payoutAttempt.updateMany.mock.calls[0]?.[0].data[
          "walletResponseJson"
        ]
      ).toBeUndefined();
      expect(db.payoutAttempt.findFirst).not.toHaveBeenCalled();

      await settleCampaignPayoutAttempt({
        itemId: ITEM_ID,
        outcome: "failed",
        errorCode: "timeout",
        errorMessage: "y".repeat(520),
        attemptKey: "attempt-key",
        walletResponse: { sent: false },
      });
      expect(itemUpdate().where["status"]).toEqual({ in: ["paying"] });
      expect(itemUpdate().data).toEqual({
        status: "failed",
        errorCode: "timeout",
        errorMessage: "y".repeat(500),
      });
      expect(
        db.payoutAttempt.updateMany.mock.calls.at(-1)?.[0].data
      ).toMatchObject({
        status: "failed",
        errorCode: "timeout",
        errorMessage: "y".repeat(500),
        walletResponseJson: { sent: false },
      });

      await settleCampaignPayoutAttempt({
        itemId: ITEM_ID,
        outcome: "unknown",
        attemptKey: "attempt-key",
      });
      expect(itemUpdate().data).toEqual({
        status: "unknown",
        errorCode: null,
        errorMessage: null,
      });
      expect(
        db.payoutAttempt.updateMany.mock.calls.at(-1)?.[0].data["status"]
      ).toBe("unknown");
    });

    it("ignores a stale item and updates the open attempt when no key is given", async () => {
      db.payoutItem.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        settleCampaignPayoutAttempt({ itemId: ITEM_ID, outcome: "paid" })
      ).resolves.toBe("ignored");
      expect(db.payoutAttempt.findFirst).not.toHaveBeenCalled();

      db.payoutAttempt.findFirst.mockResolvedValueOnce({ id: "open-1" });
      await expect(
        settleCampaignPayoutAttempt({
          itemId: ITEM_ID,
          outcome: "failed",
          errorCode: "lost",
          walletResponse: { raw: "wallet" },
        })
      ).resolves.toBe("updated");
      expect(db.payoutAttempt.findFirst.mock.calls[0]?.[0]).toEqual({
        where: { itemId: ITEM_ID, status: "started" },
        orderBy: { attemptNumber: "desc" },
        select: { id: true },
      });
      expect(db.payoutAttempt.update.mock.calls[0]?.[0].where).toEqual({
        id: "open-1",
      });
      expect(db.payoutAttempt.update.mock.calls[0]?.[0].data).toMatchObject({
        status: "failed",
        errorCode: "lost",
        errorMessage: null,
        walletResponseJson: { raw: "wallet" },
      });

      db.payoutAttempt.findFirst.mockResolvedValueOnce(null);
      await expect(
        settleCampaignPayoutAttempt({
          itemId: ITEM_ID,
          outcome: "paid",
        })
      ).resolves.toBe("updated");
      expect(db.payoutAttempt.update).toHaveBeenCalledTimes(1);
      expect(itemUpdate().data["paymentPreimage"]).toBeNull();
    });
  });

  describe("resolveUnknownCampaignPayoutItem", () => {
    function primeItem(snapshot: unknown, status = "unknown"): void {
      db.queryRaw.mockResolvedValueOnce([
        {
          id: ITEM_ID,
          status,
          paymentHash: "hash-1",
          destinationSnapshot: snapshot,
        },
      ]);
    }

    it("requires a note and an in-flight item", async () => {
      await expect(
        resolveUnknownCampaignPayoutItem({
          itemId: ITEM_ID,
          decision: "confirmed_paid",
          note: "  short  ",
        })
      ).resolves.toEqual({
        ok: false,
        error: "Record what the wallet showed before resolving this payout",
      });
      expect(db.$transaction).not.toHaveBeenCalled();

      primeItem(null, "unknown");
      db.queryRaw.mockReset();
      db.queryRaw.mockResolvedValueOnce([]);
      await expect(
        resolveUnknownCampaignPayoutItem({
          itemId: ITEM_ID,
          decision: "confirmed_paid",
          note: "checked!",
        })
      ).resolves.toEqual({ ok: false, error: "Payout item was not found" });

      db.queryRaw.mockReset();
      db.queryRaw.mockResolvedValueOnce([
        {
          id: ITEM_ID,
          status: "failed",
          paymentHash: "hash-1",
          destinationSnapshot: null,
        },
      ]);
      await expect(
        resolveUnknownCampaignPayoutItem({
          itemId: ITEM_ID,
          decision: "confirmed_unpaid",
          note: "  checked!  ",
        })
      ).resolves.toEqual({
        ok: false,
        error: "Only an in-flight or unknown payout can be resolved by hand",
      });
      expect(db.payoutAttempt.findMany).not.toHaveBeenCalled();
    });

    it("refuses unpaid resolution until the attempt deadline has passed", async () => {
      const now = Date.now();
      db.queryRaw.mockResolvedValueOnce([
        {
          id: ITEM_ID,
          status: "paying",
          paymentHash: "hash-1",
          destinationSnapshot: null,
        },
      ]);
      db.payoutAttempt.findMany.mockResolvedValueOnce([]);
      const empty = await resolveUnknownCampaignPayoutItem({
        itemId: ITEM_ID,
        decision: "confirmed_unpaid",
        note: "checked!",
      });
      expect(empty.ok).toBe(false);
      expect(db.payoutItem.update).not.toHaveBeenCalled();

      db.queryRaw.mockResolvedValueOnce([
        {
          id: ITEM_ID,
          status: "paying",
          paymentHash: "hash-1",
          destinationSnapshot: null,
        },
      ]);
      db.payoutAttempt.findMany.mockResolvedValueOnce([
        {
          startedAt: new Date(now - 50_000),
          resolutionNotBefore: new Date(now - 40_000),
        },
        {
          startedAt: new Date(now - 1_000),
          resolutionNotBefore: null,
        },
      ]);
      const missingDeadline = await resolveUnknownCampaignPayoutItem({
        itemId: ITEM_ID,
        decision: "confirmed_unpaid",
        note: "checked!",
      });
      expect(missingDeadline.ok).toBe(false);

      db.queryRaw.mockResolvedValueOnce([
        {
          id: ITEM_ID,
          status: "unknown",
          paymentHash: "hash-1",
          destinationSnapshot: { prior: true },
        },
      ]);
      db.payoutAttempt.findMany.mockResolvedValueOnce([
        {
          startedAt: new Date(now - 10_000),
          resolutionNotBefore: new Date(now + 60_000),
        },
      ]);
      const future = await resolveUnknownCampaignPayoutItem({
        itemId: ITEM_ID,
        decision: "confirmed_unpaid",
        note: "checked!",
      });
      expect(future).toEqual({
        ok: false,
        error:
          "This payment attempt may still be running. Check the wallet after the resolution deadline, then resolve it. Marking it unpaid now could pay the winner twice.",
      });
      expect(db.payoutItem.update).not.toHaveBeenCalled();
    });

    it("marks a confirmed payment and releases a confirmed unpaid invoice", async () => {
      const now = Date.now();
      db.queryRaw.mockResolvedValueOnce([
        {
          id: ITEM_ID,
          status: "unknown",
          paymentHash: "hash-1",
          destinationSnapshot: { prior: true },
        },
      ]);
      await expect(
        resolveUnknownCampaignPayoutItem({
          itemId: ITEM_ID,
          decision: "confirmed_paid",
          note: `  ${"n".repeat(520)}`,
        })
      ).resolves.toEqual({ ok: true });
      expect(db.payoutAttempt.findMany).not.toHaveBeenCalled();
      const paidNote = "n".repeat(500);
      expect(db.payoutItem.update.mock.calls[0]?.[0].data).toEqual({
        status: "paid",
        errorCode: null,
        errorMessage: paidNote,
        destinationSnapshot: {
          prior: true,
          operatorResolution: "confirmed_paid",
          operatorNote: paidNote,
        },
      });
      expect(db.payoutAttempt.updateMany.mock.calls[0]?.[0]).toEqual({
        where: { itemId: ITEM_ID, status: "started" },
        data: {
          status: "succeeded",
          finishedAt:
            db.payoutAttempt.updateMany.mock.calls[0]?.[0].data.finishedAt,
          errorMessage: paidNote,
        },
      });
      expect(
        db.payoutAttempt.updateMany.mock.calls[0]?.[0].data.finishedAt
      ).toBeInstanceOf(Date);

      db.queryRaw.mockResolvedValueOnce([
        {
          id: ITEM_ID,
          status: "paying",
          paymentHash: "hash-1",
          destinationSnapshot: ["nope"],
        },
      ]);
      db.payoutAttempt.findMany.mockResolvedValueOnce([
        {
          startedAt: new Date(now - 80_000),
          resolutionNotBefore: new Date(now - 40_000),
        },
        {
          startedAt: new Date(now - 10_000),
          resolutionNotBefore: new Date(now - 1_000),
        },
        {
          startedAt: new Date(now - 20_000),
          resolutionNotBefore: new Date(now - 30_000),
        },
      ]);
      await expect(
        resolveUnknownCampaignPayoutItem({
          itemId: ITEM_ID,
          decision: "confirmed_unpaid",
          note: "wallet clear",
        })
      ).resolves.toEqual({ ok: true });
      expect(db.payoutItem.update.mock.calls.at(-1)?.[0].data).toEqual({
        status: "failed",
        paymentHash: null,
        errorCode: "operator_confirmed_unpaid",
        errorMessage: "wallet clear",
        destinationSnapshot: {
          operatorResolution: "confirmed_unpaid",
          operatorNote: "wallet clear",
          releasedPaymentHash: "hash-1",
        },
      });
      expect(
        db.payoutAttempt.updateMany.mock.calls.at(-1)?.[0].data["status"]
      ).toBe("failed");

      db.queryRaw.mockResolvedValueOnce([
        {
          id: ITEM_ID,
          status: "unknown",
          paymentHash: null,
          destinationSnapshot: "note",
        },
      ]);
      await resolveUnknownCampaignPayoutItem({
        itemId: ITEM_ID,
        decision: "confirmed_paid",
        note: "checked!",
      });
      expect(
        db.payoutItem.update.mock.calls.at(-1)?.[0].data["destinationSnapshot"]
      ).toEqual({
        operatorResolution: "confirmed_paid",
        operatorNote: "checked!",
      });
    });
  });
});
