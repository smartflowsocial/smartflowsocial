import { describe, expect, it } from "vitest";

import {
  assessRelayUrl,
  canonicalRelayKey,
  dedupeRelayUrls,
  isBlockedRelayAddress,
  isTransientPublishFailure,
} from "~/infra/publishers/relay-target";

describe("relay target checks", () => {
  it("canonicalizes scheme, host, and a trailing slash", () => {
    expect(canonicalRelayKey("WSS://Relay.Example.com/path/")).toBe(
      "wss://relay.example.com/path"
    );
    expect(
      dedupeRelayUrls([
        "wss://Relay.Example.com/",
        "wss://relay.example.com",
        "  ",
        "wss://other.example",
      ])
    ).toEqual(["wss://Relay.Example.com/", "wss://other.example"]);
  });

  it("allows a public wss relay and blocks credentials", () => {
    expect(assessRelayUrl("wss://relay.example.com/path", false).ok).toBe(true);
    expect(assessRelayUrl("wss://8.8.8.8/", false).ok).toBe(true);
    const credentials = assessRelayUrl(
      "wss://user:secret@relay.example.com",
      false
    );
    expect(credentials.ok).toBe(false);
    if (!credentials.ok) expect(credentials.category).toBe("invalid_relay_url");
  });

  it("blocks private, mapped, metadata, and ambiguous addresses", () => {
    const blocked = [
      "wss://127.0.0.1/",
      "wss://10.1.2.3/",
      "wss://192.168.1.9/",
      "wss://172.16.0.4/",
      "wss://169.254.169.254/",
      "wss://0.0.0.0/",
      "wss://100.64.0.1/",
      "wss://[::1]/",
      "wss://[fd00::1]/",
      "wss://[::ffff:127.0.0.1]/",
      "wss://localhost/",
      "wss://printer.local/",
      "wss://metadata.google.internal/",
      "wss://2130706433/",
      "wss://0177.0.0.1/",
      "ws://relay.example.com/",
      "https://relay.example.com/",
      "wss://relay.example.com/#frag",
    ];
    for (const relay of blocked) {
      expect(assessRelayUrl(relay, false).ok, relay).toBe(false);
    }
    expect(isBlockedRelayAddress("224.0.0.1", true)).toBe(true);
    expect(isBlockedRelayAddress("169.254.169.254", true)).toBe(true);
  });

  it("permits a private relay only when the operator flag is on", () => {
    expect(assessRelayUrl("ws://127.0.0.1:8080/", true).ok).toBe(true);
    expect(assessRelayUrl("wss://10.0.0.8/", true).ok).toBe(true);
    expect(assessRelayUrl("wss://metadata.google.internal/", true).ok).toBe(
      false
    );
    const publicWs = assessRelayUrl("ws://relay.example.com/", true);
    expect(publicWs.ok).toBe(false);
    if (!publicWs.ok) {
      expect(publicWs.message).toContain("private relay");
    }
  });

  it("retries connection failures and does not retry a relay rejection", () => {
    expect(isTransientPublishFailure("connection_timeout")).toBe(true);
    expect(isTransientPublishFailure("ack_timeout")).toBe(true);
    expect(isTransientPublishFailure("closed")).toBe(true);
    expect(isTransientPublishFailure("rejected")).toBe(false);
    expect(isTransientPublishFailure("private_address")).toBe(false);
    expect(isTransientPublishFailure("invalid_event")).toBe(false);
  });
});
