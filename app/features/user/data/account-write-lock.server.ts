import type { Prisma } from "@prisma/client";

import {
  AccountDeletionInProgressError,
  accountAcceptsContentWrite,
} from "~/features/user/account-object-cleanup";

interface LockClient {
  $queryRaw: Prisma.TransactionClient["$queryRaw"];
}

/**
 * Serializes media writes with account deletion. PostgreSQL's row lock also
 * blocks a foreign-key insert, so a commit cannot land between enumeration
 * and the user delete.
 */
export async function readAccountWriteLock(
  tx: LockClient,
  userId: string
): Promise<{ deletionStartedAt: Date | null } | null> {
  const rows = await tx.$queryRaw<Array<{ deletionStartedAt: Date | null }>>`
    SELECT "deletionStartedAt" FROM "User" WHERE "id" = ${userId} FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function lockAccountForWrite(
  tx: LockClient,
  userId: string
): Promise<void> {
  if (!accountAcceptsContentWrite(await readAccountWriteLock(tx, userId))) {
    throw new AccountDeletionInProgressError();
  }
}
