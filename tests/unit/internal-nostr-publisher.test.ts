import { afterEach, describe, expect, it } from "vitest";

import { createValidSignedEvent } from "../utils/nostr-test-helpers";
import {
  readRelayEvent,
  startScriptedRelay,
  startSilentTcpServer,
} from "../utils/scripted-relay";

import {
  closeInternalPublisherConnections,
  InternalNostrPublisher,
  internalPublisherOpenSocketCount,
  type InternalNostrPublisherOptions,
} from "~/infra/publishers/internal-nostr-publisher.server";
import {
  allRelaysRejected,
  relayPublishFailureMessage,
} from "~/infra/publishers/publish-outcome";
import { createMemoryPublishLedger } from "~/infra/publishers/publisher-ledger";
import { canonicalRelayKey } from "~/infra/publishers/relay-target";
import { getRelayHealth } from "~/infra/relays/relay-health.server";
import { isRetryableErrorEnhanced } from "~/lib/error-classification.server";
import { ValidationError } from "~/lib/errors";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await closeInternalPublisherConnections();
  while (closers.length > 0) {
    const close = closers.pop();
    if (close) await close();
  }
});

function track(relay: { close(): Promise<void> }): void {
  closers.push(() => relay.close());
}

function publisher(
  options: InternalNostrPublisherOptions = {}
): InternalNostrPublisher {
  return new InternalNostrPublisher({
    allowPrivateRelays: true,
    connectTimeoutMs: 400,
    ackTimeoutMs: 400,
    totalTimeoutMs: 2000,
    retryDelayMs: 15,
    processConcurrency: 8,
    ledger: createMemoryPublishLedger(),
    ...options,
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for the publisher condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

describe("internal Nostr publisher", () => {
  it("delivers a signed event and reads it back from the relay", async () => {
    const relay = await startScriptedRelay();
    track(relay);
    const event = createValidSignedEvent({
      content: "internal publisher delivery",
    });
    const result = await publisher().publish(
      event,
      [relay.url],
      "delivery-test"
    );

    expect(result.results).toEqual([
      expect.objectContaining({ relay: relay.url, ok: true }),
    ]);
    expect(relay.events.get(event.id)?.content).toBe(event.content);
    expect((await readRelayEvent(relay.url, event.id))?.content).toBe(
      event.content
    );
    expect(getRelayHealth(relay.url)?.successCount).toBeGreaterThan(0);
    expect(internalPublisherOpenSocketCount()).toBe(0);
  });

  it("reports every relay when all of them reject", async () => {
    const first = await startScriptedRelay("reject");
    const second = await startScriptedRelay("reject");
    track(first);
    track(second);
    const event = createValidSignedEvent({ content: "all fail" });
    const result = await publisher({ transientRetries: 0 }).publish(event, [
      first.url,
      second.url,
    ]);

    expect(result.results).toHaveLength(2);
    expect(result.results.every((row) => row.ok)).toBe(false);
    expect(result.results.every((row) => row.error?.includes("rejected"))).toBe(
      true
    );
    expect(allRelaysRejected(result.results)).toBe(true);
    expect(first.events.size + second.events.size).toBe(0);
  });

  it("keeps a successful relay when another relay rejects", async () => {
    const good = await startScriptedRelay();
    const bad = await startScriptedRelay("reject");
    track(good);
    track(bad);
    const event = createValidSignedEvent({ content: "partial" });
    const result = await publisher({ transientRetries: 0 }).publish(event, [
      good.url,
      bad.url,
    ]);
    const byRelay = new Map(result.results.map((row) => [row.relay, row]));

    expect(byRelay.get(good.url)?.ok).toBe(true);
    expect(byRelay.get(bad.url)?.ok).toBe(false);
    expect(byRelay.get(bad.url)?.error).toContain("blocked: test");
    expect(good.events.has(event.id)).toBe(true);
    expect(bad.attempts).toBe(1);
  });

  it("times out a connection that never completes the handshake", async () => {
    const silent = await startSilentTcpServer();
    track(silent);
    const event = createValidSignedEvent({ content: "connect timeout" });
    const result = await publisher({
      connectTimeoutMs: 200,
      ackTimeoutMs: 200,
      totalTimeoutMs: 1000,
      transientRetries: 0,
    }).publish(event, [silent.url]);

    expect(result.results[0]?.ok).toBe(false);
    expect(result.results[0]?.error?.toLowerCase()).toMatch(
      /timed out|timeout/
    );
    expect(internalPublisherOpenSocketCount()).toBe(0);
  });

  it("times out when the relay never acknowledges", async () => {
    const relay = await startScriptedRelay("ignore");
    track(relay);
    const event = createValidSignedEvent({ content: "ack timeout" });
    const result = await publisher({
      connectTimeoutMs: 400,
      ackTimeoutMs: 200,
      totalTimeoutMs: 1000,
      transientRetries: 0,
    }).publish(event, [relay.url]);

    expect(result.results[0]?.ok).toBe(false);
    expect(result.results[0]?.error).toContain("acknowledgment timeout");
    expect(
      isRetryableErrorEnhanced(
        new Error(relayPublishFailureMessage(result.results))
      )
    ).toBe(true);
    expect(internalPublisherOpenSocketCount()).toBe(0);
  });

  it("rejects an invalid signature and a mismatched id before connecting", async () => {
    const relay = await startScriptedRelay();
    track(relay);
    const signed = createValidSignedEvent({ content: "original" });
    const badSignature = { ...signed, sig: "ab".repeat(64) };
    const badId = { ...signed, content: "changed after signing" };

    await expect(
      publisher().publish(badSignature, [relay.url])
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(publisher().publish(badId, [relay.url])).rejects.toThrow(
      /id does not match/
    );
    const malformed: unknown = { hello: true };
    await expect(
      publisher().publish(malformed as never, [relay.url])
    ).rejects.toThrow(/Malformed/);
    expect(relay.attempts).toBe(0);
    expect(relay.connections).toBe(0);
  });

  it("stores one copy when the same event is published twice", async () => {
    const relay = await startScriptedRelay();
    track(relay);
    const event = createValidSignedEvent({ content: "duplicate" });
    const engine = publisher({
      transientRetries: 0,
      ledger: {
        confirmed: async () => false,
        markConfirmed: async () => undefined,
      },
    });

    const first = await engine.publish(event, [relay.url]);
    const second = await engine.publish(event, [relay.url]);

    expect(first.results[0]?.ok).toBe(true);
    expect(second.results[0]?.ok).toBe(true);
    expect(relay.events.size).toBe(1);
    expect(relay.attempts).toBe(2);
  });

  it("retries a dropped socket and stops when retries are disabled", async () => {
    const recovering = await startScriptedRelay("drop-once");
    const closed = await startScriptedRelay("drop-once");
    track(recovering);
    track(closed);
    const event = createValidSignedEvent({ content: "retry" });
    const recovered = await publisher({ transientRetries: 1 }).publish(event, [
      recovering.url,
    ]);
    const stopped = await new InternalNostrPublisher({
      allowPrivateRelays: true,
      connectTimeoutMs: 400,
      ackTimeoutMs: 400,
      totalTimeoutMs: 1500,
      ledger: createMemoryPublishLedger(),
    }).publish(
      createValidSignedEvent({ content: "no retry" }),
      [closed.url],
      undefined,
      "aggressive"
    );

    expect(recovered.results[0]?.ok).toBe(true);
    expect(recovering.attempts).toBe(2);
    expect(stopped.results[0]?.ok).toBe(false);
    expect(closed.attempts).toBe(1);
    expect(closed.events.size).toBe(0);
  });

  it("publishes again after the relay starts accepting", async () => {
    const down = await startSilentTcpServer();
    const up = await startScriptedRelay();
    track(down);
    track(up);
    const event = createValidSignedEvent({ content: "recovery" });
    const engine = publisher({ transientRetries: 0, connectTimeoutMs: 200 });
    const failed = await engine.publish(event, [down.url]);
    const recovered = await engine.publish(event, [up.url]);

    expect(failed.results[0]?.ok).toBe(false);
    expect(recovered.results[0]?.ok).toBe(true);
    expect(up.events.has(event.id)).toBe(true);
  });

  it("does not record success when the process closes an open socket", async () => {
    const relay = await startScriptedRelay("ignore");
    const live = await startScriptedRelay();
    track(relay);
    track(live);
    const ledger = createMemoryPublishLedger();
    const engine = publisher({
      ledger,
      ackTimeoutMs: 4000,
      totalTimeoutMs: 6000,
      transientRetries: 0,
    });
    const event = createValidSignedEvent({ content: "restart" });
    const pending = engine.publish(event, [relay.url]);
    await waitFor(() => internalPublisherOpenSocketCount() >= 1);
    await closeInternalPublisherConnections();
    const result = await pending;

    expect(result.results[0]?.ok).toBe(false);
    expect(ledger.size()).toBe(0);
    expect(internalPublisherOpenSocketCount()).toBe(0);
    const again = await engine.publish(event, [live.url]);
    expect(again.results[0]?.ok).toBe(true);
    expect(ledger.size()).toBe(1);
  });

  it("limits how many relay sockets are open at once", async () => {
    const relay = await startScriptedRelay("hold");
    track(relay);
    const engine = publisher({
      processConcurrency: 2,
      ackTimeoutMs: 3000,
      totalTimeoutMs: 5000,
      transientRetries: 0,
    });
    const pending = [0, 1, 2, 3].map((index) =>
      engine.publish(
        createValidSignedEvent({ content: `concurrent ${index}` }),
        [relay.url]
      )
    );
    await waitFor(() => internalPublisherOpenSocketCount() === 2);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(internalPublisherOpenSocketCount()).toBe(2);
    relay.release();
    const results = await Promise.all(pending);

    expect(results.every((result) => result.results[0]?.ok)).toBe(true);
    expect(relay.events.size).toBe(4);
    expect(internalPublisherOpenSocketCount()).toBe(0);
  });

  it("still publishes to a relay that has not acknowledged the event", async () => {
    const first = await startScriptedRelay();
    const second = await startScriptedRelay();
    track(first);
    track(second);
    const ledger = createMemoryPublishLedger();
    const engine = publisher({ ledger, transientRetries: 0 });
    const event = createValidSignedEvent({ content: "second relay" });

    await engine.publish(event, [first.url]);
    const before = first.attempts;
    const result = await engine.publish(event, [first.url, second.url]);

    expect(first.attempts).toBe(before);
    expect(second.events.has(event.id)).toBe(true);
    expect(result.results.find((row) => row.relay === first.url)?.ok).toBe(
      true
    );
    expect(result.results.find((row) => row.relay === second.url)?.ok).toBe(
      true
    );
    expect(ledger.size()).toBe(2);
  });

  it("publishes when the acknowledgement record cannot be read", async () => {
    const relay = await startScriptedRelay();
    track(relay);
    const event = createValidSignedEvent({ content: "redis down" });
    const result = await publisher({
      transientRetries: 0,
      ledger: {
        confirmed: async () => {
          throw new Error("redis down");
        },
        markConfirmed: async () => {
          throw new Error("redis down");
        },
      },
    }).publish(event, [relay.url]);

    expect(result.results[0]?.ok).toBe(true);
    expect(relay.events.has(event.id)).toBe(true);
  });

  it("preserves a negative acknowledgement and does not retry it", async () => {
    const relay = await startScriptedRelay("reject");
    track(relay);
    const event = createValidSignedEvent({ content: "negative ack" });
    const result = await publisher({ transientRetries: 1 }).publish(event, [
      relay.url,
    ]);

    expect(result.results[0]?.ok).toBe(false);
    expect(result.results[0]?.error).toBe("rejected: blocked: test");
    expect(relay.attempts).toBe(1);
    expect(
      isRetryableErrorEnhanced(
        new Error(relayPublishFailureMessage(result.results))
      )
    ).toBe(false);
  });

  it("blocks a public name that resolves to a private address", async () => {
    const event = createValidSignedEvent({ content: "dns rebinding" });
    const result = await publisher({
      allowPrivateRelays: false,
      transientRetries: 0,
      resolveAddresses: async () => ["10.0.0.1"],
    }).publish(event, ["wss://relay.example.com/"]);

    expect(result.results[0]?.ok).toBe(false);
    expect(result.results[0]?.error).toContain("blocked address");
    expect(internalPublisherOpenSocketCount()).toBe(0);
  });

  it("does not open a loopback relay unless private relays are enabled", async () => {
    const relay = await startScriptedRelay();
    track(relay);
    const event = createValidSignedEvent({ content: "private blocked" });
    const result = await publisher({
      allowPrivateRelays: false,
      transientRetries: 0,
    }).publish(event, [relay.url]);

    expect(result.results[0]?.ok).toBe(false);
    expect(result.results[0]?.error).toContain("not a public address");
    expect(relay.attempts).toBe(0);
  });

  it("dedupes relay URLs and reports relays past the cap", async () => {
    const relay = await startScriptedRelay();
    const extra = await startScriptedRelay();
    track(relay);
    track(extra);
    const event = createValidSignedEvent({ content: "dedupe" });
    const result = await publisher({
      maxRelays: 1,
      transientRetries: 0,
    }).publish(event, [relay.url, `${relay.url}/`, extra.url]);

    expect(result.results.filter((row) => row.ok)).toHaveLength(1);
    expect(
      result.results.some((row) => row.error === "relay limit exceeded")
    ).toBe(true);
    expect(relay.events.size + extra.events.size).toBe(1);
  });

  it("skips a relay that already confirmed and still delivers a direct message", async () => {
    const relay = await startScriptedRelay();
    track(relay);
    const ledger = createMemoryPublishLedger();
    const event = createValidSignedEvent({ content: "cached" });
    await ledger.markConfirmed(event.id, canonicalRelayKey(relay.url));
    const cached = await publisher({ ledger, transientRetries: 0 }).publish(
      event,
      [relay.url]
    );
    const direct = createValidSignedEvent({
      kind: 4,
      content: "gift-wrap-ciphertext",
      tags: [["p", "ab".repeat(32)]],
    });
    const delivered = await publisher({
      ledger: createMemoryPublishLedger(),
      transientRetries: 0,
    }).publish(direct, [relay.url]);

    expect(cached.results[0]).toMatchObject({ ok: true, latencyMs: 0 });
    expect(cached.results[0]?.error).toBeUndefined();
    expect(relay.events.has(event.id)).toBe(false);
    expect(delivered.results[0]?.ok).toBe(true);
    expect(relay.events.get(direct.id)?.kind).toBe(4);
  });

  it("refuses an event above the size limit without connecting", async () => {
    const relay = await startScriptedRelay();
    track(relay);
    const event = createValidSignedEvent({ content: "too big" });
    await expect(
      publisher({ maxEventBytes: 32 }).publish(event, [relay.url])
    ).rejects.toThrow(/size limit/);
    expect(relay.attempts).toBe(0);
  });
});
