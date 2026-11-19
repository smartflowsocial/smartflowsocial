import { beforeEach, describe, expect, it, vi } from "vitest";

interface StoredRelay {
  relay: string;
  status: string;
  successCount: number;
  failureCount: number;
  totalRequests: number;
  successRate: number;
  averageLatency: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastCheckedAt: string | null;
  consecutiveFailures: number;
  halfOpenSuccesses: number;
  circuitBreakerState: string;
  circuitBreakerOpenedAt: string | null;
  score?: number;
}

const envState = vi.hoisted(() => {
  const state: { value: string | undefined } = { value: undefined };
  return state;
});
const logInfo = vi.hoisted(() =>
  vi.fn<(message: string, context?: Record<string, unknown>) => void>()
);
const logWarning = vi.hoisted(() =>
  vi.fn<(message: string, context?: Record<string, unknown>) => void>()
);
const redis = vi.hoisted(() => ({
  get: vi.fn<(key: string) => Promise<string | null>>(async () => null),
  sadd: vi.fn<(key: string, member: string) => Promise<number>>(async () => 1),
  set: vi.fn<
    (key: string, value: string, mode: string, ttl: number) => Promise<string>
  >(async () => "OK"),
}));

vi.mock("~/infra/queue", () => ({ redis }));
vi.mock("~/infra/queue/queue-client.server", () => ({ redis }));
vi.mock(
  "/Users/ivmitko/Documents/Dev/smartflowsocial/app/infra/queue/index.ts",
  () => ({ redis })
);
vi.mock("~/lib/env.server", () => ({
  env: {
    get RELAY_HEALTH_STORE() {
      return envState.value;
    },
  },
}));
vi.mock("~/lib/error-logger.server", () => ({
  logInfo,
  logWarning,
}));

async function loadHealth() {
  vi.resetModules();
  return import("~/infra/relays/relay-health.server");
}

async function flush(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function stored(overrides?: Partial<StoredRelay>): StoredRelay {
  return {
    relay: "wss://redis.example",
    status: "DEGRADED",
    successCount: 3,
    failureCount: 1,
    totalRequests: 4,
    successRate: 0.75,
    averageLatency: 100,
    lastSuccessAt: "2024-01-01T00:00:00.000Z",
    lastFailureAt: null,
    lastCheckedAt: "2024-01-02T00:00:00.000Z",
    consecutiveFailures: 0,
    halfOpenSuccesses: 0,
    circuitBreakerState: "CLOSED",
    circuitBreakerOpenedAt: null,
    score: 10,
    ...overrides,
  };
}

describe("relay health in memory", () => {
  beforeEach(() => {
    envState.value = "memory";
    logInfo.mockReset();
    logWarning.mockReset();
    redis.get.mockReset();
    redis.get.mockResolvedValue(null);
    redis.set.mockClear();
    redis.sadd.mockClear();
  });

  it("scores a fresh relay, then healthy, degraded, and unhealthy outcomes", async () => {
    const health = await loadHealth();
    health.resetRelayHealth("wss://fresh.example");
    expect(health.getRelayHealth("wss://fresh.example")).toMatchObject({
      status: "UNKNOWN",
      score: 70,
      circuitBreakerState: "CLOSED",
    });
    expect(health.getRelayHealth("wss://missing.example")).toBeNull();

    health.recordRelaySuccess("wss://healthy.example", 100);
    expect(health.getRelayHealth("wss://healthy.example")).toMatchObject({
      status: "HEALTHY",
      successRate: 1,
      averageLatency: 100,
      score: 80,
    });
    health.recordRelaySuccess("wss://healthy.example", 200);
    expect(health.getRelayHealth("wss://healthy.example")?.averageLatency).toBe(
      130
    );

    health.recordRelaySuccess("wss://mid.example", 3000);
    expect(health.getRelayHealth("wss://mid.example")?.status).toBe("DEGRADED");
    health.recordRelaySuccess("wss://slow.example", 6000);
    expect(health.getRelayHealth("wss://slow.example")).toMatchObject({
      status: "DEGRADED",
      score: 50,
    });

    health.recordRelayFailure("wss://low.example");
    health.recordRelayFailure("wss://low.example");
    expect(health.getRelayHealth("wss://low.example")?.status).toBe("DEGRADED");
    health.recordRelayFailure("wss://low.example");
    expect(health.getRelayHealth("wss://low.example")).toMatchObject({
      status: "UNHEALTHY",
      circuitBreakerState: "CLOSED",
      score: 0,
    });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("opens, pauses, half-opens, and reopens the circuit breaker", async () => {
    const health = await loadHealth();
    const relay = "wss://breaker.example";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      health.recordRelayFailure(relay);
    }
    health.recordRelayFailure(relay, "timeout");
    health.recordRelayFailure(relay, "still-open");

    const opened = health.getRelayHealth(relay);
    expect(opened?.circuitBreakerState).toBe("OPEN");
    expect(opened?.score).toBe(0);
    expect(health.canUseRelay(relay)).toBe(false);
    expect(
      logWarning.mock.calls.filter(
        (call) => call[0] === "Relay circuit breaker opened"
      )
    ).toEqual([
      [
        "Relay circuit breaker opened",
        { relay, consecutiveFailures: 5, error: "timeout" },
      ],
    ]);

    if (!opened) throw new Error("expected opened metrics");
    opened.circuitBreakerOpenedAt = null;
    expect(health.canUseRelay(relay)).toBe(false);
    expect(health.getRelayHealth(relay)?.circuitBreakerState).toBe("OPEN");

    opened.circuitBreakerOpenedAt = new Date();
    expect(
      health.canUseRelay(relay, {
        failureThreshold: 5,
        successThreshold: 2,
        timeoutMs: 60_000,
      })
    ).toBe(false);

    opened.circuitBreakerOpenedAt = new Date(Date.now() - 120_000);
    expect(health.canUseRelay(relay)).toBe(true);
    expect(health.getRelayHealth(relay)?.circuitBreakerState).toBe("HALF_OPEN");
    expect(logInfo).toHaveBeenCalledWith("Relay circuit breaker half-open", {
      relay,
    });

    health.recordRelaySuccess(relay, 100);
    expect(health.getRelayHealth(relay)).toMatchObject({
      circuitBreakerState: "HALF_OPEN",
      halfOpenSuccesses: 1,
    });
    health.recordRelayFailure(relay, "boom");
    expect(health.getRelayHealth(relay)?.circuitBreakerState).toBe("OPEN");
    expect(logWarning).toHaveBeenCalledWith("Relay circuit breaker reopened", {
      relay,
      error: "boom",
    });

    opened.circuitBreakerOpenedAt = new Date();
    expect(
      health.canUseRelay(relay, {
        failureThreshold: 1,
        successThreshold: 1,
        timeoutMs: 0,
      })
    ).toBe(true);
    expect(health.getRelayHealth(relay)?.circuitBreakerState).toBe("HALF_OPEN");
    health.recordRelaySuccess(relay, 100);
    health.recordRelaySuccess(relay, 100);
    expect(health.getRelayHealth(relay)).toMatchObject({
      circuitBreakerState: "CLOSED",
      halfOpenSuccesses: 0,
      circuitBreakerOpenedAt: null,
    });
    expect(logInfo).toHaveBeenCalledWith("Relay circuit breaker closed", {
      relay,
    });
  });

  it("prioritizes usable relays and omits unknown ones from a lookup", async () => {
    const health = await loadHealth();
    const alpha = "wss://a.example";
    const beta = "wss://b.example";
    const closed = "wss://closed.example";
    health.recordRelaySuccess(beta, 50);
    health.recordRelayFailure(alpha);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      health.recordRelayFailure(closed);
    }

    expect(
      health.prioritizeRelaysByHealth([
        ` ${beta} `,
        "",
        beta,
        alpha,
        "   ",
        closed,
      ])
    ).toEqual([beta, alpha]);
    expect(
      health.prioritizeRelaysByHealth(["wss://b.example", "wss://a.example"])[0]
    ).toBe(beta);

    health.resetRelayHealth("wss://tie-b.example");
    health.resetRelayHealth("wss://tie-a.example");
    expect(
      health.prioritizeRelaysByHealth([
        "wss://tie-b.example",
        "wss://tie-a.example",
      ])
    ).toEqual(["wss://tie-a.example", "wss://tie-b.example"]);
    expect(health.prioritizeRelaysByHealth(["", "  "])).toEqual([]);

    const found = health.getRelaysHealth([alpha, "wss://absent.example", beta]);
    expect([...found.keys()]).toEqual([alpha, beta]);
    expect(health.getAllRelayHealthMetrics().map((row) => row.relay)).toEqual([
      beta,
      alpha,
      closed,
      "wss://tie-b.example",
      "wss://tie-a.example",
    ]);
  });
});

describe("relay health in redis", () => {
  beforeEach(() => {
    envState.value = "redis";
    logInfo.mockReset();
    logWarning.mockReset();
    redis.get.mockReset();
    redis.set.mockReset();
    redis.sadd.mockReset();
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue("OK");
    redis.sadd.mockResolvedValue(1);
  });

  it("persists successes and hydrates stored metrics", async () => {
    redis.get.mockResolvedValue(JSON.stringify(stored()));
    const health = await loadHealth();
    expect(health.canUseRelay("wss://redis.example")).toBe(true);
    await flush();

    const hydrated = health.getRelayHealth("wss://redis.example");
    expect(hydrated?.successCount).toBe(3);
    expect(hydrated?.lastSuccessAt?.toISOString()).toBe(
      "2024-01-01T00:00:00.000Z"
    );
    expect(hydrated?.lastFailureAt).toBeNull();
    expect(hydrated?.score).toBe(52);
    expect(redis.get).toHaveBeenCalledWith("relayHealth:wss://redis.example");

    redis.get.mockResolvedValue(null);
    health.recordRelaySuccess("wss://write.example", 100);
    await flush();
    const payload = redis.set.mock.calls[0]?.[1];
    expect(redis.set.mock.calls[0]?.[0]).toBe(
      "relayHealth:wss://write.example"
    );
    expect(redis.set.mock.calls[0]?.[2]).toBe("EX");
    expect(redis.set.mock.calls[0]?.[3]).toBe(3600);
    expect(payload).toContain('"relay":"wss://write.example"');
    expect(redis.sadd).toHaveBeenCalledWith(
      "relayHealth:keys",
      "relayHealth:wss://write.example"
    );
  });

  it("ignores an empty redis payload, invalid JSON, and a missing score", async () => {
    const health = await loadHealth();
    redis.get.mockResolvedValueOnce(null);
    health.recordRelayFailure("wss://empty.example", "x");
    await flush();
    expect(health.getRelayHealth("wss://empty.example")?.failureCount).toBe(1);

    redis.get.mockResolvedValueOnce("{");
    health.canUseRelay("wss://bad-json.example");
    await flush();
    expect(health.getRelayHealth("wss://bad-json.example")).toMatchObject({
      status: "UNKNOWN",
      successCount: 0,
    });

    const { score: _score, ...withoutScore } = stored({
      relay: "wss://no-score.example",
      lastSuccessAt: null,
      lastCheckedAt: null,
      circuitBreakerOpenedAt: null,
    });
    redis.get.mockResolvedValueOnce(JSON.stringify(withoutScore));
    health.canUseRelay("wss://no-score.example");
    await flush();
    expect(health.getRelayHealth("wss://no-score.example")?.successCount).toBe(
      3
    );
    expect(
      health.getRelayHealth("wss://no-score.example")?.lastSuccessAt
    ).toBeNull();
  });
});
