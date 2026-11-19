/**
 * In-process Nostr read chain.
 *
 * Redis is applied by `fetchFromCache`. This module talks to upstreams:
 * NostrMash HTTP, the NostrMash compatibility socket, then Primal sockets.
 * A valid empty page is returned only for request types that can be empty.
 * Transport failures are not turned into empty pages.
 */

import { tryNativePrimalFrames } from "~/features/nostrmash/native-frames.server";
import {
  DEFAULT_NOSTRMASH_WS_URL,
  primalSocketEndpoints,
  socketHost,
} from "~/infra/nostr-read/endpoints";
import {
  readTimeoutMs,
  validateNostrMashWsUrl,
} from "~/infra/nostr-read/read-backend";
import { env } from "~/lib/env.server";
import { logInfo, logWarning } from "~/lib/error-logger.server";

import { allowsEmptyResult } from "./cache-policy";
import { queryCacheSocket, type SocketAttempt } from "./cache-socket.server";
import {
  isCompleteEmpty,
  isUsableCachePayload,
  type ReadFailureKind,
} from "./payload";
import {
  recordReadUpstream,
  type ReadMetricSource,
} from "./read-metrics.server";
import { canonicalCacheRequest, type CacheParams } from "./wire";

const CONNECT_TIMEOUT_MS = 3_000;
const RESPONSE_TIMEOUT_MS = 5_000;
const MIN_ATTEMPT_MS = 200;

const NATIVE_SOURCE = "nostrmash-native";

const NATIVE_TYPES = new Set([
  "user_profile",
  "user_infos",
  "events",
  "thread_view",
]);

export interface ReadFailure {
  source: ReadMetricSource;
  failure: ReadFailureKind;
}

export class NostrReadError extends Error {
  readonly failures: readonly ReadFailure[];

  constructor(requestType: string, failures: readonly ReadFailure[]) {
    super(`Nostr read failed for ${requestType}`);
    this.name = "NostrReadError";
    this.failures = failures;
  }
}

export interface NostrReadResult {
  messages: unknown[];
  source: ReadMetricSource;
  /** True when the page is a finished EOSE with no events. */
  empty: boolean;
}

export interface ReadUpstreamDeps {
  now: () => number;
  budgetMs: number;
  connectTimeoutMs: number;
  responseTimeoutMs: number;
  queryNative: (
    requestType: string,
    params: CacheParams
  ) => Promise<unknown[] | null>;
  querySocket: (
    endpoint: string,
    requestType: string,
    params: CacheParams,
    timeouts: { connectTimeoutMs: number; responseTimeoutMs: number }
  ) => Promise<SocketAttempt>;
  nostrmashWsUrl: string | null;
  primalEndpoints: string[];
}

function remaining(deps: ReadUpstreamDeps, startedAt: number): number {
  return Math.max(0, deps.budgetMs - (deps.now() - startedAt));
}

function record(
  source: ReadMetricSource,
  result: "success" | "empty" | ReadFailureKind,
  requestType: string,
  started: number,
  now: () => number
): void {
  recordReadUpstream({
    source,
    result,
    requestType,
    durationMs: Math.max(0, now() - started),
  });
}

async function readNative(
  deps: ReadUpstreamDeps,
  requestType: string,
  params: CacheParams,
  startedAt: number
): Promise<
  | { done: true; result: NostrReadResult }
  | { done: false; failure: ReadFailure | null }
> {
  if (!NATIVE_TYPES.has(requestType)) return { done: false, failure: null };
  if (remaining(deps, startedAt) < MIN_ATTEMPT_MS) {
    return {
      done: false,
      failure: { source: NATIVE_SOURCE, failure: "connect_timeout" },
    };
  }
  const started = deps.now();
  try {
    const messages = await deps.queryNative(requestType, params);
    if (messages && isUsableCachePayload(requestType, params, messages)) {
      record(NATIVE_SOURCE, "success", requestType, started, deps.now);
      return {
        done: true,
        result: { messages, source: NATIVE_SOURCE, empty: false },
      };
    }
    const failure: ReadFailureKind = messages ? "invalid_response" : "empty";
    record(NATIVE_SOURCE, failure, requestType, started, deps.now);
    return {
      done: false,
      failure: { source: NATIVE_SOURCE, failure },
    };
  } catch {
    record(NATIVE_SOURCE, "unavailable", requestType, started, deps.now);
    return {
      done: false,
      failure: { source: NATIVE_SOURCE, failure: "unavailable" },
    };
  }
}

type SocketStep =
  | { done: true; result: NostrReadResult }
  | { done: false; failure: ReadFailure; emptyPage?: NostrReadResult };

async function readSocket(
  deps: ReadUpstreamDeps,
  source: ReadMetricSource,
  endpoint: string,
  requestType: string,
  params: CacheParams,
  startedAt: number
): Promise<SocketStep> {
  const left = remaining(deps, startedAt);
  if (left < MIN_ATTEMPT_MS) {
    return {
      done: false,
      failure: { source, failure: "connect_timeout" },
    };
  }
  const started = deps.now();
  const attempt = await deps.querySocket(endpoint, requestType, params, {
    connectTimeoutMs: Math.min(deps.connectTimeoutMs, left),
    responseTimeoutMs: Math.min(deps.responseTimeoutMs, left),
  });
  if (
    attempt.ok &&
    isUsableCachePayload(requestType, params, attempt.messages)
  ) {
    record(source, "success", requestType, started, deps.now);
    return {
      done: true,
      result: { messages: attempt.messages, source, empty: false },
    };
  }
  if (!attempt.ok && attempt.failure === "empty") {
    const messages = attempt.messages ?? [];
    record(source, "empty", requestType, started, deps.now);
    const emptyPage =
      allowsEmptyResult(requestType) && isCompleteEmpty(messages)
        ? { messages, source, empty: true }
        : undefined;
    return {
      done: false,
      failure: { source, failure: "empty" },
      emptyPage,
    };
  }
  const failure: ReadFailureKind = attempt.ok
    ? "invalid_response"
    : attempt.failure;
  record(source, failure, requestType, started, deps.now);
  return { done: false, failure: { source, failure } };
}

export async function readNostrUpstreams(
  requestType: string,
  params: CacheParams | undefined,
  deps: ReadUpstreamDeps
): Promise<NostrReadResult> {
  const canonical = canonicalCacheRequest(requestType, params);
  if (!canonical) {
    recordReadUpstream({
      source: "primal",
      result: "unsupported",
      requestType,
      durationMs: 0,
    });
    throw new NostrReadError(requestType, [
      { source: "primal", failure: "unsupported" },
    ]);
  }
  const startedAt = deps.now();
  const failures: ReadFailure[] = [];
  let emptyPage: NostrReadResult | null = null;
  const remember = (step: SocketStep): NostrReadResult | null => {
    if (step.done) return step.result;
    failures.push(step.failure);
    return step.emptyPage ?? null;
  };

  const native = await readNative(
    deps,
    canonical.requestType,
    canonical.params,
    startedAt
  );
  if (native.done) {
    logSelected(canonical.requestType, native.result);
    return native.result;
  }
  if (native.failure) failures.push(native.failure);

  if (deps.nostrmashWsUrl) {
    const mash = await readSocket(
      deps,
      "nostrmash-ws",
      deps.nostrmashWsUrl,
      canonical.requestType,
      canonical.params,
      startedAt
    );
    const selected = remember(mash);
    if (mash.done && selected) {
      logSelected(canonical.requestType, selected);
      return selected;
    }
    if (!mash.done) {
      if (selected) emptyPage = selected;
      logFallback(canonical.requestType, "nostrmash-ws", mash.failure.failure);
    }
  }

  for (const endpoint of deps.primalEndpoints) {
    const primal = await readSocket(
      deps,
      "primal",
      endpoint,
      canonical.requestType,
      canonical.params,
      startedAt
    );
    const selected = remember(primal);
    if (primal.done && selected) {
      logSelected(canonical.requestType, selected);
      return selected;
    }
    if (!primal.done) {
      if (selected) emptyPage = selected;
      logWarning("Nostr read primal endpoint failed", {
        requestType: canonical.requestType,
        source: "primal",
        failure: primal.failure.failure,
        host: socketHost(endpoint),
      });
    }
  }

  if (emptyPage) {
    logSelected(canonical.requestType, emptyPage);
    return emptyPage;
  }
  throw new NostrReadError(canonical.requestType, failures);
}

function logSelected(requestType: string, result: NostrReadResult): void {
  logInfo("Nostr read upstream selected", {
    requestType,
    source: result.source,
    empty: result.empty,
  });
}

function logFallback(
  requestType: string,
  source: ReadMetricSource,
  failure: ReadFailureKind
): void {
  logWarning("Nostr read upstream failed, trying next", {
    requestType,
    source,
    failure,
  });
}

export function defaultReadDeps(
  overrides: Partial<ReadUpstreamDeps> = {}
): ReadUpstreamDeps {
  const configuredWs = env.NOSTRMASH_WS_URL?.trim();
  const candidate =
    configuredWs && configuredWs.length > 0
      ? configuredWs
      : DEFAULT_NOSTRMASH_WS_URL;
  const wsError = validateNostrMashWsUrl(candidate);
  return {
    now: () => Date.now(),
    budgetMs: readTimeoutMs(env.NOSTR_READ_TIMEOUT_MS),
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
    responseTimeoutMs: RESPONSE_TIMEOUT_MS,
    queryNative: tryNativePrimalFrames,
    querySocket: (endpoint, requestType, params, timeouts) =>
      queryCacheSocket(endpoint, requestType, params, timeouts),
    nostrmashWsUrl: wsError ? null : candidate,
    primalEndpoints: primalSocketEndpoints(env.PRIMAL_UPSTREAM_URLS),
    ...overrides,
  };
}

export async function readNostrUpstreamsFromEnv(
  requestType: string,
  params: CacheParams | undefined
): Promise<NostrReadResult> {
  return readNostrUpstreams(requestType, params, defaultReadDeps());
}
