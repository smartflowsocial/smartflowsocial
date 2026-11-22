import { createHmac, createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

const getJobCounts = vi.hoisted(() => vi.fn());
const getJobs = vi.hoisted(() => vi.fn());
const isPaused = vi.hoisted(() => vi.fn());

vi.mock("~/infra/queue", () => ({
  getQueueInstance: () => ({ getJobCounts, getJobs, isPaused }),
}));

import {
  OVERDUE_WAITING_MS,
  STALLED_ACTIVE_MS,
  assessWorkerHealth,
  createSignedHeartbeat,
  noteWatchdogJobCompleted,
  runWatchdogHeartbeatTick,
  startWatchdogHeartbeat,
  testingSetWatchdogProgress,
  workerProgressToken,
  type QueueObservation,
} from "~/infra/watchdog-heartbeat.server";

const NOW = 1_700_000_000_000;

function queue(overrides: Partial<QueueObservation> = {}): QueueObservation {
  return {
    paused: false,
    waitingCount: 0,
    activeCount: 0,
    delayedCount: 0,
    oldestWaitingAt: null,
    oldestActiveProcessedOn: null,
    soonestDelayedPromoteAt: null,
    ...overrides,
  };
}

describe("worker health sample", () => {
  it("treats empty queues as healthy and idle", () => {
    expect(assessWorkerHealth([queue()], NOW, "10:0")).toMatchObject({
      progress: "10:0",
      idle: true,
      loopAt: NOW,
      actionable: false,
    });
  });

  it("does not treat a future scheduled post as stalled work", () => {
    const sample = assessWorkerHealth(
      [
        queue({
          delayedCount: 4,
          soonestDelayedPromoteAt: NOW + 86_400_000,
        }),
      ],
      NOW,
      "10:0"
    );
    expect(sample.idle).toBe(true);
    expect(sample.futureScheduled).toBe(4);
    expect(sample.overdueDelayed).toBe(0);
  });

  it("recognizes a job that is actively processing", () => {
    const sample = assessWorkerHealth(
      [
        queue({
          activeCount: 1,
          oldestActiveProcessedOn: NOW - 1_000,
        }),
      ],
      NOW,
      "10:3"
    );
    expect(sample.idle).toBe(false);
    expect(sample.active).toBe(1);
    expect(sample.stalledActive).toBe(0);
  });

  it("advances progress when work completes and ignores retained completed counts", () => {
    testingSetWatchdogProgress(10, 0);
    expect(workerProgressToken()).toBe("10:0");
    noteWatchdogJobCompleted();
    noteWatchdogJobCompleted();
    expect(workerProgressToken()).toBe("10:2");
    const busy = queue({ waitingCount: 1, oldestWaitingAt: NOW });
    expect(assessWorkerHealth([busy], NOW, "10:2").progress).toBe(
      assessWorkerHealth([busy], NOW, "10:2").progress
    );
  });

  it("can degrade on an overdue waiting job", () => {
    const sample = assessWorkerHealth(
      [
        queue({
          waitingCount: 2,
          oldestWaitingAt: NOW - OVERDUE_WAITING_MS - 1,
        }),
      ],
      NOW,
      "10:2"
    );
    expect(sample.idle).toBe(false);
    expect(sample.overdueWaiting).toBe(2);
  });

  it("detects an active job that has exceeded the processing threshold", () => {
    const sample = assessWorkerHealth(
      [
        queue({
          activeCount: 1,
          oldestActiveProcessedOn: NOW - STALLED_ACTIVE_MS - 1,
        }),
      ],
      NOW,
      "10:2"
    );
    expect(sample.idle).toBe(false);
    expect(sample.stalledActive).toBe(1);
  });

  it("does not treat a paused queue as idle", () => {
    expect(
      assessWorkerHealth([queue({ paused: true })], NOW, "10:0").idle
    ).toBe(false);
  });

  it("changes the progress token after a restart without calling the reset a stall", () => {
    const before = assessWorkerHealth([queue()], NOW, "10:8");
    const after = assessWorkerHealth([queue()], NOW, "20:0");
    expect(before.progress).not.toBe(after.progress);
    expect(after.idle).toBe(true);
    expect(after.loopAt).toBe(NOW);
  });
});

describe("watchdog heartbeat", () => {
  it("does nothing when the watchdog is not configured", () => {
    const previousUrl = process.env["WATCHDOG_URL"];
    const previousSecret = process.env["WATCHDOG_HMAC_SECRET"];
    delete process.env["WATCHDOG_URL"];
    delete process.env["WATCHDOG_HMAC_SECRET"];
    const stop = startWatchdogHeartbeat();
    expect(typeof stop).toBe("function");
    stop();
    if (previousUrl === undefined) delete process.env["WATCHDOG_URL"];
    else process.env["WATCHDOG_URL"] = previousUrl;
    if (previousSecret === undefined)
      delete process.env["WATCHDOG_HMAC_SECRET"];
    else process.env["WATCHDOG_HMAC_SECRET"] = previousSecret;
  });

  it("signs the watchdog canonical string", async () => {
    const secret = "k".repeat(32);
    const signed = await createSignedHeartbeat({
      url: "https://watchdog.example/v1/heartbeats/sfs-worker",
      secret,
      payload: { progress: "10:5", idle: false, loopAt: NOW },
      now: NOW,
      nonce: "abc123noncevalue",
    });
    const bodyHash = createHash("sha256").update(signed.body).digest("hex");
    const canonical = `1700000000\nabc123noncevalue\nPOST\n/v1/heartbeats/sfs-worker\n${bodyHash}`;
    const expected = createHmac("sha256", secret)
      .update(canonical)
      .digest("hex");
    expect(signed.headers["x-watchdog-signature"]).toBe(expected);
    expect(JSON.parse(signed.body)).toEqual({
      progress: "10:5",
      idle: false,
      loopAt: NOW,
    });
    await expect(
      createSignedHeartbeat({
        url: "http://watchdog.example/v1/heartbeats/sfs-worker",
        secret,
        payload: { progress: "0", idle: true, loopAt: 1 },
      })
    ).rejects.toThrow("watchdog_url_invalid");
    await expect(
      createSignedHeartbeat({
        url: "https://user:pw@watchdog.example/v1/heartbeats/sfs-worker",
        secret,
        payload: { progress: "0", idle: true, loopAt: 1 },
      })
    ).rejects.toThrow("watchdog_url_invalid");
    await expect(
      createSignedHeartbeat({
        url: "https://watchdog.example/v1/heartbeats/sfs-worker?x=1",
        secret,
        payload: { progress: "0", idle: true, loopAt: 1 },
      })
    ).rejects.toThrow("watchdog_url_invalid");
    await expect(
      createSignedHeartbeat({
        url: "https://watchdog.example/v1/heartbeats/sfs-worker",
        secret: "short",
        payload: { progress: "0", idle: true, loopAt: 1 },
      })
    ).rejects.toThrow("watchdog_secret_invalid");
    const generated = await createSignedHeartbeat({
      url: "https://watchdog.example/v1/heartbeats/sfs-worker",
      secret,
      payload: { progress: "0", idle: true, loopAt: 1 },
    });
    expect(generated.headers["x-watchdog-nonce"]).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe("configured watchdog sender", () => {
  const url = "https://watchdog.example/v1/heartbeats/sfs-worker";
  const secret = "k".repeat(32);

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    getJobCounts.mockReset();
    getJobs.mockReset();
    isPaused.mockReset();
  });

  function idleQueues(): void {
    isPaused.mockResolvedValue(false);
    getJobCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      paused: 0,
    });
    getJobs.mockResolvedValue([]);
  }

  it("does not start a timer when the secret is too short", () => {
    vi.stubEnv("WATCHDOG_URL", url);
    vi.stubEnv("WATCHDOG_HMAC_SECRET", "short");
    const stop = startWatchdogHeartbeat();
    stop();
    expect(getJobCounts).not.toHaveBeenCalled();
  });

  it("posts an inspected sample and retries one failed response", async () => {
    testingSetWatchdogProgress(10, 4);
    isPaused.mockResolvedValue(false);
    getJobCounts.mockResolvedValue({
      waiting: 1,
      active: 0,
      delayed: 0,
      paused: 0,
    });
    getJobs.mockImplementation(async (types: string[]) =>
      types[0] === "waiting" ? [{ timestamp: NOW }] : []
    );
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await runWatchdogHeartbeatTick(url, secret);
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(init.body))).toEqual({
      progress: "10:4",
      idle: false,
      loopAt: NOW,
    });
    expect(init.redirect).toBe("error");
  });

  it("does not post a healthy sample when Redis or BullMQ is unavailable", async () => {
    idleQueues();
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    await runWatchdogHeartbeatTick(url, secret);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    getJobCounts.mockRejectedValue(new Error("redis down"));
    await expect(runWatchdogHeartbeatTick(url, secret)).rejects.toThrow(
      "redis down"
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps publishing when the watchdog cannot be reached", async () => {
    vi.stubEnv("WATCHDOG_URL", url);
    vi.stubEnv("WATCHDOG_HMAC_SECRET", secret);
    getJobCounts.mockRejectedValue(new Error("redis down"));
    isPaused.mockResolvedValue(false);
    getJobs.mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const stop = startWatchdogHeartbeat(20);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).not.toHaveBeenCalled();
    stop();
  });

  it("stops emitting after the worker shuts the heartbeat down", async () => {
    vi.stubEnv("WATCHDOG_URL", url);
    vi.stubEnv("WATCHDOG_HMAC_SECRET", secret);
    idleQueues();
    let release = (): void => {
      throw new Error("fetch was not started");
    };
    const gate = new Promise<Response>((resolve) => {
      release = () => resolve(new Response("", { status: 200 }));
    });
    const fetchMock = vi.fn(() => gate);
    vi.stubGlobal("fetch", fetchMock);
    const stop = startWatchdogHeartbeat(30);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release();
    await gate;
    stop();
    const callsAtStop = fetchMock.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledTimes(callsAtStop);
  });
});
