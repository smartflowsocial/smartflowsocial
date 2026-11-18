/**
 * Primal cache REQ bodies for the request types SmartFlowSocial calls.
 * The other names in the cache worker allowlist are not sent.
 */

export type CacheParams = Record<string, unknown>;

export interface CanonicalCacheRequest {
  /** Name placed on the wire and used for validation. */
  requestType: string;
  params: CacheParams;
  /** Value of the `cache` field inside the REQ. */
  cache: unknown[];
}

const SUPPORTED = new Set([
  "network_stats",
  "net_stats",
  "feed",
  "thread_view",
  "user_infos",
  "events",
  "parametrized_replaceable_event",
  "user_profile",
  "contact_list",
  "user_followers",
  "mutual_follows",
  "get_notifications",
  "mutelist",
  "event_actions",
  "reposts",
  "likes",
  "replies",
  "zaps",
]);

function limit(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function withParams(
  requestType: string,
  params: CacheParams
): CanonicalCacheRequest {
  return {
    requestType,
    params,
    cache: [requestType, params],
  };
}

export function isSupportedReadRequest(requestType: string): boolean {
  return SUPPORTED.has(requestType);
}

export function canonicalCacheRequest(
  requestType: string,
  params: CacheParams | undefined
): CanonicalCacheRequest | null {
  if (!SUPPORTED.has(requestType)) return null;
  const source = params ?? {};
  switch (requestType) {
    case "network_stats":
    case "net_stats":
      return {
        requestType: "network_stats",
        params: {},
        cache: ["network_stats"],
      };
    case "feed":
      return withParams("feed", { pubkey: source["pubkey"] });
    case "thread_view": {
      const body: CacheParams = { event_id: source["event_id"] };
      if (typeof source["limit"] === "number") body["limit"] = source["limit"];
      return withParams("thread_view", body);
    }
    case "user_infos":
      return withParams("user_infos", { pubkeys: source["pubkeys"] });
    case "events":
      return withParams("events", { event_ids: source["event_ids"] });
    case "parametrized_replaceable_event": {
      const body: CacheParams = {
        pubkey: source["pubkey"],
        kind: Number(source["kind"]),
        identifier: source["identifier"],
        extended_response:
          source["extended_response"] !== undefined
            ? source["extended_response"]
            : true,
      };
      if (typeof source["user_pubkey"] === "string") {
        body["user_pubkey"] = source["user_pubkey"];
      }
      return withParams("parametrized_replaceable_event", body);
    }
    case "user_profile":
      return withParams("user_profile", { pubkey: source["pubkey"] });
    case "contact_list":
      return withParams("contact_list", {
        pubkey: source["pubkey"],
        extended_response:
          source["extended_response"] !== undefined
            ? source["extended_response"]
            : false,
      });
    case "user_followers":
      return withParams("user_followers", {
        pubkey: source["pubkey"],
        limit: Math.min(
          Number(source["limit"]) > 0 ? Number(source["limit"]) : 1000,
          1000
        ),
      });
    case "mutual_follows":
      return withParams("mutual_follows", {
        pubkey: source["pubkey"],
        user_pubkey:
          typeof source["user_pubkey"] === "string"
            ? source["user_pubkey"]
            : source["pubkey"],
      });
    case "get_notifications":
      return withParams("get_notifications", {
        pubkey: source["pubkey"],
        limit: source["limit"] ?? 100,
      });
    case "mutelist":
      return withParams("mutelist", {
        pubkey: source["pubkey"],
        extended_response: source["extended_response"] ?? true,
      });
    case "reposts":
      return withParams("event_actions", {
        event_id: source["event_id"],
        kind: 6,
        limit: limit(source["limit"], 100, 1000),
      });
    case "likes":
      return withParams("event_actions", {
        event_id: source["event_id"],
        kind: 7,
        limit: limit(source["limit"], 100, 1000),
      });
    case "replies":
      return withParams("event_actions", {
        event_id: source["event_id"],
        kind: 1,
        limit: limit(source["limit"], 100, 1000),
      });
    case "zaps":
      return withParams("event_actions", {
        event_id: source["event_id"],
        kind: 9735,
        limit: limit(source["limit"], 100, 1000),
      });
    case "event_actions":
      return withParams("event_actions", {
        event_id: source["event_id"],
        kind: source["kind"],
        limit: source["limit"] ?? 100,
      });
    default:
      return null;
  }
}

export function cacheReqFrame(
  subscriptionId: string,
  request: CanonicalCacheRequest
): unknown[] {
  return ["REQ", subscriptionId, { cache: request.cache }];
}
