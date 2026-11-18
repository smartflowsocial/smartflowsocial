/**
 * Selects the Nostr read path at boot.
 *
 * An HTTP(S) `PRIMAL_CACHING_URL` keeps the legacy proxy until an operator
 * sets the internal backend and removes that HTTP URL. A self-hosted
 * install with no HTTP proxy uses the in-process reader. A hosted install
 * with no HTTP proxy keeps direct WebSocket reads, so deploying this build
 * does not move that process onto a new upstream chain.
 */

export type NostrReadBackend = "internal" | "legacy_http" | "legacy_ws";

export type NostrReadBackendDecision =
  { ok: true; backend: NostrReadBackend } | { ok: false; reason: string };

export interface ReadBackendEnv {
  configured: string | undefined;
  primalCachingUrl: string | undefined;
  selfHosted: string | undefined;
  nostrmashWsUrl: string | undefined;
  readTimeoutMs: string | undefined;
}

const DEFAULT_READ_TIMEOUT_MS = 15_000;
const MIN_READ_TIMEOUT_MS = 3_000;
const MAX_READ_TIMEOUT_MS = 30_000;

function isSelfHostedFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "self-hosted" ||
    normalized === "self_hosted"
  );
}

export function isHttpCacheProxyUrl(url: string | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

export function resolveNostrReadBackend(input: {
  configured: string | undefined;
  primalCachingUrl: string | undefined;
  selfHosted: string | undefined;
}): NostrReadBackendDecision {
  const configured = input.configured?.trim() ?? "";
  if (configured !== "") {
    const normalized = configured.toLowerCase();
    if (normalized === "internal" || normalized === "legacy_http") {
      return { ok: true, backend: normalized };
    }
    return {
      ok: false,
      reason:
        'must be "internal" or "legacy_http". Unset keeps an HTTP PRIMAL_CACHING_URL on the legacy proxy, selects the in-process reader when SELF_HOSTED is enabled, and otherwise keeps direct WebSocket reads.',
    };
  }
  if (isHttpCacheProxyUrl(input.primalCachingUrl)) {
    return { ok: true, backend: "legacy_http" };
  }
  if (isSelfHostedFlag(input.selfHosted)) {
    return { ok: true, backend: "internal" };
  }
  return { ok: true, backend: "legacy_ws" };
}

export function validateNostrMashWsUrl(
  value: string | undefined
): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "NOSTRMASH_WS_URL must be a ws:// or wss:// URL";
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    return "NOSTRMASH_WS_URL must use ws:// or wss://";
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return "NOSTRMASH_WS_URL must not include credentials";
  }
  if (parsed.hostname.trim() === "") {
    return "NOSTRMASH_WS_URL must include a host";
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  if (path === "/primal/ws") {
    return "NOSTRMASH_WS_URL must use /primal/ws/v1. The older /primal/ws socket is not compatible.";
  }
  return null;
}

export function validateReadTimeoutMs(
  value: string | undefined
): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) {
    return `NOSTR_READ_TIMEOUT_MS must be an integer from ${MIN_READ_TIMEOUT_MS} to ${MAX_READ_TIMEOUT_MS}`;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < MIN_READ_TIMEOUT_MS || parsed > MAX_READ_TIMEOUT_MS) {
    return `NOSTR_READ_TIMEOUT_MS must be an integer from ${MIN_READ_TIMEOUT_MS} to ${MAX_READ_TIMEOUT_MS}`;
  }
  return null;
}

export function readTimeoutMs(value: string | undefined): number {
  const trimmed = value?.trim() ?? "";
  if (!/^\d+$/.test(trimmed)) return DEFAULT_READ_TIMEOUT_MS;
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < MIN_READ_TIMEOUT_MS || parsed > MAX_READ_TIMEOUT_MS) {
    return DEFAULT_READ_TIMEOUT_MS;
  }
  return parsed;
}

/**
 * One boot error for the read path, or null when the process may start.
 * Endpoint shape checks for WebSocket lists live in `endpoints.ts` and are
 * applied by the caller so this module stays free of URL splitting rules.
 */
export function readBackendSelectionError(
  source: Pick<ReadBackendEnv, "configured" | "primalCachingUrl" | "selfHosted">
): { key: string; reason: string } | null {
  const decision = resolveNostrReadBackend(source);
  if (!decision.ok) {
    return { key: "NOSTR_READ_BACKEND", reason: decision.reason };
  }
  const httpProxy = isHttpCacheProxyUrl(source.primalCachingUrl);
  if (decision.backend === "internal" && httpProxy) {
    return {
      key: "NOSTR_READ_BACKEND",
      reason:
        "internal cannot be combined with an HTTP(S) PRIMAL_CACHING_URL. Unset that URL or set a wss:// cache list. Use legacy_http to keep the HTTP proxy.",
    };
  }
  if (decision.backend === "legacy_http" && !httpProxy) {
    return {
      key: "PRIMAL_CACHING_URL",
      reason:
        "The legacy HTTP backend requires PRIMAL_CACHING_URL to be an http:// or https:// proxy URL.",
    };
  }
  return null;
}
