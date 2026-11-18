import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "user_1";
const NPUB = "npub1examplekey0000000000000000000000000000000000000000000000";
const OWNED = `clients/${USER}/photo.jpg`;
const SECOND = `clients/${USER}/other.jpg`;

interface DeletionRow {
  id: string;
  accountId: string;
  objectKey: string;
  idempotencyKey: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "REJECTED";
  attempts: number;
  lastErrorCode: string | null;
  nextAttemptAt: Date;
  lockedUntil: Date | null;
  lastAttemptAt: Date | null;
  completedAt: Date | null;
}

const state = vi.hoisted(() => {
  const rows: DeletionRow[] = [];
  const users = new Map<string, { id: string; npub: string }>();
  const logs: unknown[][] = [];
  return {
    rows,
    users,
    logs,
    failUserDelete: false,
    nextId: 1,
  };
});

function cloneRow(row: DeletionRow): DeletionRow {
  return {
    ...row,
    nextAttemptAt: new Date(row.nextAttemptAt),
    lockedUntil: row.lockedUntil ? new Date(row.lockedUntil) : null,
    lastAttemptAt: row.lastAttemptAt ? new Date(row.lastAttemptAt) : null,
    completedAt: row.completedAt ? new Date(row.completedAt) : null,
  };
}

function isDue(row: DeletionRow, now: Date, accountId?: string): boolean {
  if (row.status !== "PENDING" && row.status !== "FAILED") return false;
  if (row.nextAttemptAt.getTime() > now.getTime()) return false;
  if (row.lockedUntil && row.lockedUntil.getTime() >= now.getTime())
    return false;
  if (accountId && row.accountId !== accountId) return false;
  return true;
}

vi.mock("~/lib/error-logger.server", () => ({
  logError: (...args: unknown[]) => {
    state.logs.push(args);
  },
  logInfo: vi.fn(),
  logWarning: vi.fn(),
}));

vi.mock("~/features/upload/s3.server", () => ({
  createS3Client: () => ({
    send: vi.fn(),
  }),
}));

vi.mock("~/features/referral/repositories/referral-data.server", () => ({
  removeReferralDataForDeletedAccount: vi.fn(async () => undefined),
  purgeReferralRecords: vi.fn(async () => ({
    payoutAuditRows: 0,
    deletedAccountEarnings: 0,
  })),
}));

vi.mock("~/lib/prisma.server", () => {
  const tx = {
    retainedFinancialRecord: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    referrerPayoutConfig: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    ownedObjectDeletion: {
      createMany: async (args: {
        data: Array<{
          accountId: string;
          objectKey: string;
          idempotencyKey: string;
          status: "PENDING";
          nextAttemptAt: Date;
        }>;
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const item of args.data) {
          if (
            args.skipDuplicates &&
            state.rows.some((row) => row.idempotencyKey === item.idempotencyKey)
          ) {
            continue;
          }
          state.rows.push({
            id: `del_${state.nextId++}`,
            accountId: item.accountId,
            objectKey: item.objectKey,
            idempotencyKey: item.idempotencyKey,
            status: item.status,
            attempts: 0,
            lastErrorCode: null,
            nextAttemptAt: item.nextAttemptAt,
            lockedUntil: null,
            lastAttemptAt: null,
            completedAt: null,
          });
          count += 1;
        }
        return { count };
      },
    },
    $queryRaw: async (query: TemplateStringsArray) => {
      const text = Array.isArray(query) ? query.join(" ") : "";
      if (!text.includes("deletionStartedAt")) return [];
      return state.users.has(USER) ? [{ deletionStartedAt: null }] : [];
    },
    media: {
      findMany: async () => [],
    },
    mediaVariant: {
      findMany: async () => [],
    },
    user: {
      update: async () => ({ id: USER }),
      delete: async () => {
        state.users.delete(USER);
        if (state.failUserDelete) throw new Error("db down");
      },
    },
  };

  return {
    prisma: {
      user: {
        findUnique: async () => state.users.get(USER) ?? null,
      },
      payment: {
        findMany: async () => [],
      },
      $transaction: async (run: (client: typeof tx) => Promise<void>) => {
        const rowSnapshot = state.rows.map(cloneRow);
        const userSnapshot = new Map(state.users);
        try {
          await run(tx);
        } catch (error) {
          state.rows.splice(0, state.rows.length, ...rowSnapshot);
          state.users.clear();
          for (const [id, user] of userSnapshot) state.users.set(id, user);
          throw error;
        }
      },
      ownedObjectDeletion: {
        findMany: async (args: {
          where: { accountId?: string; nextAttemptAt: { lte: Date } };
        }) => {
          const now = args.where.nextAttemptAt.lte;
          return state.rows
            .filter((row) => isDue(row, now, args.where.accountId))
            .sort(
              (left, right) =>
                left.nextAttemptAt.getTime() - right.nextAttemptAt.getTime()
            )
            .map(cloneRow);
        },
        updateMany: async (args: {
          where: { id: string };
          data: { lockedUntil: Date };
        }) => {
          const row = state.rows.find((item) => item.id === args.where.id);
          const now = new Date(args.data.lockedUntil.getTime() - 60_000);
          if (!row || !isDue(row, now)) return { count: 0 };
          row.lockedUntil = args.data.lockedUntil;
          return { count: 1 };
        },
        update: async (args: {
          where: { id: string };
          data: Partial<DeletionRow> & { lockedUntil: Date | null };
        }) => {
          const row = state.rows.find((item) => item.id === args.where.id);
          if (!row) throw new Error("missing deletion row");
          Object.assign(row, args.data);
          return cloneRow(row);
        },
        delete: async (args: { where: { id: string } }) => {
          const index = state.rows.findIndex(
            (item) => item.id === args.where.id
          );
          if (index < 0) throw new Error("missing deletion row");
          const [removed] = state.rows.splice(index, 1);
          return removed;
        },
      },
    },
  };
});

import { deleteAccountData } from "~/features/user/data/account-data.server";
import { processDueOwnedObjectDeletions } from "~/features/user/data/account-object-cleanup.server";

describe("durable owned object deletion", () => {
  beforeEach(() => {
    state.rows.splice(0, state.rows.length);
    state.users.clear();
    state.users.set(USER, { id: USER, npub: NPUB });
    state.logs.splice(0, state.logs.length);
    state.failUserDelete = false;
    state.nextId = 1;
  });

  it("keeps the object key when the account row is deleted and storage later succeeds", async () => {
    const deleted = await deleteAccountData(USER, { ownedObjectKeys: [OWNED] });

    expect(deleted).toBe(true);
    expect(state.users.has(USER)).toBe(false);
    expect(state.rows.map((row) => row.objectKey)).toEqual([OWNED]);

    const calls: string[] = [];
    const sweep = await processDueOwnedObjectDeletions({
      deleter: async (objectKey) => {
        calls.push(objectKey);
      },
    });

    expect(calls).toEqual([OWNED]);
    expect(sweep.succeeded).toBe(1);
    expect(state.rows).toEqual([]);
  });

  it("keeps a queued key through a storage outage, a restart, and a later success", async () => {
    await deleteAccountData(USER, { ownedObjectKeys: [OWNED] });
    const started = new Date();
    let storageDown = true;
    const calls: string[] = [];
    const deleter = async (objectKey: string) => {
      calls.push(objectKey);
      if (storageDown) {
        const error = new Error(`delete failed for ${objectKey}`);
        error.name = "NetworkingError";
        throw error;
      }
    };

    const first = await processDueOwnedObjectDeletions({
      now: started,
      deleter,
    });
    expect(first.retrying).toBe(1);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]?.status).toBe("PENDING");
    expect(state.rows[0]?.attempts).toBe(1);

    const beforeRetry = await processDueOwnedObjectDeletions({
      now: started,
      deleter,
    });
    expect(beforeRetry.succeeded).toBe(0);
    expect(calls).toEqual([OWNED]);

    storageDown = false;
    const retryAt = state.rows[0]?.nextAttemptAt ?? started;
    const second = await processDueOwnedObjectDeletions({
      now: retryAt,
      deleter,
    });
    expect(second.succeeded).toBe(1);
    expect(calls).toEqual([OWNED, OWNED]);
    expect(state.rows).toEqual([]);
    expect(JSON.stringify(state.logs)).not.toContain(OWNED);
    expect(JSON.stringify(state.logs)).not.toContain(USER);
  });

  it("does not delete twice while a claim is in progress", async () => {
    await deleteAccountData(USER, { ownedObjectKeys: [OWNED] });
    let nested: Promise<unknown> = Promise.resolve();
    let calls = 0;
    await processDueOwnedObjectDeletions({
      deleter: async () => {
        calls += 1;
        nested = processDueOwnedObjectDeletions({
          deleter: async () => {
            calls += 1;
          },
        });
        await nested;
      },
    });
    expect(calls).toBe(1);
    expect(state.rows).toEqual([]);
  });

  it("records a partial failure and retries only the object that failed", async () => {
    await deleteAccountData(USER, {
      ownedObjectKeys: [OWNED, SECOND],
    });
    const first = await processDueOwnedObjectDeletions({
      deleter: async (objectKey) => {
        if (objectKey === SECOND) throw new Error("storage down");
      },
    });
    expect(first.succeeded).toBe(1);
    expect(first.retrying).toBe(1);
    expect(state.rows.map((row) => row.objectKey)).toEqual([SECOND]);
  });

  it("ignores duplicate, foreign, and manipulated keys", async () => {
    await deleteAccountData(USER, {
      ownedObjectKeys: [
        OWNED,
        OWNED,
        `clients/user_999/secret.jpg`,
        `clients/${USER}/../secret.jpg`,
        "https://blossom.example/abcdef1234567890",
      ],
    });
    expect(state.rows.map((row) => row.objectKey)).toEqual([OWNED]);

    state.rows.push({
      id: "manipulated",
      accountId: USER,
      objectKey: "clients/user_999/secret.jpg",
      idempotencyKey: "manipulated",
      status: "PENDING",
      attempts: 0,
      lastErrorCode: null,
      nextAttemptAt: new Date(0),
      lockedUntil: null,
      lastAttemptAt: null,
      completedAt: null,
    });
    const calls: string[] = [];
    const sweep = await processDueOwnedObjectDeletions({
      deleter: async (objectKey) => {
        calls.push(objectKey);
      },
    });
    expect(calls).toEqual([OWNED]);
    expect(sweep.rejected).toBe(1);
    expect(state.rows.map((row) => row.status)).toEqual(["REJECTED"]);
    expect(state.rows[0]?.objectKey).toBe("clients/user_999/secret.jpg");
  });

  it("rolls back the queued key when the account transaction fails", async () => {
    state.failUserDelete = true;

    await expect(
      deleteAccountData(USER, { ownedObjectKeys: [OWNED] })
    ).rejects.toThrow("db down");

    expect(state.users.has(USER)).toBe(true);
    expect(state.rows).toEqual([]);
  });

  it("does not queue another copy when deletion is requested again", async () => {
    await deleteAccountData(USER, { ownedObjectKeys: [OWNED, OWNED] });
    state.users.set(USER, { id: USER, npub: NPUB });
    const again = await deleteAccountData(USER, { ownedObjectKeys: [OWNED] });

    expect(again).toBe(true);
    expect(state.rows).toHaveLength(1);
  });

  it("marks the row failed after the fast retry budget and still retries it later", async () => {
    await deleteAccountData(USER, { ownedObjectKeys: [OWNED] });
    const row = state.rows[0];
    if (!row) throw new Error("missing row");
    row.attempts = 7;
    let now = new Date("2026-11-17T12:00:00.000Z");
    row.nextAttemptAt = now;

    const failed = await processDueOwnedObjectDeletions({
      now,
      deleter: async () => {
        throw new Error("still down");
      },
    });
    expect(failed.failed).toBe(1);
    expect(state.rows[0]?.status).toBe("FAILED");
    expect(state.rows[0]?.attempts).toBe(8);

    now = state.rows[0]?.nextAttemptAt ?? now;
    const recovered = await processDueOwnedObjectDeletions({
      now,
      deleter: async () => undefined,
    });
    expect(recovered.succeeded).toBe(1);
    expect(state.rows).toEqual([]);
  });
});
