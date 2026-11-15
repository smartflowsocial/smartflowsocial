import { DeleteObjectCommand } from "@aws-sdk/client-s3";

import { createS3Client } from "~/features/upload/s3.server";
import {
  ownedAccountObjectKey,
  planOwnedObjectDeletion,
  type ObjectDeletionPlan,
} from "~/features/user/account-object-cleanup";
import { env } from "~/lib/env.server";
import { logError, logInfo } from "~/lib/error-logger.server";
import { prisma } from "~/lib/prisma.server";

export interface AccountObjectCleanupResult extends ObjectDeletionPlan {
  deleted: number;
  failed: string[];
  reason?: "storage_not_configured";
}

/**
 * Finds this account's objects in the configured bucket. Shared URLs and
 * Blossom or third-party URLs are left in place. Call this before deleting
 * the user, because media rows cascade away with the account.
 */
export async function planUnsharedOwnedObjects(
  userId: string
): Promise<AccountObjectCleanupResult> {
  const bucket = env.STORAGE_BUCKET?.trim();
  const region = env.STORAGE_REGION?.trim();
  if (!bucket || !region) {
    logInfo(
      "Account object cleanup skipped because storage is not configured",
      {
        userId,
      }
    );
    return {
      deleteKeys: [],
      skippedShared: [],
      skippedForeign: 0,
      deleted: 0,
      failed: [],
      reason: "storage_not_configured",
    };
  }

  const [media, variants] = await Promise.all([
    prisma.media.findMany({ where: { userId }, select: { url: true } }),
    prisma.mediaVariant.findMany({
      where: { asset: { userId } },
      select: { url: true },
    }),
  ]);
  const urls = [...media, ...variants].map((row) => row.url);
  const sharedUrls = new Set<string>();
  for (const url of urls) {
    const key = ownedAccountObjectKey({
      url,
      userId,
      bucket,
      region,
      cdnBase: env.STORAGE_CDN_URL,
    });
    if (!key) continue;
    if (await urlIsReferencedByAnotherAccount(userId, url)) sharedUrls.add(url);
  }

  const plan = planOwnedObjectDeletion({
    userId,
    urls,
    sharedUrls,
    bucket,
    region,
    cdnBase: env.STORAGE_CDN_URL,
  });
  return { ...plan, deleted: 0, failed: [] };
}

async function urlIsReferencedByAnotherAccount(
  userId: string,
  url: string
): Promise<boolean> {
  if (url.length < 16) return true;
  try {
    const [media, variant, post, article] = await Promise.all([
      prisma.media.findFirst({
        where: { userId: { not: userId }, url },
        select: { id: true },
      }),
      prisma.mediaVariant.findFirst({
        where: { url, asset: { userId: { not: userId } } },
        select: { id: true },
      }),
      prisma.post.findFirst({
        where: { userId: { not: userId }, content: { contains: url } },
        select: { id: true },
      }),
      prisma.longFormPost.findFirst({
        where: { userId: { not: userId }, content: { contains: url } },
        select: { id: true },
      }),
    ]);
    return Boolean(media ?? variant ?? post ?? article);
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), {
      message: "Could not prove an object is unshared. Leaving it in storage.",
      userId,
    });
    return true;
  }
}

/**
 * Deletes keys chosen by `planUnsharedOwnedObjects`. A storage error is logged
 * and does not restore the database row.
 */
export async function deletePlannedAccountObjects(
  userId: string,
  plan: AccountObjectCleanupResult
): Promise<AccountObjectCleanupResult> {
  if (
    plan.reason === "storage_not_configured" ||
    plan.deleteKeys.length === 0
  ) {
    return plan;
  }
  const bucket = env.STORAGE_BUCKET?.trim();
  const region = env.STORAGE_REGION?.trim();
  if (!bucket || !region) return plan;

  const client = createS3Client();
  const failed: string[] = [];
  let deleted = 0;
  for (const key of plan.deleteKeys) {
    const confirmed =
      key.startsWith(`clients/${userId}/`) && !key.includes("..");
    if (!confirmed) {
      failed.push(key);
      continue;
    }
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      deleted += 1;
    } catch (error) {
      failed.push(key);
      logError(error instanceof Error ? error : new Error(String(error)), {
        message: "Failed to delete an account object",
        userId,
        key,
      });
    }
  }
  if (failed.length > 0) {
    logError(new Error("Account object cleanup left objects behind"), {
      userId,
      failed: failed.length,
      deleted,
    });
  } else {
    logInfo("Account object cleanup finished", { userId, deleted });
  }
  return { ...plan, deleted, failed };
}
