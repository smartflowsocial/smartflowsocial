import { DeleteObjectCommand } from "@aws-sdk/client-s3";

import { createS3Client } from "~/features/upload/s3.server";
import {
  classifyOwnedObjectDeletionError,
  isSafeAccountObjectKey,
  ownedKeyEmbeddedInPath,
  ownedObjectDeletionIdempotencyKey,
  planAccountObjectCleanup,
  StorageCleanupUnavailableError,
  transitionOwnedObjectDeletion,
  type ObjectDeletionPlan,
  type OwnedObjectDeletionStatusName,
} from "~/features/user/account-object-cleanup";
import { env } from "~/lib/env.server";
import { logError, logInfo } from "~/lib/error-logger.server";
import { prisma, type AppPrismaTransactionClient } from "~/lib/prisma.server";

type CleanupDb = typeof prisma | AppPrismaTransactionClient;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Account cleanup failed");
}

export interface AccountObjectCleanupResult extends ObjectDeletionPlan {
  deleted: number;
  failed: string[];
}

export interface StorageCleanupConfig {
  bucket?: string;
  region?: string;
  cdnBase?: string;
}

function storageConfigFromEnv(): StorageCleanupConfig {
  return {
    bucket: env.STORAGE_BUCKET,
    region: env.STORAGE_REGION,
    cdnBase: env.STORAGE_CDN_URL,
  };
}

/**
 * Reads media URLs and returns owned keys. Shared URLs and Blossom or
 * third-party URLs are left in place. This does not call object storage.
 * Missing bucket settings still keep keys that are embedded in the URL.
 */
export async function loadUnsharedOwnedObjectKeys(
  db: CleanupDb,
  userId: string,
  config: StorageCleanupConfig = storageConfigFromEnv()
): Promise<ObjectDeletionPlan> {
  const [media, variants] = await Promise.all([
    db.media.findMany({ where: { userId }, select: { url: true } }),
    db.mediaVariant.findMany({
      where: { asset: { userId } },
      select: { url: true },
    }),
  ]);
  const urls = [...media, ...variants].map((row) => row.url);
  const sharedUrls = new Set<string>();
  for (const url of urls) {
    const plan = planAccountObjectCleanup({
      userId,
      urls: [url],
      sharedUrls: new Set(),
      bucket: config.bucket,
      region: config.region,
      cdnBase: config.cdnBase,
    });
    if (plan.storageUnavailable) throw new StorageCleanupUnavailableError();
    if (plan.deleteKeys.length === 0) continue;
    if (await urlIsReferencedByAnotherAccount(db, userId, url)) {
      sharedUrls.add(url);
    }
  }

  const plan = planAccountObjectCleanup({
    userId,
    urls,
    sharedUrls,
    bucket: config.bucket,
    region: config.region,
    cdnBase: config.cdnBase,
  });
  if (plan.storageUnavailable) throw new StorageCleanupUnavailableError();
  return plan;
}

/**
 * Finds this account's objects. Call this before deleting the user, because
 * media rows cascade away with the account. The deletion transaction reads
 * again under the user row lock.
 */
export async function planUnsharedOwnedObjects(
  userId: string,
  config?: StorageCleanupConfig
): Promise<AccountObjectCleanupResult> {
  const plan = await loadUnsharedOwnedObjectKeys(prisma, userId, config);
  return { ...plan, deleted: 0, failed: [] };
}

/**
 * Records an upload that lost the race with account deletion. The database
 * transaction has already rolled back, so this write is the remaining
 * obligation. Shared and third-party URLs are not queued.
 */
export async function rememberRejectedOwnedObject(
  userId: string,
  url: string
): Promise<void> {
  try {
    const key = ownedKeyEmbeddedInPath(url, userId);
    if (!key) {
      if (
        planAccountObjectCleanup({
          userId,
          urls: [url],
          sharedUrls: new Set(),
        }).storageUnavailable
      ) {
        logError(new StorageCleanupUnavailableError(), {
          message: "A rejected upload has no durable object key.",
        });
      }
      return;
    }
    if (await urlIsReferencedByAnotherAccount(prisma, userId, url)) return;
    await enqueueOwnedObjectDeletions(prisma, userId, [key]);
    logInfo("Recorded an upload that arrived during account deletion");
  } catch (error) {
    logError(asError(error), {
      message: "Could not record a rejected upload for later deletion.",
    });
  }
}

async function urlIsReferencedByAnotherAccount(
  db: CleanupDb,
  userId: string,
  url: string
): Promise<boolean> {
  if (url.length < 16) return true;
  try {
    const [media, variant, post, article] = await Promise.all([
      db.media.findFirst({
        where: { userId: { not: userId }, url },
        select: { id: true },
      }),
      db.mediaVariant.findFirst({
        where: { url, asset: { userId: { not: userId } } },
        select: { id: true },
      }),
      db.post.findFirst({
        where: { userId: { not: userId }, content: { contains: url } },
        select: { id: true },
      }),
      db.longFormPost.findFirst({
        where: { userId: { not: userId }, content: { contains: url } },
        select: { id: true },
      }),
    ]);
    return Boolean(media ?? variant ?? post ?? article);
  } catch (error) {
    logError(asError(error), {
      message: "Account deletion stopped because a shared-object check failed.",
    });
    throw error;
  }
}

export interface OwnedObjectDeletionWrite {
  ownedObjectDeletion: {
    createMany: (args: {
      data: Array<{
        accountId: string;
        objectKey: string;
        idempotencyKey: string;
        status: "PENDING";
        nextAttemptAt: Date;
      }>;
      skipDuplicates?: boolean;
    }) => Promise<unknown>;
  };
}

/**
 * Writes deletion intents before the account row disappears. Unsafe keys are
 * dropped. Duplicate intents are ignored so a repeated request is safe.
 */
export async function enqueueOwnedObjectDeletions(
  tx: OwnedObjectDeletionWrite,
  accountId: string,
  objectKeys: readonly string[]
): Promise<number> {
  const seen = new Set<string>();
  const data: Array<{
    accountId: string;
    objectKey: string;
    idempotencyKey: string;
    status: "PENDING";
    nextAttemptAt: Date;
  }> = [];
  const now = new Date();
  for (const objectKey of objectKeys) {
    if (!isSafeAccountObjectKey(accountId, objectKey)) continue;
    if (seen.has(objectKey)) continue;
    seen.add(objectKey);
    data.push({
      accountId,
      objectKey,
      idempotencyKey: ownedObjectDeletionIdempotencyKey(accountId, objectKey),
      status: "PENDING",
      nextAttemptAt: now,
    });
  }
  if (data.length === 0) return 0;
  await tx.ownedObjectDeletion.createMany({ data, skipDuplicates: true });
  return data.length;
}

export interface OwnedObjectDeletionSweep {
  succeeded: number;
  retrying: number;
  failed: number;
  rejected: number;
}

interface DueDeletionRow {
  id: string;
  accountId: string;
  objectKey: string;
  attempts: number;
}

const SWEEP_LOCK_MS = 60_000;
const DEFAULT_SWEEP_LIMIT = 25;

function deletionWhere(now: Date, accountId?: string) {
  return {
    status: { in: ["PENDING", "FAILED"] as OwnedObjectDeletionStatusName[] },
    nextAttemptAt: { lte: now },
    OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    ...(accountId ? { accountId } : {}),
  };
}

async function defaultObjectDeleter(objectKey: string): Promise<void> {
  const bucket = env.STORAGE_BUCKET?.trim();
  const region = env.STORAGE_REGION?.trim();
  if (!bucket || !region) {
    const error = new Error("storage_not_configured");
    error.name = "StorageNotConfigured";
    throw error;
  }
  const client = createS3Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    })
  );
}

/**
 * Claims due deletion rows and deletes those objects. A storage error leaves
 * the row in place with a future `nextAttemptAt`. Callers can run this again
 * after a restart. Object keys and account ids are not written to logs.
 */
export async function processDueOwnedObjectDeletions(options?: {
  now?: Date;
  limit?: number;
  accountId?: string;
  deleter?: (objectKey: string) => Promise<void>;
}): Promise<OwnedObjectDeletionSweep> {
  const now = options?.now ?? new Date();
  const deleter = options?.deleter ?? defaultObjectDeleter;
  const due = await prisma.ownedObjectDeletion.findMany({
    where: deletionWhere(now, options?.accountId),
    orderBy: { nextAttemptAt: "asc" },
    take: options?.limit ?? DEFAULT_SWEEP_LIMIT,
    select: {
      id: true,
      accountId: true,
      objectKey: true,
      attempts: true,
    },
  });

  const result: OwnedObjectDeletionSweep = {
    succeeded: 0,
    retrying: 0,
    failed: 0,
    rejected: 0,
  };

  for (const row of due) {
    const claimed = await prisma.ownedObjectDeletion.updateMany({
      where: {
        id: row.id,
        status: { in: ["PENDING", "FAILED"] },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data: { lockedUntil: new Date(now.getTime() + SWEEP_LOCK_MS) },
    });
    if (claimed.count !== 1) continue;
    await applyOwnedObjectDeletion(row, now, deleter, result);
  }

  if (
    result.succeeded + result.retrying + result.failed + result.rejected >
    0
  ) {
    logInfo("Owned object deletion sweep finished", { ...result });
  }
  return result;
}

async function applyOwnedObjectDeletion(
  row: DueDeletionRow,
  now: Date,
  deleter: (objectKey: string) => Promise<void>,
  result: OwnedObjectDeletionSweep
): Promise<void> {
  if (!isSafeAccountObjectKey(row.accountId, row.objectKey)) {
    const transition = transitionOwnedObjectDeletion({
      attempts: row.attempts,
      now,
      outcome: "rejected",
    });
    await prisma.ownedObjectDeletion.update({
      where: { id: row.id },
      data: { ...transition, lockedUntil: null },
    });
    result.rejected += 1;
    logError(new Error("Refused an owned-object deletion"), {
      message: "invalid_key",
    });
    return;
  }

  try {
    await deleter(row.objectKey);
    await prisma.ownedObjectDeletion.delete({ where: { id: row.id } });
    result.succeeded += 1;
  } catch (error) {
    const errorCode = classifyOwnedObjectDeletionError(error);
    const transition = transitionOwnedObjectDeletion({
      attempts: row.attempts,
      now,
      outcome: "retryable_error",
      errorCode,
    });
    await prisma.ownedObjectDeletion.update({
      where: { id: row.id },
      data: { ...transition, lockedUntil: null, lastAttemptAt: now },
    });
    if (transition.status === "FAILED") result.failed += 1;
    else result.retrying += 1;
    logError(new Error("Owned object deletion attempt failed"), {
      message: errorCode,
      attempts: transition.attempts,
      status: transition.status,
    });
  }
}
