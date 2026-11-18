import { tryNativePrimalFrames } from "~/features/nostrmash/native-frames.server";
import { isHttpCacheProxyUrl } from "~/infra/nostr-read/read-backend";
import { env } from "~/lib/env.server";
import { logError } from "~/lib/error-logger.server";
import { fetchJsonWithRetry } from "~/lib/fetch.server";
import { connectToPrimalCache as connectToPrimalCacheWs } from "~/lib/nostrwebsocket.server";
import { getOrSetJson } from "~/lib/redis-cache.server";
import { withSentrySpan } from "~/lib/sentry.server";

import {
  allowsEmptyResult,
  cacheTtlForRequest,
  isEmptyCachePage,
  readCacheKey,
  shouldStoreReadCache,
} from "./cache-policy";
import { isCompleteEmpty, isUsableCachePayload } from "./payload";
import { recordReadCacheResult } from "./read-metrics.server";
import { readNostrUpstreamsFromEnv } from "./read-service.server";
import { singleFlight } from "./single-flight";

type CacheParams = Record<string, unknown>;
type CacheResponse = unknown[];

const SENTRY_SPAN_NAME_PRIMAL_FETCH = "primal_cache.fetch";
const SENTRY_SPAN_OP_HTTP_CLIENT = "http.client";

/** Default per-attempt timeout when calling the legacy HTTP proxy. */
const DEFAULT_PRIMAL_HTTP_TIMEOUT_MS = 8000;

/** Default extra retries after the first attempt. */
const DEFAULT_PRIMAL_HTTP_MAX_RETRIES = 0;

function parsePrimalHttpTimeoutMs(): number {
  const raw = env.PRIMAL_HTTP_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_PRIMAL_HTTP_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_PRIMAL_HTTP_TIMEOUT_MS;
  return Math.min(60_000, Math.max(2_000, n));
}

function parsePrimalHttpMaxRetries(): number {
  const raw = env.PRIMAL_HTTP_MAX_RETRIES?.trim();
  if (!raw) return DEFAULT_PRIMAL_HTTP_MAX_RETRIES;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_PRIMAL_HTTP_MAX_RETRIES;
  return Math.min(5, Math.max(0, n));
}

/**
 * Legacy HTTP proxy. `X-Cache-Skip-Native` tells the Cloudflare worker that
 * this process already tried NostrMash HTTP. The internal reader does not
 * send that header because it owns the whole chain.
 */
async function fetchFromPrimalViaHttp(
  primalUrl: string,
  requestType: string,
  params: CacheParams
): Promise<CacheResponse> {
  return withSentrySpan(
    {
      name: SENTRY_SPAN_NAME_PRIMAL_FETCH,
      op: SENTRY_SPAN_OP_HTTP_CLIENT,
      attributes: { requestType, transport: "http" },
    },
    () =>
      fetchJsonWithRetry<CacheResponse>(primalUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Cache-Skip-Native": "1",
        },
        body: JSON.stringify({ requestType, params }),
        timeout: parsePrimalHttpTimeoutMs(),
        maxRetries: parsePrimalHttpMaxRetries(),
        retryOn5xx: true,
      })
  );
}

async function fetchFromPrimalViaWebSocket(
  requestType: string,
  params: CacheParams
): Promise<CacheResponse> {
  return withSentrySpan(
    {
      name: SENTRY_SPAN_NAME_PRIMAL_FETCH,
      op: SENTRY_SPAN_OP_HTTP_CLIENT,
      attributes: { requestType, transport: "websocket" },
    },
    () => connectToPrimalCacheWs(requestType, params)
  );
}

async function fetchLegacyUpstream(
  requestType: string,
  params: CacheParams
): Promise<CacheResponse> {
  try {
    const native = await tryNativePrimalFrames(requestType, params);
    if (
      native &&
      native.length > 0 &&
      isUsableCachePayload(requestType, params, native)
    ) {
      return native;
    }
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), {
      requestType,
      message: "[NostrMash] Native read failed, using Primal fallback",
    });
  }
  const primalUrl = env.PRIMAL_CACHING_URL;
  if (
    env.NOSTR_READ_BACKEND === "legacy_http" &&
    primalUrl &&
    isHttpCacheProxyUrl(primalUrl)
  ) {
    return fetchFromPrimalViaHttp(primalUrl, requestType, params);
  }
  return fetchFromPrimalViaWebSocket(requestType, params);
}

async function fetchUpstream(
  requestType: string,
  params: CacheParams
): Promise<CacheResponse> {
  if (env.NOSTR_READ_BACKEND === "internal") {
    const result = await readNostrUpstreamsFromEnv(requestType, params);
    return result.messages;
  }
  return fetchLegacyUpstream(requestType, params);
}

/**
 * Reads a Nostr cache page.
 *
 * The internal backend uses the in-process chain and Redis.
 * `legacy_http` keeps the HTTP proxy. `legacy_ws` keeps direct sockets.
 * Redis keys for the internal reader are version `v2`, so a rollback to the
 * legacy reader does not serve those entries.
 */
export async function fetchFromCache(
  requestType: string,
  params: CacheParams
): Promise<CacheResponse> {
  const backend = env.NOSTR_READ_BACKEND;
  const doFetch = () => fetchUpstream(requestType, params);

  try {
    const key = readCacheKey({ backend, requestType, params });
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
      message: "[Primal Cache] Failed to fetch",
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

    logError(new Error("[Primal Cache] Empty response"), {
      requestType,
      message: "[Primal Cache] Empty response",
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
      message: "[Primal Cache] Failed",
    });
    throw err;
  }
}
