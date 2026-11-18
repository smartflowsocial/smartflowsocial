/**
 * Counters for the internal publisher. Labels stay low-cardinality:
 * backend, result, and a closed set of failure categories.
 */

import * as promClient from "prom-client";

import { singleton } from "~/lib/singleton.server";

import type { PublishFailureCategory } from "./relay-target";

function getOrCreateMetric<T extends promClient.Metric>(
  name: string,
  factory: () => T
): T {
  return singleton(`prom_metric_${name}`, () => {
    const registry = promClient.register;
    const existing = registry.getSingleMetric(name);
    if (existing) return existing as T;
    try {
      return factory();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("has already been registered")
      ) {
        const again = registry.getSingleMetric(name);
        if (again) return again as T;
      }
      throw error;
    }
  });
}

const publishCounter = getOrCreateMetric(
  "nostr_publisher_relay_total",
  () =>
    new promClient.Counter({
      name: "nostr_publisher_relay_total",
      help: "Internal Nostr publisher relay attempts",
      labelNames: ["backend", "result", "failure_category"],
    })
);

const publishLatency = getOrCreateMetric(
  "nostr_publisher_relay_latency_ms",
  () =>
    new promClient.Histogram({
      name: "nostr_publisher_relay_latency_ms",
      help: "Internal Nostr publisher per-relay latency in milliseconds",
      labelNames: ["backend", "result"],
      buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 15000],
    })
);

const openSockets = getOrCreateMetric(
  "nostr_publisher_open_sockets",
  () =>
    new promClient.Gauge({
      name: "nostr_publisher_open_sockets",
      help: "WebSockets the internal Nostr publisher currently has open",
    })
);

export function recordInternalRelayPublish(input: {
  ok: boolean;
  failureCategory: PublishFailureCategory | "none";
  latencyMs: number;
}): void {
  const result = input.ok ? "ok" : "failed";
  publishCounter.inc({
    backend: "internal",
    result,
    failure_category: input.ok ? "none" : input.failureCategory,
  });
  publishLatency.observe({ backend: "internal", result }, input.latencyMs);
}

export function setInternalPublisherOpenSockets(count: number): void {
  openSockets.set(count);
}
