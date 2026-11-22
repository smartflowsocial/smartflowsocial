import { createHmac, createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createSignedHeartbeat,
  sampleFromCounts,
  startWatchdogHeartbeat,
} from "~/infra/watchdog-heartbeat.server";

describe("watchdog heartbeat", () => {
  it("does nothing when the watchdog is not configured", () => {
    const previousUrl = process.env.WATCHDOG_URL;
    const previousSecret = process.env.WATCHDOG_HMAC_SECRET;
    delete process.env.WATCHDOG_URL;
    delete process.env.WATCHDOG_HMAC_SECRET;
    const stop = startWatchdogHeartbeat();
    expect(typeof stop).toBe("function");
    stop();
    if (previousUrl === undefined) delete process.env.WATCHDOG_URL;
    else process.env.WATCHDOG_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.WATCHDOG_HMAC_SECRET;
    else process.env.WATCHDOG_HMAC_SECRET = previousSecret;
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
  });
});
