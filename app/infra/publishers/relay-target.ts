/**
 * Relay URL checks for the internal publisher.
 *
 * Public `wss://` relays are allowed. Private and loopback targets require
 * `NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS=true`. That flag is never implied by
 * `SELF_HOSTED`.
 */

import { lookup } from "node:dns/promises";

import ipaddr from "ipaddr.js";

export const PUBLISH_FAILURE_CATEGORIES = [
  "invalid_event",
  "invalid_relay_url",
  "private_address",
  "connection_timeout",
  "connection_failed",
  "ack_timeout",
  "rejected",
  "closed",
  "too_large",
  "unknown",
] as const;

export type PublishFailureCategory =
  (typeof PUBLISH_FAILURE_CATEGORIES)[number];

const TRANSIENT_FAILURES = new Set<PublishFailureCategory>([
  "connection_timeout",
  "connection_failed",
  "ack_timeout",
  "closed",
]);

const PRIVATE_RANGES = new Set([
  "private",
  "loopback",
  "uniqueLocal",
  "carrierGradeNat",
]);

const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google.com",
]);

export function isTransientPublishFailure(
  category: PublishFailureCategory
): boolean {
  return TRANSIENT_FAILURES.has(category);
}

export function relayHostname(relay: string): string {
  const trimmed = relay.trim();
  if (!trimmed) return "";
  const withScheme = /^wss?:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`;
  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function canonicalRelayKey(relay: string): string {
  const trimmed = relay.trim();
  if (!trimmed) return "";
  const withScheme = /^wss?:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`;
  try {
    const url = new URL(withScheme);
    const path = url.pathname.replace(/\/+$/, "");
    const port = url.port ? `:${url.port}` : "";
    return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}${port}${path}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, "");
  }
}

export function dedupeRelayUrls(relays: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const relay of relays) {
    if (typeof relay !== "string") continue;
    const trimmed = relay.trim();
    if (!trimmed) continue;
    const key = canonicalRelayKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function isBlockedRelayAddress(
  address: string,
  allowPrivateRelays: boolean
): boolean {
  const bare = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
  if (!bare || !ipaddr.isValid(bare)) return true;
  // process() returns the IPv4 address for IPv4-mapped IPv6 input.
  const range = ipaddr.process(bare).range();
  if (range === "unicast") return false;
  if (allowPrivateRelays && PRIVATE_RANGES.has(range)) return false;
  return true;
}

function bareHost(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
}

function hostnameBlocked(
  hostname: string,
  allowPrivateRelays: boolean
): "invalid_relay_url" | "private_address" | null {
  const host = bareHost(hostname);
  if (!host || METADATA_HOSTS.has(host)) return "private_address";
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    return "private_address";
  }
  if (/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.test(host)) {
    const ambiguous = host
      .split(".")
      .some((part) => part.length > 1 && part.startsWith("0"));
    if (ambiguous) return "invalid_relay_url";
  }
  const localName =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal");
  if (localName) {
    return allowPrivateRelays ? null : "private_address";
  }
  if (ipaddr.isValid(host) && isBlockedRelayAddress(host, allowPrivateRelays)) {
    return "private_address";
  }
  return null;
}

export interface AcceptedRelayTarget {
  raw: string;
  canonical: string;
  connectUrl: string;
}

export function assessRelayUrl(
  raw: string,
  allowPrivateRelays: boolean
):
  | { ok: true; target: AcceptedRelayTarget }
  | {
      ok: false;
      category: "invalid_relay_url" | "private_address";
      message: string;
    } {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) {
    return {
      ok: false,
      category: "invalid_relay_url",
      message: "relay URL is empty or too long",
    };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^wss?:\/\//i.test(trimmed)) {
    return {
      ok: false,
      category: "invalid_relay_url",
      message: "relay URL must use wss://",
    };
  }
  const withScheme = /^wss?:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return {
      ok: false,
      category: "invalid_relay_url",
      message: "relay URL is malformed",
    };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      category: "invalid_relay_url",
      message: "relay URL must not include credentials",
    };
  }
  if (url.hash) {
    return {
      ok: false,
      category: "invalid_relay_url",
      message: "relay URL must not include a fragment",
    };
  }
  if (url.protocol !== "wss:" && url.protocol !== "ws:") {
    return {
      ok: false,
      category: "invalid_relay_url",
      message: "relay URL must use wss://",
    };
  }
  const blocked = hostnameBlocked(url.hostname, allowPrivateRelays);
  if (blocked) {
    return {
      ok: false,
      category: blocked,
      message:
        blocked === "private_address"
          ? "relay URL is not a public address"
          : "relay URL is malformed",
    };
  }
  const host = bareHost(url.hostname);
  const privateHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (ipaddr.isValid(host) && isBlockedRelayAddress(host, false));
  if (url.protocol === "ws:" && (!allowPrivateRelays || !privateHost)) {
    return {
      ok: false,
      category: "invalid_relay_url",
      message: allowPrivateRelays
        ? "ws:// is only allowed for an explicitly permitted private relay"
        : "relay URL must use wss://",
    };
  }
  url.hash = "";
  return {
    ok: true,
    target: {
      raw: trimmed,
      canonical: canonicalRelayKey(trimmed),
      connectUrl: url.toString(),
    },
  };
}

export async function resolveRelayAddresses(
  hostname: string
): Promise<string[]> {
  const bare = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
  if (!bare) return [];
  if (ipaddr.isValid(bare)) return [bare];
  const records = await lookup(bare, { all: true, verbatim: true });
  return records.map((record) => record.address);
}
