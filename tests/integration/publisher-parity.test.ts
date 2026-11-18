import { afterEach, describe, expect, it } from "vitest";

import { createValidSignedEvent } from "../utils/nostr-test-helpers";
import { readRelayEvent, startScriptedRelay } from "../utils/scripted-relay";

import { InternalNostrPublisher } from "~/infra/publishers/internal-nostr-publisher.server";
import { createMemoryPublishLedger } from "~/infra/publishers/publisher-ledger";

interface RelayPublisherHandle {
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close) await close();
  }
});

async function httpPublish(
  port: number,
  token: string,
  event: unknown,
  relays: string[]
): Promise<{ status: number; results: Array<{ ok: boolean }> }> {
  const response = await fetch(`http://127.0.0.1:${port}/publish`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "API-TOKEN": token,
    },
    body: JSON.stringify({ event, relays }),
  });
  const body = (await response.json()) as { results?: Array<{ ok: boolean }> };
  return { status: response.status, results: body.results ?? [] };
}

describe("internal publisher parity with the loopback HTTP publisher", () => {
  it("agrees on success, rejection, and an independent relay read", async () => {
    const good = await startScriptedRelay();
    const bad = await startScriptedRelay("reject");
    closers.push(
      () => good.close(),
      () => bad.close()
    );
    const publisherModule: {
      createRelayPublisher: (options?: {
        token?: string;
      }) => RelayPublisherHandle;
    } = await import("../../scripts/relay-publisher.mjs");
    const token = "parity-token";
    const http = publisherModule.createRelayPublisher({ token });
    const port = await http.listen(0, "127.0.0.1");
    closers.push(() => http.close());

    const internal = new InternalNostrPublisher({
      allowPrivateRelays: true,
      connectTimeoutMs: 800,
      ackTimeoutMs: 800,
      totalTimeoutMs: 3000,
      transientRetries: 0,
      ledger: createMemoryPublishLedger(),
    });
    const accepted = createValidSignedEvent({ content: "parity accepted" });
    const rejected = createValidSignedEvent({ content: "parity rejected" });

    const internalOk = await internal.publish(accepted, [good.url]);
    const httpOk = await httpPublish(port, token, accepted, [good.url]);
    const internalRejected = await internal.publish(rejected, [bad.url]);
    const httpRejected = await httpPublish(port, token, rejected, [bad.url]);

    expect(internalOk.results[0]?.ok).toBe(true);
    expect(httpOk.status).toBe(200);
    expect(httpOk.results[0]?.ok).toBe(true);
    expect(internalRejected.results[0]?.ok).toBe(false);
    expect(httpRejected.status).toBe(502);
    expect(httpRejected.results[0]?.ok).toBe(false);
    expect((await readRelayEvent(good.url, accepted.id))?.content).toBe(
      accepted.content
    );
    expect(await readRelayEvent(bad.url, rejected.id)).toBeNull();
  });
});
