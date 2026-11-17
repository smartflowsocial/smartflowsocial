import { createHash } from "node:crypto";

/**
 * Decides which object-storage keys belong to one account and are not shared.
 * It does not call storage and it does not treat Blossom or third-party URLs
 * as owned.
 */

export interface OwnedObjectCandidate {
  url: string;
  key: string | null;
}

export interface ObjectDeletionPlan {
  deleteKeys: string[];
  skippedShared: string[];
  skippedForeign: number;
}

const SAFE_USER_ID = /^[A-Za-z0-9_-]+$/;

/** Fast retries stay pending. After this many failures the row stays failed and is retried slowly. */
export const OWNED_OBJECT_DELETION_FAILED_AFTER_ATTEMPTS = 8;

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;

const CLASSIFIED_STORAGE_ERRORS = new Set([
  "TimeoutError",
  "NetworkingError",
  "AccessDenied",
  "InvalidAccessKeyId",
  "SignatureDoesNotMatch",
  "SlowDown",
  "ServiceUnavailable",
  "InternalError",
  "StorageNotConfigured",
]);

export type OwnedObjectDeletionStatusName =
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "REJECTED";

/**
 * True only for a key that stays inside `clients/<accountId>/` with no empty,
 * relative, or overly long segments. Foreign prefixes are rejected.
 */
export function isSafeAccountObjectKey(
  accountId: string,
  objectKey: string
): boolean {
  if (!SAFE_USER_ID.test(accountId) || accountId.length > 128) return false;
  if (objectKey.length === 0 || objectKey.length > 1024) return false;
  if (objectKey.includes("\\") || objectKey.includes("\0")) return false;
  const prefix = `clients/${accountId}/`;
  if (!objectKey.startsWith(prefix)) return false;
  const rest = objectKey.slice(prefix.length);
  if (!rest) return false;
  const parts = rest.split("/");
  return !parts.some(
    (part) => part.length === 0 || part === "." || part === ".."
  );
}

export function ownedObjectDeletionIdempotencyKey(
  accountId: string,
  objectKey: string
): string {
  return createHash("sha256")
    .update(`${accountId}\0${objectKey}`)
    .digest("hex");
}

/** Delay before the next storage attempt. Attempt 1 waits 30s; the cap is 6 hours. */
export function ownedObjectDeletionBackoffMs(attempts: number): number {
  const exponent = Math.min(Math.max(attempts, 1), 16);
  return Math.min(BACKOFF_BASE_MS * 2 ** (exponent - 1), BACKOFF_CAP_MS);
}

/**
 * Classifies a storage failure without reading `error.message`, which often
 * contains the object key.
 */
export function classifyOwnedObjectDeletionError(error: unknown): string {
  if (!error || typeof error !== "object") return "storage_error";
  const name =
    "name" in error && typeof error.name === "string" ? error.name : "";
  if (CLASSIFIED_STORAGE_ERRORS.has(name)) return name;
  const metadata =
    "$metadata" in error &&
    error.$metadata &&
    typeof error.$metadata === "object"
      ? (error.$metadata as { httpStatusCode?: unknown })
      : undefined;
  const status = metadata?.httpStatusCode;
  if (status === 403 || status === 401) return "AccessDenied";
  if (typeof status === "number" && status >= 500) return "ServiceUnavailable";
  return "storage_error";
}

export interface OwnedObjectDeletionTransition {
  status: OwnedObjectDeletionStatusName;
  attempts: number;
  nextAttemptAt: Date;
  completedAt: Date | null;
  lastErrorCode: string | null;
}

export function transitionOwnedObjectDeletion(input: {
  attempts: number;
  now: Date;
  outcome: "succeeded" | "retryable_error" | "rejected";
  errorCode?: string;
}): OwnedObjectDeletionTransition {
  if (input.outcome === "rejected") {
    return {
      status: "REJECTED",
      attempts: input.attempts,
      nextAttemptAt: input.now,
      completedAt: input.now,
      lastErrorCode: "invalid_key",
    };
  }
  if (input.outcome === "succeeded") {
    return {
      status: "SUCCEEDED",
      attempts: input.attempts + 1,
      nextAttemptAt: input.now,
      completedAt: input.now,
      lastErrorCode: null,
    };
  }
  const attempts = input.attempts + 1;
  return {
    status:
      attempts >= OWNED_OBJECT_DELETION_FAILED_AFTER_ATTEMPTS
        ? "FAILED"
        : "PENDING",
    attempts,
    nextAttemptAt: new Date(
      input.now.getTime() + ownedObjectDeletionBackoffMs(attempts)
    ),
    completedAt: null,
    lastErrorCode: input.errorCode ?? "storage_error",
  };
}

export function ownedAccountObjectKey(input: {
  url: string;
  userId: string;
  bucket?: string;
  region?: string;
  cdnBase?: string;
}): string | null {
  if (!SAFE_USER_ID.test(input.userId)) return null;
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password || parsed.protocol === "javascript:") {
    return null;
  }
  const key = keyFromUrl(parsed, input);
  if (!key || !isSafeAccountObjectKey(input.userId, key)) return null;
  return key;
}

function keyFromUrl(
  url: URL,
  input: { bucket?: string; region?: string; cdnBase?: string }
): string | null {
  const host = url.hostname.toLowerCase();
  let path = url.pathname.replace(/^\/+/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  const bucket = input.bucket?.trim();
  const region = input.region?.trim();
  const cdnBase = input.cdnBase?.trim();
  if (cdnBase) {
    try {
      const cdn = new URL(cdnBase);
      if (host === cdn.hostname.toLowerCase()) return path;
    } catch {
      return null;
    }
  }
  if (!bucket || !region) return null;
  if (host === `${bucket}.${`s3.${region}.amazonaws.com`}`.toLowerCase())
    return path;
  const pathStyle = `s3.${region}.amazonaws.com`.toLowerCase();
  const prefix = `${bucket}/`;
  if (host === pathStyle && path.startsWith(prefix))
    return path.slice(prefix.length);
  return null;
}

export function planOwnedObjectDeletion(input: {
  userId: string;
  urls: readonly string[];
  sharedUrls: ReadonlySet<string>;
  bucket?: string;
  region?: string;
  cdnBase?: string;
}): ObjectDeletionPlan {
  const deleteKeys: string[] = [];
  const skippedShared: string[] = [];
  let skippedForeign = 0;
  const seen = new Set<string>();

  for (const url of input.urls) {
    const key = ownedAccountObjectKey({
      url,
      userId: input.userId,
      bucket: input.bucket,
      region: input.region,
      cdnBase: input.cdnBase,
    });
    if (!key) {
      skippedForeign += 1;
      continue;
    }
    if (input.sharedUrls.has(url) || url.length < 16) {
      skippedShared.push(key);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    deleteKeys.push(key);
  }

  return { deleteKeys, skippedShared, skippedForeign };
}
