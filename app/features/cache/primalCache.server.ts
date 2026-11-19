import { logError } from "~/lib/error-logger.server";
import { getOrSetJson } from "~/lib/redis-cache.server";
import { withSentrySpan } from "~/lib/sentry.server";

import {
  allowsEmptyResult,
  cacheTtlForRequest,
  isEmptyCachePage,
  readCacheKey,
  shouldStoreReadCache,
} from "./cache-policy";
import { isCompleteEmpty } from "./payload";
import { recordReadCacheResult } from "./read-metrics.server";
import { readNostrUpstreamsFromEnv } from "./read-service.server";
import { singleFlight } from "./single-flight";

type CacheParams = Record<string, unknown>;
type CacheResponse = unknown[];

const SENTRY_SPAN_NAME_PRIMAL_FETCH = "primal_cache.fetch";
const SENTRY_SPAN_OP_HTTP_CLIENT = "http.client";

async function fetchUpstream(
  requestType: string,
  params: CacheParams
): Promise<CacheResponse> {
  const result = await readNostrUpstreamsFromEnv(requestType, params);
  return result.messages;
}

/**
 * Reads a Nostr cache page through the in-process reader and Redis.
 *
 * The reader tries application read services, then the configured NostrMash
 * upstream, then Primal-compatible sockets. It does not call an external
 * cache worker.
 */
export async function fetchFromCache(
  requestType: string,
  params: CacheParams
): Promise<CacheResponse> {
  const doFetch = () => fetchUpstream(requestType, params);

  try {
    const key = readCacheKey({ requestType, params });
    const { ttlSeconds, negativeTtlSeconds } = cacheTtlForRequest(requestType);
    if (!shouldStoreReadCache(requestType, params) || !ttlSeconds) {
      recordReadCacheResult("bypass", requestType);
      return await singleFlight(key, doFetch);
    }

    return await singleFlight(key, () =>
      getOrSetJson<CacheResponse>({
        cache: "primal",
        key,
        ttlSeconds,
        negativeTtlSeconds,
        shouldNegativeCache: isEmptyCachePage,
        observe: (result) => recordReadCacheResult(result, requestType),
        compute: () =>
          withSentrySpan(
            {
              name: SENTRY_SPAN_NAME_PRIMAL_FETCH,
              op: SENTRY_SPAN_OP_HTTP_CLIENT,
              attributes: { requestType, cache: "redis" },
            },
            doFetch
          ),
      })
    );
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), {
      requestType,
      message: "[Nostr read] Failed to fetch",
    });
    throw error;
  }
}

/**
 * Same page as `fetchFromCache`, rejecting an empty page unless this request
 * type can legitimately be empty.
 */
export async function connectToPrimalCache(
  requestType: string,
  params: CacheParams
): Promise<CacheResponse> {
  try {
    const responses = await fetchFromCache(requestType, params);
    const nonEose = responses.filter(
      (res): res is unknown[] => Array.isArray(res) && res[0] !== "EOSE"
    );
    if (nonEose.length > 0) return responses;
    if (allowsEmptyResult(requestType) && isCompleteEmpty(responses)) {
      return responses;
    }

    logError(new Error("[Nostr read] Empty response"), {
      requestType,
      message: "[Nostr read] Empty response",
    });
    throw new Error("Primal cache gave empty response.");
  } catch (err) {
    if (
      err instanceof Error &&
      err.message === "Primal cache gave empty response."
    ) {
      throw err;
    }
    logError(err instanceof Error ? err : new Error(String(err)), {
      requestType,
      message: "[Nostr read] Failed",
    });
    throw err;
  }
}
