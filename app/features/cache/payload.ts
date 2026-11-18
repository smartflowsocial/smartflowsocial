/**
 * Primal EVENT / EOSE page checks.
 *
 * A page that contains events is not automatically a successful answer.
 * `event_actions` must include the requested kind. Thread and event lookups
 * must include the requested id. Statistics records built by this app set
 * `synthetic: true` and are not signed Nostr events.
 */

const HEX_64 = /^[0-9a-f]{64}$/i;

export type ReadFailureKind =
  | "unavailable"
  | "connect_timeout"
  | "response_timeout"
  | "invalid_response"
  | "unsupported"
  | "rate_limited"
  | "partial"
  | "empty";

export function hex64(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return HEX_64.test(trimmed) ? trimmed : null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function wireCommand(message: unknown): string | undefined {
  if (!Array.isArray(message) || message.length < 1) return undefined;
  return typeof message[0] === "string" ? message[0] : undefined;
}

export function eventRecord(message: unknown): Record<string, unknown> | null {
  if (!Array.isArray(message) || message[0] !== "EVENT") return null;
  return asRecord(message[2]);
}

export function isSyntheticCacheEvent(event: unknown): boolean {
  const record = asRecord(event);
  return record?.["synthetic"] === true;
}

function eventKind(event: Record<string, unknown>): number | undefined {
  return typeof event["kind"] === "number" ? event["kind"] : undefined;
}

function sameHex(left: unknown, right: string): boolean {
  const hex = hex64(left);
  return hex !== null && hex.toLowerCase() === right.toLowerCase();
}

function contentPubkey(event: Record<string, unknown>): string | null {
  if (typeof event["content"] !== "string") return null;
  try {
    const parsed = JSON.parse(event["content"]) as unknown;
    const record = asRecord(parsed);
    return record ? hex64(record["pubkey"]) : null;
  } catch {
    return null;
  }
}

function profileMatches(
  event: Record<string, unknown>,
  pubkey: string
): boolean {
  if (sameHex(event["pubkey"], pubkey)) return true;
  const nested = contentPubkey(event);
  return nested !== null && nested.toLowerCase() === pubkey.toLowerCase();
}

function eventsOf(messages: unknown[]): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    const event = eventRecord(message);
    if (event) events.push(event);
  }
  return events;
}

function hasKind(
  events: Array<Record<string, unknown>>,
  kind: number
): boolean {
  return events.some((event) => eventKind(event) === kind);
}

/**
 * True when the page contains data this request can use.
 * An EOSE-only page is not usable. Callers decide whether that empty page is
 * a valid empty result.
 */
export function isUsableCachePayload(
  requestType: string,
  params: Record<string, unknown> | undefined,
  messages: unknown[]
): boolean {
  const events = eventsOf(messages);
  if (events.length === 0) return false;
  const p = params ?? {};
  switch (requestType) {
    case "event_actions": {
      const kind = p["kind"];
      if (typeof kind !== "number") return true;
      return events.some((event) => eventKind(event) === kind);
    }
    case "thread_view": {
      const eventId = hex64(p["event_id"]);
      if (!eventId) return true;
      return events.some((event) => sameHex(event["id"], eventId));
    }
    case "events": {
      const ids = Array.isArray(p["event_ids"]) ? p["event_ids"] : [];
      const wanted = ids
        .map((id) => hex64(id))
        .filter((id): id is string => id !== null)
        .map((id) => id.toLowerCase());
      if (wanted.length === 0) return true;
      return events.some((event) => {
        const id = hex64(event["id"]);
        return id !== null && wanted.includes(id.toLowerCase());
      });
    }
    case "user_profile": {
      const pubkey = hex64(p["pubkey"]);
      const profiles = events.filter((event) => {
        const kind = eventKind(event);
        return kind === 0 || kind === 10000105;
      });
      if (profiles.length === 0) return false;
      if (!pubkey) return true;
      return profiles.some((event) => profileMatches(event, pubkey));
    }
    case "user_infos": {
      const profiles = events.filter((event) => eventKind(event) === 0);
      if (profiles.length === 0) return false;
      const ids = Array.isArray(p["pubkeys"]) ? p["pubkeys"] : [];
      const wanted = ids
        .map((id) => hex64(id))
        .filter((id): id is string => id !== null);
      if (wanted.length === 0) return true;
      return profiles.some((event) =>
        wanted.some((pubkey) => profileMatches(event, pubkey))
      );
    }
    case "contact_list":
      return hasKind(events, 3);
    case "mutelist":
      return hasKind(events, 10000);
    case "user_followers":
    case "mutual_follows":
      return hasKind(events, 0);
    case "parametrized_replaceable_event": {
      const kind = p["kind"];
      if (typeof kind !== "number" || !Number.isFinite(kind)) return true;
      return hasKind(events, kind);
    }
    default:
      return true;
  }
}

/** A finished page with EOSE and no EVENT rows. */
export function isCompleteEmpty(messages: unknown[]): boolean {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  let sawEose = false;
  for (const message of messages) {
    if (wireCommand(message) !== "EOSE") return false;
    sawEose = true;
  }
  return sawEose;
}

export function isNoticeError(message: unknown): boolean {
  if (!Array.isArray(message) || message.length < 2) return false;
  if (message[0] !== "NOTICE") return false;
  const text = noticeText(message);
  if (message[2] === "error") return true;
  return text.length > 0;
}

export function noticeText(message: unknown): string {
  if (!Array.isArray(message)) return "";
  return message
    .slice(1)
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
}

export function isRateLimitedNotice(message: unknown): boolean {
  return isNoticeError(message) && noticeText(message).includes("rate");
}
