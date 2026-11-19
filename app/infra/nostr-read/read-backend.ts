/**
 * Selects the Nostr read path at boot.
 *
 * Unset selects the in-process reader. `NOSTR_READ_BACKEND=legacy_http` is
 * the explicit legacy cache proxy. An HTTP(S) `PRIMAL_CACHING_URL` without
 * that setting refuses to boot, so an existing proxy is not silently dropped
 * and is not kept on merely because the URL is present.
 */

export type NostrReadBackend = "internal" | "legacy_http" | "legacy_ws";

export type NostrReadBackendDecision =
  { ok: true; backend: NostrReadBackend } | { ok: false; reason: string };

export interface ReadBackendEnv {
  configured: string | undefined;
  primalCachingUrl: string | undefined;
  nostrmashWsUrl: string | undefined;
  readTimeoutMs: string | undefined;
}

const DEFAULT_READ_TIMEOUT_MS = 15_000;
const MIN_READ_TIMEOUT_MS = 3_000;
const MAX_READ_TIMEOUT_MS = 30_000;

export function isHttpCacheProxyUrl(url: string | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

export function resolveNostrReadBackend(input: {
  configured: string | undefined;
  primalCachingUrl: string | undefined;
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
        'must be "internal" or "legacy_http". Unset selects the in-process reader. Set "legacy_http" to keep an HTTP cache proxy.',
    };
  }
  if (isHttpCacheProxyUrl(input.primalCachingUrl)) {
    return {
      ok: false,
      reason:
        "PRIMAL_CACHING_URL is an HTTP(S) proxy but NOSTR_READ_BACKEND is unset. Set NOSTR_READ_BACKEND=legacy_http to keep that proxy, or unset the HTTP URL to use the internal reader.",
    };
  }
  return { ok: true, backend: "internal" };
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
  source: Pick<ReadBackendEnv, "configured" | "primalCachingUrl">
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
