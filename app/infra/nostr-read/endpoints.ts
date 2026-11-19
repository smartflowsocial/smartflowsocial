/**
 * Operator-configured WebSocket endpoints for Primal-compatible caches.
 * These values come from the environment, not from request bodies.
 */

export const DEFAULT_PRIMAL_ENDPOINTS = [
  "wss://cache1.primal.net/v1",
  "wss://cache2.primal.net/v1",
] as const;

export const DEFAULT_NOSTRMASH_WS_URL = "wss://api.nostrmash.com/primal/ws/v1";

const MAX_ENDPOINTS = 8;

export interface ParsedSocketUrl {
  href: string;
  host: string;
}

export function parseSocketUrl(
  value: string
): { ok: true; url: ParsedSocketUrl } | { ok: false; reason: string } {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: false, reason: "empty URL" };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "malformed URL" };
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    return { ok: false, reason: "only ws:// and wss:// are allowed" };
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reason: "credentials are not allowed in the URL" };
  }
  if (parsed.hostname.trim() === "" || parsed.hostname.length > 253) {
    return { ok: false, reason: "missing host" };
  }
  if (parsed.pathname.includes("..")) {
    return { ok: false, reason: "path must not contain .." };
  }
  return { ok: true, url: { href: parsed.toString(), host: parsed.host } };
}

export function parseSocketUrlList(
  raw: string | undefined
): { ok: true; urls: string[] } | { ok: false; reason: string } {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") return { ok: true, urls: [] };
  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return { ok: true, urls: [] };
  if (parts.length > MAX_ENDPOINTS) {
    return {
      ok: false,
      reason: `at most ${MAX_ENDPOINTS} WebSocket endpoints are allowed`,
    };
  }
  const urls: string[] = [];
  for (const part of parts) {
    const parsed = parseSocketUrl(part);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    urls.push(parsed.url.href);
  }
  return { ok: true, urls };
}

/**
 * Primal sockets for a read. Unset uses the public Primal endpoints.
 * `PRIMAL_UPSTREAM_URLS` is a comma-separated `ws://` or `wss://` list.
 */
export function primalSocketEndpoints(raw: string | undefined): string[] {
  const parsed = parseSocketUrlList(raw);
  if (!parsed.ok || parsed.urls.length === 0) {
    return [...DEFAULT_PRIMAL_ENDPOINTS];
  }
  return parsed.urls;
}

export function primalSocketConfigError(
  raw: string | undefined
): string | null {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") return null;
  const parsed = parseSocketUrlList(trimmed);
  if (!parsed.ok) return `PRIMAL_UPSTREAM_URLS ${parsed.reason}`;
  if (parsed.urls.length === 0) return "PRIMAL_UPSTREAM_URLS has no endpoints";
  return null;
}

export function socketHost(endpoint: string): string {
  const parsed = parseSocketUrl(endpoint);
  return parsed.ok ? parsed.url.host : "invalid-url";
}
