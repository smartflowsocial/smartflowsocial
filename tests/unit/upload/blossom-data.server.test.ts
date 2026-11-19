// @ts-nocheck -- mocked collaborators are narrower than the production types.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface AggregateArgs {
  where: {
    pubkey: string;
    status: string;
    expiresAt: { gt: Date };
  };
  _sum: { size: boolean };
}

interface UsageWhere {
  where: {
    userId_periodStartUtc: { userId: string; periodStartUtc: Date };
  };
}

interface UsageUpsertArgs extends UsageWhere {
  create: {
    userId: string;
    periodStartUtc: Date;
    uploadedBytes: bigint;
    uploadedFiles: number;
  };
  update: {
    uploadedBytes: { increment: bigint };
    uploadedFiles: { increment: number };
  };
}

interface CommitCreateArgs {
  data: {
    jti: string;
    batchId: string;
    pubkey: string;
    sha256: string;
    size: number;
    mimeType: string | null;
    url: string;
  };
}

interface ReservationUpdateArgs {
  where: { jti: string };
  data: { status: string };
}

interface MediaFindArgs {
  where: { userId: string; url: string };
}

interface MediaCreateArgs {
  data: {
    userId: string;
    url: string;
    sha256: string;
    size: number;
    mimeType: string | null;
    provider: string;
  };
}

interface ReservationRow {
  batchId: string;
  status: string;
  pubkey: string;
  sha256: string;
  size: number;
  batch: { batchId: string; userId: string; provider: string };
}

interface BatchCreateArgs {
  data: {
    batchId: string;
    userId: string;
    pubkey: string;
    provider: string;
    sourceIntentId: string | null;
    totalBytes: bigint;
    expiresAt: Date;
    status: string;
  };
}

interface ItemCreateArgs {
  data: Array<{
    jti: string;
    batchId: string;
    pubkey: string;
    sha256: string;
    size: number;
    mimeType: string;
    expiresAt: Date;
    status: string;
  }>;
}

interface ExpireArgs {
  where: { status: string; expiresAt: { lt: Date } };
  data: { status: string };
}

interface CountArgs {
  where: { status: string; expiresAt: { gt: Date } };
}

interface OldestArgs extends CountArgs {
  orderBy: { createdAt: string };
  select: { createdAt: boolean };
}

interface CommitItem {
  jti: string;
  pubkey: string;
  sha256: string;
  size: number;
  type?: string;
  url: string;
}

const lock = vi.hoisted(() => ({
  lockAccountForWrite: vi.fn(async (_tx: object, _userId: string) => undefined),
}));

const db = vi.hoisted(() => {
  const commitFind = vi.fn(async (_args: { where: { jti: string } }) => null);
  const commitCreate = vi.fn(async (_args: CommitCreateArgs) => ({ id: "c" }));
  const reservationFind = vi.fn(
    async (_args: { where: { jti: string }; include: { batch: boolean } }) =>
      null as ReservationRow | null
  );
  const reservationUpdate = vi.fn(async (_args: ReservationUpdateArgs) => ({
    id: "r",
  }));
  const txUsageUpsert = vi.fn(async (_args: UsageUpsertArgs) => ({ id: "u" }));
  const mediaFind = vi.fn(
    async (_args: MediaFindArgs) => null as { id: string } | null
  );
  const mediaCreate = vi.fn(async (_args: MediaCreateArgs) => ({ id: "m" }));
  const tx = {
    blossomCommit: { findUnique: commitFind, create: commitCreate },
    blossomReservationItem: {
      findUnique: reservationFind,
      update: reservationUpdate,
    },
    blossomUploadUsagePeriod: { upsert: txUsageUpsert },
    media: { findFirst: mediaFind, create: mediaCreate },
  };
  const transaction = vi.fn(
    async (
      input: ((client: typeof tx) => Promise<unknown>) | Array<Promise<unknown>>
    ) => {
      if (typeof input === "function") {
        return input(tx);
      }
      return Promise.all(input);
    }
  );
  const aggregate = vi.fn(async (_args: AggregateArgs) => ({
    _sum: { size: null as number | null },
  }));
  const usageFind = vi.fn(
    async (_args: UsageWhere) => null as { id: string } | null
  );
  const usageUpsert = vi.fn(async (_args: UsageUpsertArgs) => ({
    id: "period",
  }));
  const batchCreate = vi.fn(async (args: BatchCreateArgs) => ({
    id: args.data.batchId,
  }));
  const itemCreateMany = vi.fn(async (args: ItemCreateArgs) => ({
    count: args.data.length,
  }));
  const itemUpdateMany = vi.fn(async (_args: ExpireArgs) => ({ count: 2 }));
  const batchUpdateMany = vi.fn(async (_args: ExpireArgs) => ({ count: 3 }));
  const itemCount = vi.fn(async (_args: CountArgs) => 4);
  const batchCount = vi.fn(async (_args: CountArgs) => 2);
  const oldest = vi.fn(
    async (_args: OldestArgs) => null as { createdAt: Date } | null
  );
  return {
    aggregate,
    batchCount,
    batchCreate,
    batchUpdateMany,
    commitCreate,
    commitFind,
    itemCount,
    itemCreateMany,
    itemUpdateMany,
    mediaCreate,
    mediaFind,
    oldest,
    reservationFind,
    reservationUpdate,
    transaction,
    tx,
    txUsageUpsert,
    usageFind,
    usageUpsert,
  };
});

vi.mock("~/features/user/data/account-write-lock.server", () => ({
  lockAccountForWrite: lock.lockAccountForWrite,
}));
vi.mock("~/lib/prisma.server", () => ({
  prisma: {
    $transaction: db.transaction,
    blossomReservationItem: {
      aggregate: db.aggregate,
      count: db.itemCount,
      createMany: db.itemCreateMany,
      findFirst: db.oldest,
      updateMany: db.itemUpdateMany,
    },
    blossomReservationBatch: {
      count: db.batchCount,
      create: db.batchCreate,
      updateMany: db.batchUpdateMany,
    },
    blossomUploadUsagePeriod: {
      findUnique: db.usageFind,
      upsert: db.usageUpsert,
    },
  },
}));

import {
  aggregateReservedSizeForPubkey,
  commitBlossomBatch,
  createBlossomReservationBatchAndItems,
  expireBlossomReservations,
  findBlossomUsagePeriod,
  getActiveReservedBytesForPubkey,
  getBlossomReservationDriftStats,
  runCommitBlossomItemInTransaction,
  upsertBlossomUsagePeriod,
} from "~/features/upload/repositories/blossom-data.server";
import type { Tx } from "~/features/upload/repositories/blossom-data.server";

const PERIOD = new Date("2026-04-01T00:00:00.000Z");

function item(overrides: Partial<CommitItem> = {}): CommitItem {
  return {
    jti: "jti-1",
    pubkey: "pk",
    sha256: "abc",
    size: 12,
    url: "https://cdn.example/a",
    ...overrides,
  };
}

function reservation(overrides: Partial<ReservationRow> = {}): ReservationRow {
  return {
    batchId: "batch-1",
    status: "RESERVED",
    pubkey: "pk",
    sha256: "abc",
    size: 12,
    batch: {
      batchId: "batch-1",
      userId: "user-1",
      provider: "BLOSSOM_SFS",
    },
    ...overrides,
  };
}

describe("blossom reservation data", () => {
  beforeEach(() => {
    db.aggregate.mockReset();
    db.aggregate.mockResolvedValue({ _sum: { size: null } });
    db.usageFind.mockReset();
    db.usageUpsert.mockReset();
    db.batchCreate.mockClear();
    db.itemCreateMany.mockClear();
    db.itemUpdateMany.mockReset();
    db.itemUpdateMany.mockResolvedValue({ count: 2 });
    db.batchUpdateMany.mockReset();
    db.batchUpdateMany.mockResolvedValue({ count: 3 });
    db.itemCount.mockReset();
    db.itemCount.mockResolvedValue(4);
    db.batchCount.mockReset();
    db.batchCount.mockResolvedValue(2);
    db.oldest.mockReset();
    db.oldest.mockResolvedValue(null);
    db.commitFind.mockReset();
    db.commitFind.mockResolvedValue(null);
    db.commitCreate.mockClear();
    db.reservationFind.mockReset();
    db.reservationFind.mockResolvedValue(null);
    db.reservationUpdate.mockClear();
    db.txUsageUpsert.mockClear();
    db.mediaFind.mockReset();
    db.mediaFind.mockResolvedValue(null);
    db.mediaCreate.mockClear();
    db.transaction.mockClear();
    lock.lockAccountForWrite.mockReset();
    lock.lockAccountForWrite.mockResolvedValue(undefined);
  });

  it("reads reserved bytes and the usage period row", async () => {
    const aggregate = { _sum: { size: 9 } };
    db.aggregate.mockResolvedValueOnce(aggregate);
    await expect(aggregateReservedSizeForPubkey("pk")).resolves.toBe(aggregate);
    const aggregateArgs = db.aggregate.mock.calls[0]?.[0];
    expect(aggregateArgs?._sum).toEqual({ size: true });
    expect(aggregateArgs?.where.pubkey).toBe("pk");
    expect(aggregateArgs?.where.status).toBe("RESERVED");
    expect(aggregateArgs?.where.expiresAt.gt).toBeInstanceOf(Date);

    const row = { id: "period-1" };
    db.usageFind.mockResolvedValueOnce(row);
    await expect(findBlossomUsagePeriod("user-1", PERIOD)).resolves.toBe(row);
    expect(db.usageFind).toHaveBeenCalledWith({
      where: {
        userId_periodStartUtc: { userId: "user-1", periodStartUtc: PERIOD },
      },
    });
    db.usageFind.mockResolvedValueOnce(null);
    await expect(findBlossomUsagePeriod("user-1", PERIOD)).resolves.toBeNull();
  });

  it("turns a missing size sum into zero reserved bytes", async () => {
    db.aggregate.mockResolvedValueOnce({ _sum: { size: null } });
    await expect(getActiveReservedBytesForPubkey("pk")).resolves.toBe(0n);
    db.aggregate.mockResolvedValueOnce({ _sum: { size: 0 } });
    await expect(getActiveReservedBytesForPubkey("pk")).resolves.toBe(0n);
    db.aggregate.mockResolvedValueOnce({ _sum: { size: 15 } });
    await expect(getActiveReservedBytesForPubkey("pk")).resolves.toBe(15n);
  });

  it("reports reservation drift with and without an oldest row", async () => {
    await expect(getBlossomReservationDriftStats()).resolves.toEqual({
      reservedCount: 4,
      activeBatchCount: 2,
      oldestReservedCreatedAt: null,
    });
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    db.oldest.mockResolvedValueOnce({ createdAt });
    await expect(getBlossomReservationDriftStats()).resolves.toEqual({
      reservedCount: 4,
      activeBatchCount: 2,
      oldestReservedCreatedAt: createdAt,
    });
    const oldestArgs = db.oldest.mock.calls[0]?.[0];
    expect(oldestArgs?.orderBy).toEqual({ createdAt: "asc" });
    expect(oldestArgs?.select).toEqual({ createdAt: true });
    expect(oldestArgs?.where.status).toBe("RESERVED");
    expect(db.batchCount.mock.calls[0]?.[0].where.status).toBe("ACTIVE");
  });

  it("skips non-positive usage and truncates a positive size", async () => {
    await upsertBlossomUsagePeriod("user-1", PERIOD, Number.NaN);
    await upsertBlossomUsagePeriod("user-1", PERIOD, Number.POSITIVE_INFINITY);
    await upsertBlossomUsagePeriod("user-1", PERIOD, 0);
    await upsertBlossomUsagePeriod("user-1", PERIOD, -4);
    expect(db.usageUpsert).not.toHaveBeenCalled();

    await upsertBlossomUsagePeriod("user-1", PERIOD, 2.9);
    expect(db.usageUpsert).toHaveBeenCalledWith({
      where: {
        userId_periodStartUtc: { userId: "user-1", periodStartUtc: PERIOD },
      },
      create: {
        userId: "user-1",
        periodStartUtc: PERIOD,
        uploadedBytes: BigInt(2),
        uploadedFiles: 1,
      },
      update: {
        uploadedBytes: { increment: BigInt(2) },
        uploadedFiles: { increment: 1 },
      },
    });
  });

  it("expires reserved items and active batches", async () => {
    const now = new Date("2026-05-01T00:00:00.000Z");
    await expect(expireBlossomReservations(now)).resolves.toEqual({
      itemsExpired: 2,
      batchesExpired: 3,
    });
    expect(db.itemUpdateMany).toHaveBeenCalledWith({
      where: { status: "RESERVED", expiresAt: { lt: now } },
      data: { status: "EXPIRED" },
    });
    expect(db.batchUpdateMany).toHaveBeenCalledWith({
      where: { status: "ACTIVE", expiresAt: { lt: now } },
      data: { status: "EXPIRED" },
    });
  });

  it("propagates expire failures from Error and string throws", async () => {
    db.itemUpdateMany.mockRejectedValueOnce(new Error("item expire"));
    await expect(expireBlossomReservations(new Date())).rejects.toThrow(
      "item expire"
    );
    db.batchUpdateMany.mockRejectedValueOnce("batch expire");
    await expect(expireBlossomReservations(new Date())).rejects.toBe(
      "batch expire"
    );
  });

  it("writes a reservation batch and its items", async () => {
    const expiresAt = new Date("2026-05-02T00:00:00.000Z");
    await createBlossomReservationBatchAndItems(
      "batch-1",
      "user-1",
      "pk",
      "BLOSSOM_CUSTOM",
      "intent-1",
      BigInt(30),
      expiresAt,
      [
        { jti: "j1", sha256: "a", size: 10, mimeType: "image/png" },
        { jti: "j2", sha256: "b", size: 20, mimeType: "video/mp4" },
      ]
    );
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.batchCreate).toHaveBeenCalledWith({
      data: {
        batchId: "batch-1",
        userId: "user-1",
        pubkey: "pk",
        provider: "BLOSSOM_CUSTOM",
        sourceIntentId: "intent-1",
        totalBytes: BigInt(30),
        expiresAt,
        status: "ACTIVE",
      },
    });
    expect(db.itemCreateMany).toHaveBeenCalledWith({
      data: [
        {
          jti: "j1",
          batchId: "batch-1",
          pubkey: "pk",
          sha256: "a",
          size: 10,
          mimeType: "image/png",
          expiresAt,
          status: "RESERVED",
        },
        {
          jti: "j2",
          batchId: "batch-1",
          pubkey: "pk",
          sha256: "b",
          size: 20,
          mimeType: "video/mp4",
          expiresAt,
          status: "RESERVED",
        },
      ],
    });

    await createBlossomReservationBatchAndItems(
      "batch-2",
      "user-1",
      "pk",
      "S3",
      null,
      BigInt(1),
      expiresAt,
      []
    );
    expect(db.batchCreate.mock.calls[1]?.[0].data.sourceIntentId).toBeNull();
    expect(db.batchCreate.mock.calls[1]?.[0].data.provider).toBe("S3");
  });

  it("rejects a commit that is already stored or has no live reservation", async () => {
    db.commitFind.mockResolvedValueOnce({ jti: "jti-1" });
    await expect(
      runCommitBlossomItemInTransaction(txClient(), item(), "batch-1", PERIOD)
    ).resolves.toBe("duplicate");
    expect(db.reservationFind).not.toHaveBeenCalled();

    db.commitFind.mockResolvedValueOnce(null);
    db.reservationFind.mockResolvedValueOnce(null);
    await expect(
      runCommitBlossomItemInTransaction(txClient(), item(), "batch-1", PERIOD)
    ).rejects.toThrow("reservation_not_found");
  });

  it("rejects batch, status, pubkey, and payload mismatches", async () => {
    db.reservationFind.mockResolvedValueOnce(
      reservation({
        batchId: "other",
        batch: { batchId: "batch-1", userId: "user-1", provider: "S3" },
      })
    );
    await expect(
      runCommitBlossomItemInTransaction(txClient(), item(), "batch-1", PERIOD)
    ).rejects.toThrow("batch_mismatch");

    db.reservationFind.mockResolvedValueOnce(
      reservation({
        batch: { batchId: "other", userId: "user-1", provider: "S3" },
      })
    );
    await expect(
      runCommitBlossomItemInTransaction(txClient(), item(), "batch-1", PERIOD)
    ).rejects.toThrow("batch_mismatch");

    db.reservationFind.mockResolvedValueOnce(
      reservation({ status: "EXPIRED" })
    );
    await expect(
      runCommitBlossomItemInTransaction(txClient(), item(), "batch-1", PERIOD)
    ).rejects.toThrow("reservation_inactive");

    db.reservationFind.mockResolvedValueOnce(
      reservation({ status: "CANCELED" })
    );
    await expect(
      runCommitBlossomItemInTransaction(txClient(), item(), "batch-1", PERIOD)
    ).rejects.toThrow("reservation_inactive");

    db.reservationFind.mockResolvedValueOnce(reservation({ pubkey: "other" }));
    await expect(
      runCommitBlossomItemInTransaction(txClient(), item(), "batch-1", PERIOD)
    ).rejects.toThrow("pubkey_mismatch");

    db.reservationFind.mockResolvedValueOnce(reservation({ sha256: "nope" }));
    await expect(
      runCommitBlossomItemInTransaction(txClient(), item(), "batch-1", PERIOD)
    ).rejects.toThrow("payload_mismatch");

    db.reservationFind.mockResolvedValueOnce(reservation({ size: 99 }));
    await expect(
      runCommitBlossomItemInTransaction(txClient(), item(), "batch-1", PERIOD)
    ).rejects.toThrow("payload_mismatch");
  });

  it("commits a reservation, records usage, and skips an existing media row", async () => {
    db.reservationFind.mockResolvedValueOnce(
      reservation({ status: "COMMITTED" })
    );
    db.mediaFind.mockResolvedValueOnce({ id: "media-1" });
    await expect(
      runCommitBlossomItemInTransaction(
        db.tx,
        item({ type: "image/png" }),
        "batch-1",
        PERIOD
      )
    ).resolves.toBeUndefined();
    expect(lock.lockAccountForWrite).toHaveBeenCalledWith(db.tx, "user-1");
    expect(db.commitCreate).toHaveBeenCalledWith({
      data: {
        jti: "jti-1",
        batchId: "batch-1",
        pubkey: "pk",
        sha256: "abc",
        size: 12,
        mimeType: "image/png",
        url: "https://cdn.example/a",
      },
    });
    expect(db.reservationUpdate).toHaveBeenCalledWith({
      where: { jti: "jti-1" },
      data: { status: "COMMITTED" },
    });
    expect(db.txUsageUpsert).toHaveBeenCalledWith({
      where: {
        userId_periodStartUtc: { userId: "user-1", periodStartUtc: PERIOD },
      },
      create: {
        userId: "user-1",
        periodStartUtc: PERIOD,
        uploadedBytes: BigInt(12),
        uploadedFiles: 1,
      },
      update: {
        uploadedBytes: { increment: BigInt(12) },
        uploadedFiles: { increment: 1 },
      },
    });
    expect(db.mediaCreate).not.toHaveBeenCalled();

    db.reservationFind.mockResolvedValueOnce(reservation());
    db.mediaFind.mockResolvedValueOnce(null);
    await runCommitBlossomItemInTransaction(
      txClient(),
      item(),
      "batch-1",
      PERIOD
    );
    expect(db.commitCreate.mock.calls.at(-1)?.[0].data.mimeType).toBeNull();
    expect(db.mediaCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        url: "https://cdn.example/a",
        sha256: "abc",
        size: 12,
        mimeType: null,
        provider: "BLOSSOM_SFS",
      },
    });
  });

  it("counts processed, duplicate, and failed batch items", async () => {
    db.commitFind
      .mockResolvedValueOnce({ jti: "dup" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    db.reservationFind
      .mockResolvedValueOnce(reservation({ status: "RESERVED" }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(reservation());
    lock.lockAccountForWrite
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce("lock string");

    const result = await commitBlossomBatch(
      [
        item({ jti: "dup" }),
        item({ jti: "ok" }),
        item({ jti: "missing" }),
        item({ jti: "locked" }),
      ],
      "batch-1",
      PERIOD
    );

    expect(result).toEqual({
      processed: 1,
      duplicate: 1,
      failed: 2,
      statuses: [
        { jti: "dup", status: "duplicate" },
        { jti: "ok", status: "processed" },
        { jti: "missing", status: "failed", reason: "reservation_not_found" },
        { jti: "locked", status: "failed", reason: "lock string" },
      ],
    });
  });

  it("records an Error message when a batch item throws", async () => {
    db.commitFind.mockResolvedValueOnce(null);
    db.reservationFind.mockResolvedValueOnce(reservation());
    db.commitCreate.mockRejectedValueOnce(new Error("commit down"));
    const result = await commitBlossomBatch(
      [item({ jti: "bad" })],
      "batch-1",
      PERIOD
    );
    expect(result.failed).toBe(1);
    expect(result.statuses).toEqual([
      { jti: "bad", status: "failed", reason: "commit down" },
    ]);
  });
});

function isTx(value: object): value is Tx {
  return "blossomCommit" in value;
}

function txClient(): Tx {
  if (!isTx(db.tx)) {
    throw new Error("expected transaction client");
  }
  return db.tx;
}
