import { createHmac, createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

const getJobCounts = vi.hoisted(() => vi.fn());

vi.mock("~/infra/queue", () => ({
  getQueueInstance: () => ({ getJobCounts }),
}));

import {
  createSignedHeartbeat,
  runWatchdogHeartbeatTick,
  sampleFromCounts,
  startWatchdogHeartbeat,
} from "~/infra/watchdog-heartbeat.server";

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

  it("treats an empty queue as idle and a backlog as work in progress", () => {
    expect(
      sampleFromCounts(
        [{ waiting: 0, active: 0, delayed: 0, completed: 4 }],
        1_700_000_000_000
      )
    ).toEqual({ progress: "4", idle: true, loopAt: 1_700_000_000_000 });
    expect(
      sampleFromCounts(
        [
          { waiting: 2, active: 0, delayed: 0, completed: 4 },
          { waiting: 0, active: 1, delayed: 3, completed: 1 },
        ],
        1_700_000_000_000
      )
    ).toEqual({ progress: "5", idle: false, loopAt: 1_700_000_000_000 });
  });

  it("signs the watchdog canonical string", async () => {
    const secret = "k".repeat(32);
    const signed = await createSignedHeartbeat({
      url: "https://watchdog.example/v1/heartbeats/sfs-worker",
      secret,
      payload: { progress: "5", idle: false, loopAt: 1_700_000_000_000 },
      now: 1_700_000_000_000,
      nonce: "abc123noncevalue",
    });
    const bodyHash = createHash("sha256").update(signed.body).digest("hex");
    const canonical = `1700000000\nabc123noncevalue\nPOST\n/v1/heartbeats/sfs-worker\n${bodyHash}`;
    const expected = createHmac("sha256", secret)
      .update(canonical)
      .digest("hex");
    expect(signed.headers["x-watchdog-signature"]).toBe(expected);
    expect(JSON.parse(signed.body)).toEqual({
      progress: "5",
      idle: false,
      loopAt: 1_700_000_000_000,
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

  it("clamps negative queue counts", () => {
    expect(
      sampleFromCounts(
        [{ waiting: -2, active: -1, delayed: -4, completed: -3 }],
        5
      )
    ).toEqual({ progress: "0", idle: true, loopAt: 5 });
  });
});

describe("configured watchdog sender", () => {
  const url = "https://watchdog.example/v1/heartbeats/sfs-worker";
  const secret = "k".repeat(32);

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    getJobCounts.mockReset();
  });

  it("does not start a timer when the secret is too short", () => {
    vi.stubEnv("WATCHDOG_URL", url);
    vi.stubEnv("WATCHDOG_HMAC_SECRET", "short");
    const stop = startWatchdogHeartbeat();
    stop();
    expect(getJobCounts).not.toHaveBeenCalled();
  });

  it("posts sampled queue progress and retries one failed response", async () => {
    getJobCounts.mockResolvedValue({
      waiting: 1,
      active: 0,
      delayed: 0,
      completed: 2,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await runWatchdogHeartbeatTick(url, secret);
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(init.body))).toMatchObject({
      progress: "8",
      idle: false,
    });
    expect(init.redirect).toBe("error");
  });

  it("drops the sample when both sends fail and ignores a queue error", async () => {
    getJobCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      completed: 1,
    });
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

  it("keeps running when queue inspection fails", async () => {
    vi.stubEnv("WATCHDOG_URL", url);
    vi.stubEnv("WATCHDOG_HMAC_SECRET", secret);
    getJobCounts.mockRejectedValue(new Error("redis down"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const stop = startWatchdogHeartbeat(20);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).not.toHaveBeenCalled();
    stop();
  });

  it("skips a tick that is already in flight and a tick after stop", async () => {
    vi.stubEnv("WATCHDOG_URL", url);
    vi.stubEnv("WATCHDOG_HMAC_SECRET", secret);
    getJobCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      completed: 0,
    });
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
