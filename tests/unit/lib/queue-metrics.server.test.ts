import { beforeEach, describe, expect, it, vi } from "vitest";

interface MetricSink {
  observe: (labels: { queue: string; status: string }, value: number) => void;
  inc: (labels: Record<string, string>, value?: number) => void;
  set: (labels: Record<string, string>, value: number) => void;
}

const sinks = vi.hoisted(() => {
  const made = new Map<string, MetricSink>();
  function sink(): MetricSink {
    return {
      observe: vi.fn(
        (_labels: { queue: string; status: string }, _value: number) =>
          undefined
      ),
      inc: vi.fn(
        (_labels: Record<string, string>, _value?: number) => undefined
      ),
      set: vi.fn(
        (_labels: Record<string, string>, _value: number) => undefined
      ),
    };
  }
  made.set("queue_job_total", sink());
  made.set("queue_job_started_total", sink());
  return { made, sink, startedLookups: { count: 0 } };
});

vi.mock("~/lib/singleton.server", () => ({
  singleton: (_name: string, factory: () => unknown) => {
    try {
      return factory();
    } catch {
      return sinks.sink();
    }
  },
}));

vi.mock("prom-client", () => {
  class Metric {
    constructor(config: { name: string }) {
      if (
        config.name === "queue_job_started_total" ||
        config.name === "queue_job_skipped_total"
      ) {
        throw new Error(`${config.name} has already been registered`);
      }
      if (config.name === "queue_job_failed_total") {
        throw new Error("registry unavailable");
      }
      const created = sinks.sink();
      sinks.made.set(config.name, created);
      return created;
    }
  }
  return {
    register: {
      getSingleMetric(name: string) {
        if (name === "queue_job_duration_ms") {
          throw new Error("not registered");
        }
        if (name === "queue_job_total") {
          return sinks.made.get(name);
        }
        if (name === "queue_job_started_total") {
          sinks.startedLookups.count += 1;
          if (sinks.startedLookups.count === 1) return undefined;
          return sinks.made.get(name);
        }
        return undefined;
      },
    },
    Histogram: Metric,
    Counter: Metric,
    Gauge: Metric,
  };
});

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

function sink(name: string): MetricSink {
  const metric = sinks.made.get(name);
  if (!metric) throw new Error(`missing metric ${name}`);
  return metric;
}

describe("queue metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records success, failure, stuck jobs, and missing error types", () => {
    recordJobMetrics("publish", 120, true);
    recordJobMetrics("publish", 80, false);
    recordJobMetrics("publish", 300001, false, new TypeError("slow"));
    recordJobStarted("publish");
    recordJobSkipped("publish", "locked");
    recordJobRetry("publish");
    recordDeadLetterJob("publish");
    recordDeadLetterJob("publish", "Timeout");
    updateQueueLength("publish", 4);
    setQueueStatusDepth("publish", "waiting", 2);
    setQueueOldestWaitingAgeSeconds("publish", -5);
    setQueueOldestWaitingAgeSeconds("publish", 9);
    updateActiveJobs("publish", 1);

    const duration = sink("queue_job_duration_ms");
    expect(duration.observe).toHaveBeenCalledTimes(3);
    expect(sink("queue_job_total").inc).toHaveBeenCalledTimes(3);
    expect(sink("queue_length").set).toHaveBeenCalledWith(
      { queue: "publish" },
      4
    );
    expect(sink("queue_jobs_by_status").set).toHaveBeenCalledWith(
      { queue: "publish", status: "waiting" },
      2
    );
    expect(sink("queue_oldest_waiting_age_seconds").set).toHaveBeenCalledWith(
      { queue: "publish" },
      0
    );
    expect(sink("queue_oldest_waiting_age_seconds").set).toHaveBeenCalledWith(
      { queue: "publish" },
      9
    );
    expect(sink("queue_active_jobs").inc).toHaveBeenCalledWith(
      { queue: "publish" },
      1
    );
    expect(sink("queue_job_retries_total").inc).toHaveBeenCalledWith({
      queue: "publish",
    });
    expect(sink("queue_dead_letter_total").inc).toHaveBeenCalledWith({
      queue: "publish",
      error_type: "UnknownError",
    });
    expect(sink("queue_dead_letter_total").inc).toHaveBeenCalledWith({
      queue: "publish",
      error_type: "Timeout",
    });
  });
});
