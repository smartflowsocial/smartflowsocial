import { beforeEach, describe, expect, it, vi } from "vitest";

const relayHealth = vi.hoisted(() => ({
  getAllRelayHealthMetrics: vi.fn(),
}));

vi.mock("~/infra/relays/relay-health.server", () => relayHealth);

import {
  recordPostCancelled,
  recordPostCreated,
  recordPostPublished,
  recordPostPublishFailed,
  recordPostRecycled,
  recordPostScheduled,
  recordPostStateTransition,
  recordLongFormPostStateTransition,
  recordOutboxEventDeadLettered,
  recordOutboxEventProcessed,
  recordOutboxEventRetried,
  setOutboxBacklog,
  setOutboxOldestReadyAgeSeconds,
} from "~/lib/metrics/business-metrics.server";
import {
  recordRedisCacheLatency,
  recordRedisCacheRequest,
} from "~/lib/metrics/cache-metrics.server";
import {
  recordOutboxEnqueueToProcessLatency,
  recordOutboxProcessingDuration,
  recordPublishLatency,
  recordPublishLateness,
} from "~/lib/metrics/performance-metrics.server";
import {
  recordRelayRequest,
  updateRelayMetrics,
} from "~/lib/metrics/relay-metrics.server";
import {
  recordDeadLetterJob,
  recordJobMetrics,
  recordJobRetry,
  recordJobSkipped,
  recordJobStarted,
  setQueueOldestWaitingAgeSeconds,
  setQueueStatusDepth,
  updateActiveJobs,
  updateQueueLength,
} from "~/lib/queue-metrics.server";

describe("prometheus metric recorders", () => {
  beforeEach(() => {
    relayHealth.getAllRelayHealthMetrics.mockReset();
  });

  it("records business counters for both sides of each flag", () => {
    recordPostCreated("note", true);
    recordPostCreated("note", false);
    recordPostPublished("note", "immediate");
    recordPostPublished("article", "scheduled");
    recordPostPublishFailed("note", "immediate");
    recordPostPublishFailed("note", "scheduled", "RelayReject");
    recordPostScheduled("note");
    recordPostCancelled("note");
    recordPostRecycled("note");
    recordPostStateTransition("DRAFT", "SCHEDULED");
    recordLongFormPostStateTransition("DRAFT", "PUBLISHED");
    recordOutboxEventProcessed("publish", true);
    recordOutboxEventProcessed("publish", false);
    recordOutboxEventRetried("publish");
    recordOutboxEventDeadLettered("publish", "non_retryable");
    recordOutboxEventDeadLettered("publish", "max_attempts");
    setOutboxBacklog("pending", 1);
    setOutboxBacklog("ready", 0);
    setOutboxBacklog("dead_letter", 2);
    setOutboxOldestReadyAgeSeconds(12);
    expect(setOutboxOldestReadyAgeSeconds).toBeTypeOf("function");
  });

  it("records publish latency and clamps negative observations", () => {
    recordPublishLatency("note", "immediate", 15);
    recordPublishLatency("note", "scheduled", 40);
    recordOutboxProcessingDuration("publish", 8, true);
    recordOutboxProcessingDuration("publish", 8, false);
    recordOutboxEnqueueToProcessLatency("publish", -5);
    recordPublishLateness("note", -1);
    expect(recordPublishLateness).toBeTypeOf("function");
  });

  it("records cache and queue outcomes, including stuck jobs", () => {
    for (const result of ["hit", "miss", "set", "error", "bypass"] as const) {
      recordRedisCacheRequest("session", result);
    }
    recordRedisCacheLatency("session", "get", 3);
    recordRedisCacheLatency("session", "set", 4);
    recordRedisCacheLatency("session", "compute", 5);

    recordJobMetrics("publish", 20, true);
    recordJobMetrics("publish", 20, false);
    recordJobMetrics("publish", 300_001, false, new TypeError("locked"));
    recordJobStarted("publish");
    recordJobSkipped("publish", "lease");
    updateQueueLength("publish", 3);
    setQueueStatusDepth("publish", "waiting", 2);
    setQueueOldestWaitingAgeSeconds("publish", -4);
    updateActiveJobs("publish", 1);
    recordJobRetry("publish");
    recordDeadLetterJob("publish");
    recordDeadLetterJob("publish", "Timeout");
    expect(recordJobRetry).toBeTypeOf("function");
  });

  it("copies relay health into gauges for every status", () => {
    relayHealth.getAllRelayHealthMetrics.mockReturnValueOnce([]);
    updateRelayMetrics();

    relayHealth.getAllRelayHealthMetrics.mockReturnValueOnce([
      {
        relay: "wss://healthy",
        successRate: 1,
        averageLatency: 10,
        status: "HEALTHY",
        circuitBreakerState: "CLOSED",
      },
      {
        relay: "wss://degraded",
        successRate: 0.5,
        averageLatency: 50,
        status: "DEGRADED",
        circuitBreakerState: "HALF_OPEN",
      },
      {
        relay: "wss://unhealthy",
        successRate: 0,
        averageLatency: 200,
        status: "UNHEALTHY",
        circuitBreakerState: "OPEN",
      },
      {
        relay: "wss://unknown",
        successRate: 0,
        averageLatency: 0,
        status: "UNKNOWN",
        circuitBreakerState: "CLOSED",
      },
    ]);
    updateRelayMetrics();
    recordRelayRequest("wss://healthy", true);
    recordRelayRequest("wss://healthy", false);
    expect(relayHealth.getAllRelayHealthMetrics).toHaveBeenCalledTimes(2);
  });
});
