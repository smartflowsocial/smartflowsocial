// @ts-nocheck -- mocked collaborators are narrower than the production types.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface RunUpdateArgs {
  where: { id: string };
  data: Record<string, unknown>;
}

interface ItemWriteArgs {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
  update?: Record<string, unknown>;
  create?: Record<string, unknown>;
}

interface AttemptWriteArgs {
  where?: { idempotencyKey: string };
  data: Record<string, unknown>;
}

interface TxClient {
  $executeRaw: ReturnType<
    typeof vi.fn<
      (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number>
    >
  >;
  payoutRun: {
    findUnique: ReturnType<
      typeof vi.fn<
        (args: {
          where: { idempotencyKey: string };
        }) => Promise<{ id: string } | null>
      >
    >;
    update: ReturnType<
      typeof vi.fn<(args: RunUpdateArgs) => Promise<{ id: string }>>
    >;
  };
}

const prismaMock = vi.hoisted(() => ({
  $transaction:
    vi.fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>(),
  payoutRun: {
    findUnique:
      vi.fn<
        (args: {
          where: { idempotencyKey: string };
        }) => Promise<{ id: string } | null>
      >(),
    update: vi.fn<(args: RunUpdateArgs) => Promise<{ id: string }>>(),
  },
  payoutItem: {
    upsert: vi.fn<(args: ItemWriteArgs) => Promise<{ id: string }>>(),
    update: vi.fn<(args: ItemWriteArgs) => Promise<{ id: string }>>(),
    findMany:
      vi.fn<
        (args: { where: { runId: string } }) => Promise<Array<{ id: string }>>
      >(),
  },
  payoutAttempt: {
    create: vi.fn<(args: AttemptWriteArgs) => Promise<{ id: string }>>(),
    update: vi.fn<(args: AttemptWriteArgs) => Promise<{ id: string }>>(),
  },
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));

import {
  createPayoutAttempt,
  findOrCreatePayoutRunByIdempotencyKey,
  findPayoutRunByIdempotencyKey,
  listPayoutItemsByRunId,
  updatePayoutAttemptByIdempotencyKey,
  updatePayoutItem,
  updatePayoutRun,
  upsertPayoutItemByRunAndWinner,
  withPayoutLedgerTransaction,
} from "~/features/payments/repositories/payout-ledger-data.server";

function rawValues(call: readonly unknown[] | undefined): unknown[] {
  if (!call) throw new Error("missing executeRaw call");
  return call.slice(1);
}

function asRunTx(
  value: TxClient
): Parameters<typeof findOrCreatePayoutRunByIdempotencyKey>[0] {
  return value as unknown as Parameters<
    typeof findOrCreatePayoutRunByIdempotencyKey
  >[0];
}

describe("payout ledger data", () => {
  const tx: TxClient = {
    $executeRaw: vi.fn<
      (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number>
    >(async () => 1),
    payoutRun: {
      findUnique:
        vi.fn<
          (args: {
            where: { idempotencyKey: string };
          }) => Promise<{ id: string } | null>
        >(),
      update: vi.fn<(args: RunUpdateArgs) => Promise<{ id: string }>>(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn) => fn("tx-marker"));
    prismaMock.payoutRun.findUnique.mockResolvedValue({ id: "run-1" });
    prismaMock.payoutRun.update.mockResolvedValue({ id: "run-1" });
    prismaMock.payoutItem.upsert.mockResolvedValue({ id: "item-1" });
    prismaMock.payoutItem.update.mockResolvedValue({ id: "item-1" });
    prismaMock.payoutItem.findMany.mockResolvedValue([{ id: "item-1" }]);
    prismaMock.payoutAttempt.create.mockResolvedValue({ id: "attempt-1" });
    prismaMock.payoutAttempt.update.mockResolvedValue({ id: "attempt-1" });
    tx.$executeRaw.mockResolvedValue(1);
    tx.payoutRun.findUnique.mockResolvedValue({ id: "run-1" });
    tx.payoutRun.update.mockResolvedValue({ id: "run-1" });
  });

  it("runs the callback inside prisma.$transaction and returns its value", async () => {
    let seen: unknown;
    const value = await withPayoutLedgerTransaction(async (client) => {
      seen = client;
      return 4;
    });

    expect(value).toBe(4);
    expect(seen).toBe("tx-marker");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("propagates transaction failures", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(new Error("db down"));
    await expect(withPayoutLedgerTransaction(async () => "ok")).rejects.toThrow(
      "db down"
    );

    prismaMock.$transaction.mockRejectedValueOnce("db down");
    await expect(withPayoutLedgerTransaction(async () => "ok")).rejects.toBe(
      "db down"
    );
  });

  it("finds a payout run by idempotency key", async () => {
    await expect(findPayoutRunByIdempotencyKey("giveaway:g1")).resolves.toEqual(
      {
        id: "run-1",
      }
    );
    expect(prismaMock.payoutRun.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: "giveaway:g1" },
    });
  });

  it("inserts a payout run and returns the conflict-safe row", async () => {
    const row = { id: "run-created" };
    tx.payoutRun.findUnique.mockResolvedValue(row);

    await expect(
      findOrCreatePayoutRunByIdempotencyKey(asRunTx(tx), {
        idempotencyKey: "giveaway:g1",
        scope: "GIVEAWAY",
        userId: "user-1",
        walletMode: "manual",
        trigger: "autorun",
        contestId: "contest-1",
        giveawayId: "giveaway-1",
        spendCapSats: 25,
        totalItems: 2,
        totalSats: 80,
      })
    ).resolves.toBe(row);

    const sql = tx.$executeRaw.mock.calls[0]?.[0].join(" ");
    expect(sql).toContain('INSERT INTO "PayoutRun"');
    expect(sql).toContain('ON CONFLICT ("idempotencyKey") DO NOTHING');
    expect(sql).toContain(`'draft'`);
    const values = rawValues(tx.$executeRaw.mock.calls[0]);
    expect(typeof values[0]).toBe("string");
    expect(values.slice(1)).toEqual([
      "GIVEAWAY",
      "user-1",
      "manual",
      "autorun",
      "giveaway:g1",
      "contest-1",
      "giveaway-1",
      25,
      80,
      2,
    ]);
    expect(tx.payoutRun.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: "giveaway:g1" },
    });
  });

  it("stores nulls for omitted optional run fields", async () => {
    tx.payoutRun.findUnique.mockResolvedValue({ id: "run-1" });
    await findOrCreatePayoutRunByIdempotencyKey(asRunTx(tx), {
      idempotencyKey: "contest:unknown",
      scope: "CONTEST",
      userId: "user-2",
      walletMode: "nwc_creator",
      trigger: "manual_trigger",
    });

    expect(rawValues(tx.$executeRaw.mock.calls[0]).slice(1)).toEqual([
      "CONTEST",
      "user-2",
      "nwc_creator",
      "manual_trigger",
      "contest:unknown",
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("throws when the insert does not leave a readable row", async () => {
    tx.payoutRun.findUnique.mockResolvedValue(null);
    await expect(
      findOrCreatePayoutRunByIdempotencyKey(asRunTx(tx), {
        idempotencyKey: "missing",
        scope: "CONTEST",
        userId: "user-1",
        walletMode: "nwc_creator",
        trigger: "autorun",
      })
    ).rejects.toThrow("Payout run was not created");
  });

  it("writes only the payout-run columns that were provided", async () => {
    const completedAt = new Date("2024-02-02T00:00:00.000Z");
    const metadata = { paid: 1 };
    await updatePayoutRun("run-1", {
      status: "complete",
      startedAt: null,
      completedAt,
      eligibilityErrorCode: null,
      eligibilityErrorMessage: "manual",
      totalItems: 0,
      totalSats: null,
      metadataJson: metadata,
    });

    expect(prismaMock.payoutRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: {
        status: "complete",
        startedAt: null,
        completedAt,
        eligibilityErrorCode: null,
        eligibilityErrorMessage: "manual",
        totalItems: 0,
        totalSats: null,
        metadataJson: metadata,
      },
    });

    await updatePayoutRun("run-1", {});
    expect(prismaMock.payoutRun.update.mock.calls[1]?.[0]).toEqual({
      where: { id: "run-1" },
      data: {},
    });

    await updatePayoutRun(
      "run-1",
      { status: "" as unknown as "draft" },
      asRunTx(tx)
    );
    expect(tx.payoutRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: {},
    });
    expect(prismaMock.payoutRun.update).toHaveBeenCalledTimes(2);
  });

  it("uses the transaction client for a payout-run update", async () => {
    await updatePayoutRun("run-9", { status: "running" }, asRunTx(tx));
    expect(tx.payoutRun.update).toHaveBeenCalledWith({
      where: { id: "run-9" },
      data: { status: "running" },
    });
    expect(prismaMock.payoutRun.update).not.toHaveBeenCalled();
  });

  it("upserts a payout item by run and winner", async () => {
    await expect(
      upsertPayoutItemByRunAndWinner({
        runId: "run-1",
        winnerPubkey: "aa",
        amountSats: 15,
        idempotencyKey: "item-key",
      })
    ).resolves.toEqual({ id: "item-1" });

    expect(prismaMock.payoutItem.upsert).toHaveBeenCalledWith({
      where: { runId_winnerPubkey: { runId: "run-1", winnerPubkey: "aa" } },
      update: { amountSats: 15, idempotencyKey: "item-key" },
      create: {
        runId: "run-1",
        winnerPubkey: "aa",
        amountSats: 15,
        idempotencyKey: "item-key",
        status: "pending",
      },
    });
  });

  it("writes only the payout-item columns that were provided", async () => {
    const expiresAt = new Date("2024-03-03T00:00:00.000Z");
    const destination = { lud16: "a@b.com" };
    await updatePayoutItem("item-1", {
      status: "paid",
      lnAddressSnapshot: null,
      destinationSnapshot: destination,
      invoice: "lnbc1",
      invoiceExpiresAt: expiresAt,
      walletRequestId: "req-1",
      paymentPreimage: null,
      paymentHash: "hash",
      errorCode: null,
      errorMessage: "nope",
      attemptCount: 0,
      lastAttemptAt: null,
    });

    expect(prismaMock.payoutItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: {
        status: "paid",
        lnAddressSnapshot: null,
        destinationSnapshot: destination,
        invoice: "lnbc1",
        invoiceExpiresAt: expiresAt,
        walletRequestId: "req-1",
        paymentPreimage: null,
        paymentHash: "hash",
        errorCode: null,
        errorMessage: "nope",
        attemptCount: 0,
        lastAttemptAt: null,
      },
    });

    await updatePayoutItem("item-1", { status: "" as unknown as "pending" });
    expect(prismaMock.payoutItem.update.mock.calls[1]?.[0]).toEqual({
      where: { id: "item-1" },
      data: {},
    });
  });

  it("lists payout items for a run", async () => {
    await expect(listPayoutItemsByRunId("run-1")).resolves.toEqual([
      { id: "item-1" },
    ]);
    expect(prismaMock.payoutItem.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
    });
  });

  it("creates a started payout attempt", async () => {
    await createPayoutAttempt({
      runId: "run-1",
      itemId: "item-1",
      attemptNumber: 2,
      idempotencyKey: "attempt-key",
    });
    const data = prismaMock.payoutAttempt.create.mock.calls[0]?.[0].data;
    expect(data?.["runId"]).toBe("run-1");
    expect(data?.["itemId"]).toBe("item-1");
    expect(data?.["attemptNumber"]).toBe(2);
    expect(data?.["idempotencyKey"]).toBe("attempt-key");
    expect(data?.["status"]).toBe("started");
    expect(data?.["startedAt"]).toBeInstanceOf(Date);
  });

  it("updates an attempt by idempotency key and omits unset columns", async () => {
    const finishedAt = new Date("2024-04-04T00:00:00.000Z");
    const walletResponse = { settled: true };
    await updatePayoutAttemptByIdempotencyKey("attempt-key", {
      status: "paid",
      walletResponseJson: walletResponse,
      errorCode: null,
      errorMessage: "later",
      finishedAt,
    });
    expect(prismaMock.payoutAttempt.update).toHaveBeenCalledWith({
      where: { idempotencyKey: "attempt-key" },
      data: {
        status: "paid",
        walletResponseJson: walletResponse,
        errorCode: null,
        errorMessage: "later",
        finishedAt,
      },
    });

    await updatePayoutAttemptByIdempotencyKey("attempt-key", {
      status: "failed",
    });
    expect(prismaMock.payoutAttempt.update.mock.calls[1]?.[0]).toEqual({
      where: { idempotencyKey: "attempt-key" },
      data: { status: "failed" },
    });
  });
});
