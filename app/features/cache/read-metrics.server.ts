import * as promClient from "prom-client";

import { singleton } from "~/lib/singleton.server";

import type { ReadFailureKind } from "./payload";

export type ReadMetricSource =
  "redis" | "nostrmash-native" | "nostrmash-ws" | "primal";

export type ReadCacheMetricResult = "hit" | "miss" | "negative" | "bypass";

export type ReadUpstreamMetricResult = "success" | "empty" | ReadFailureKind;

const REQUEST_TYPE_LABELS = new Set([
  "network_stats",
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
]);

function getOrCreateMetric<T extends promClient.Metric>(
  name: string,
  factory: () => T
): T {
  return singleton(`prom_metric_${name}`, () => {
    const registry = promClient.register;
    try {
      const existingMetric = registry.getSingleMetric(name);
      if (existingMetric) return existingMetric as T;
    } catch {
      // The registry throws when the name is missing.
    }
    return factory();
  });
}

const cacheCounter = getOrCreateMetric(
  "nostr_read_cache_total",
  () =>
    new promClient.Counter({
      name: "nostr_read_cache_total",
      help: "Nostr read Redis cache results. Hits are upstream fetches avoided.",
      labelNames: ["result", "request_type"] as const,
    })
);

const upstreamCounter = getOrCreateMetric(
  "nostr_read_upstream_total",
  () =>
    new promClient.Counter({
      name: "nostr_read_upstream_total",
      help: "Nostr read upstream attempts by source and result",
      labelNames: ["source", "result", "request_type"] as const,
    })
);

const upstreamLatency = getOrCreateMetric(
  "nostr_read_upstream_latency_ms",
  () =>
    new promClient.Histogram({
      name: "nostr_read_upstream_latency_ms",
      help: "Nostr read upstream latency in milliseconds",
      labelNames: ["source", "request_type"] as const,
      buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 15000],
    })
);

export function metricRequestType(requestType: string): string {
  return REQUEST_TYPE_LABELS.has(requestType) ? requestType : "other";
}

export function recordReadCacheResult(
  result: ReadCacheMetricResult,
  requestType: string
): void {
  cacheCounter.inc({
    result,
    request_type: metricRequestType(requestType),
  });
}

export function recordReadUpstream(input: {
  source: ReadMetricSource;
  result: ReadUpstreamMetricResult;
  requestType: string;
  durationMs: number;
}): void {
  const requestType = metricRequestType(input.requestType);
  upstreamCounter.inc({
    source: input.source,
    result: input.result,
    request_type: requestType,
  });
  if (input.durationMs >= 0) {
    upstreamLatency.observe(
      { source: input.source, request_type: requestType },
      input.durationMs
    );
  }
}
