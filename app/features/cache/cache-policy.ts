/**
 * Redis policy for Nostr read pages.
 * TTLs match the previous `fetchFromCache` values.
 */

import { buildCacheKey } from "~/lib/redis-cache.server";

export interface CacheTtl {
  ttlSeconds: number | null;
  negativeTtlSeconds?: number;
}

const USER_SCOPED = new Set([
  "get_notifications",
  "contact_list",
  "user_followers",
  "mutual_follows",
  "mutelist",
  "user_profile",
]);

/**
 * Empty pages are a real answer for these calls. A missing profile or thread
 * is not treated as a successful empty page.
 */
const ALLOW_EMPTY = new Set([
  "get_notifications",
  "user_followers",
  "contact_list",
  "mutual_follows",
  "mutelist",
  "event_actions",
]);

export function cacheTtlForRequest(requestType: string): CacheTtl {
  switch (requestType) {
    case "thread_view":
      return { ttlSeconds: 30, negativeTtlSeconds: 5 };
    case "user_profile":
      return { ttlSeconds: 300, negativeTtlSeconds: 30 };
    case "user_infos":
      return { ttlSeconds: 300, negativeTtlSeconds: 30 };
    case "event_actions":
      return { ttlSeconds: 30, negativeTtlSeconds: 5 };
    case "get_notifications":
      return { ttlSeconds: 15, negativeTtlSeconds: 5 };
    case "contact_list":
    case "user_followers":
    case "mutual_follows":
    case "mutelist":
      return { ttlSeconds: 60, negativeTtlSeconds: 10 };
    case "events":
    case "parametrized_replaceable_event":
      return { ttlSeconds: 30, negativeTtlSeconds: 5 };
    default:
      return { ttlSeconds: null };
  }
}

export function allowsEmptyResult(requestType: string): boolean {
  return ALLOW_EMPTY.has(requestType);
}

/** Redis pages written by the in-process reader. */
export function cacheKeyVersion(): string {
  return "v2";
}

export function isEmptyCachePage(value: unknown[]): boolean {
  if (!Array.isArray(value) || value.length === 0) return true;
  const nonEose = value.filter(
    (row) => Array.isArray(row) && row[0] !== "EOSE"
  );
  return nonEose.length === 0;
}

function hasScopePubkey(params: Record<string, unknown>): boolean {
  const pubkey = params["pubkey"];
  return typeof pubkey === "string" && pubkey.trim().length > 0;
}

/**
 * User-scoped calls without a pubkey are not stored. The response would
 * otherwise be shared by every caller that omitted the key.
 */
export function shouldStoreReadCache(
  requestType: string,
  params: Record<string, unknown>
): boolean {
  if (USER_SCOPED.has(requestType) && !hasScopePubkey(params)) return false;
  return cacheTtlForRequest(requestType).ttlSeconds !== null;
}

export function readCacheKey(input: {
  requestType: string;
  params: Record<string, unknown>;
}): string {
  return buildCacheKey({
    namespace: "primal",
    version: cacheKeyVersion(),
    parts: { requestType: input.requestType, params: input.params },
  });
}
