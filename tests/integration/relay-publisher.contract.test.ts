import { describe, expect, it } from "vitest";

import { startEphemeralRelay } from "../../scripts/ephemeral-relay.mjs";
import { createRelayPublisher } from "../../scripts/relay-publisher.mjs";
import { signedKind1 } from "../../scripts/relay-test-event.mjs";

interface SignedKind1 {
  id: string;
  pubkey: string;
  content: string;
  kind: number;
  created_at: number;
  tags: string[][];
  sig: string;
}

interface EphemeralRelay {
  url: string;
  events: Map<string, { content?: string }>;
  close: () => Promise<void>;
}

interface RelayPublisherHandle {
  listen: (port: number, host: string) => Promise<number>;
  close: () => Promise<void>;
}

function signedEvent(content: string): { event: SignedKind1 } {
  return signedKind1(content);
}

function startRelay(): Promise<EphemeralRelay> {
  return startEphemeralRelay();
}

function openPublisher(): RelayPublisherHandle {
  return createRelayPublisher({
    token: "relay-test-token",
  });
}

async function postPublish(
  port: number,
  token: string | undefined,
  body: unknown
): Promise<{ status: number; json: { results?: Array<{ ok: boolean }> } }> {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("api-token", token);
  const response = await fetch(`http://127.0.0.1:${port}/publish`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as {
    results?: Array<{ ok: boolean }>;
  };
  return { status: response.status, json };
}

describe("relay publisher contract", () => {
  it("delivers a signed event to a local relay and ignores a duplicate", async () => {
    const relay = await startRelay();
    const publisher = openPublisher();
    const port = await publisher.listen(0, "127.0.0.1");
    try {
      const { event } = signedEvent("relay contract");
      const first = await postPublish(port, "relay-test-token", {
        relays: [relay.url],
        event,
      });
      expect(first.status).toBe(200);
      expect(first.json.results?.[0]?.ok).toBe(true);
      expect(relay.events.get(event.id)?.content).toBe("relay contract");

      const second = await postPublish(port, "relay-test-token", {
        relays: [relay.url],
        event,
      });
      expect(second.status).toBe(200);
      expect(relay.events.size).toBe(1);
    } finally {
      await publisher.close();
      await relay.close();
    }
  });

  it("rejects an invalid signature before the relay stores it", async () => {
    const relay = await startRelay();
    const publisher = openPublisher();
    const port = await publisher.listen(0, "127.0.0.1");
    try {
      const { event } = signedEvent("bad signature");
      const tampered = { ...event, content: "changed" };
      const response = await postPublish(port, "relay-test-token", {
        relays: [relay.url],
        event: tampered,
      });
      expect(response.status).toBe(400);
      expect(relay.events.size).toBe(0);
    } finally {
      await publisher.close();
      await relay.close();
    }
  });

  it("rejects a wrong publisher token", async () => {
    const publisher = openPublisher();
    const port = await publisher.listen(0, "127.0.0.1");
    try {
      const { event } = signedEvent("token");
      const response = await postPublish(port, "wrong-token", {
        relays: ["ws://127.0.0.1:1"],
        event,
      });
      expect(response.status).toBe(401);
    } finally {
      await publisher.close();
    }
  });

  it("reports a relay that is not running", async () => {
    const publisher = openPublisher();
    const port = await publisher.listen(0, "127.0.0.1");
    try {
      const { event } = signedEvent("relay down");
      const response = await postPublish(port, "relay-test-token", {
        relays: ["ws://127.0.0.1:1"],
        event,
      });
      expect(response.status).toBe(502);
      expect(response.json.results?.[0]?.ok).toBe(false);
    } finally {
      await publisher.close();
    }
  });
});
