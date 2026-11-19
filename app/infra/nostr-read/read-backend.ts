/**
 * Validation for the in-process Nostr reader.
 *
 * There is one read implementation. It uses Redis, NostrMash, and the
 * configured Primal-compatible sockets. An external cache worker is not a
 * backend and is not selected here.
 */

const DEFAULT_READ_TIMEOUT_MS = 15_000;
const MIN_READ_TIMEOUT_MS = 3_000;
const MAX_READ_TIMEOUT_MS = 30_000;

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
