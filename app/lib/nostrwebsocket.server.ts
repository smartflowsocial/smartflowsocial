/**
 * Direct Primal-compatible WebSocket reads.
 * The internal reader uses the same socket. This function is the legacy
 * direct-socket path: configured `wss://` endpoints, or the public Primal
 * pair when `PRIMAL_CACHING_URL` is unset.
 */

import { queryCacheSocket } from "~/features/cache/cache-socket.server";
import { isUsableCachePayload } from "~/features/cache/payload";
import { canonicalCacheRequest } from "~/features/cache/wire";
import {
  primalSocketEndpoints,
  socketHost,
} from "~/infra/nostr-read/endpoints";
import { env } from "~/lib/env.server";

import { logError } from "./error-logger.server";

type CacheParams = Record<string, unknown>;
type CacheResponse = unknown[];

const CONNECT_TIMEOUT_MS = 3_000;
const RESPONSE_TIMEOUT_MS = 5_000;

/**
 * Tries each Primal socket until one returns a usable page.
 * A closed socket, a NOTICE, malformed JSON, or a missing EOSE is a failure
 * of that socket. An EOSE-only page is not returned as success here.
 */
export async function connectToPrimalCache(
  requestType: string,
  params: CacheParams
): Promise<CacheResponse> {
  const canonical = canonicalCacheRequest(requestType, params);
  if (!canonical) {
    throw new Error("Invalid request type");
  }
  const endpoints = primalSocketEndpoints(env.PRIMAL_CACHING_URL);

  for (const endpoint of endpoints) {
    const attempt = await queryCacheSocket(
      endpoint,
      canonical.requestType,
      canonical.params,
      {
        connectTimeoutMs: CONNECT_TIMEOUT_MS,
        responseTimeoutMs: RESPONSE_TIMEOUT_MS,
      }
    );
    if (
      attempt.ok &&
      isUsableCachePayload(
        canonical.requestType,
        canonical.params,
        attempt.messages
      )
    ) {
      return attempt.messages;
    }
    logError(new Error("Primal cache endpoint failed"), {
      message: "Primal cache endpoint failed",
      host: socketHost(endpoint),
      requestType: canonical.requestType,
      failure: attempt.ok ? "invalid_response" : attempt.failure,
    });
  }

  logError(
    new Error("All Primal cache endpoints failed or gave empty responses"),
    {
      message: "All Primal cache endpoints failed or returned empty responses",
      requestType: canonical.requestType,
    }
  );
  throw new Error("All Primal cache endpoints failed or gave empty responses.");
}
