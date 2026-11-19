import { describe, expect, it } from "vitest";

import {
  parseSocketUrlList,
  primalSocketConfigError,
  primalSocketEndpoints,
} from "~/infra/nostr-read/endpoints";
import {
  readTimeoutMs,
  validateNostrMashWsUrl,
  validateReadTimeoutMs,
} from "~/infra/nostr-read/read-backend";

describe("read configuration", () => {
  it("rejects the old NostrMash socket path", () => {
    expect(
      validateNostrMashWsUrl("wss://api.nostrmash.com/primal/ws")
    ).toContain("/primal/ws/v1");
    expect(
      validateNostrMashWsUrl("wss://api.nostrmash.com/primal/ws/v1")
    ).toBeNull();
    expect(
      validateNostrMashWsUrl("https://api.nostrmash.com/primal/ws/v1")
    ).toContain("ws://");
    expect(
      validateNostrMashWsUrl("wss://user:token@api.nostrmash.com/primal/ws/v1")
    ).toContain("credentials");
    expect(validateNostrMashWsUrl("not a url")).toContain("ws://");
    expect(validateNostrMashWsUrl("   ")).toBeNull();
  });

  it("bounds the read timeout", () => {
    expect(validateReadTimeoutMs("15000")).toBeNull();
    expect(validateReadTimeoutMs("")).toBeNull();
    expect(validateReadTimeoutMs("1000")).toContain("3000");
    expect(validateReadTimeoutMs("nope")).toContain("integer");
    expect(readTimeoutMs(undefined)).toBe(15_000);
    expect(readTimeoutMs("12000")).toBe(12_000);
    expect(readTimeoutMs("nope")).toBe(15_000);
    expect(readTimeoutMs("1000")).toBe(15_000);
  });
});

describe("primal socket endpoints", () => {
  it("uses public Primal sockets when the list is unset", () => {
    expect(primalSocketEndpoints(undefined)).toEqual([
      "wss://cache1.primal.net/v1",
      "wss://cache2.primal.net/v1",
    ]);
    expect(primalSocketEndpoints("  ")).toEqual([
      "wss://cache1.primal.net/v1",
      "wss://cache2.primal.net/v1",
    ]);
    expect(primalSocketConfigError(undefined)).toBeNull();
    expect(primalSocketConfigError("")).toBeNull();
  });

  it("keeps a configured WebSocket list and rejects other schemes", () => {
    const parsed = parseSocketUrlList(
      "wss://cache.example/v1, wss://other.example/v1"
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(primalSocketEndpoints(parsed.urls.join(","))).toEqual(parsed.urls);
    }
    expect(parseSocketUrlList("wss://user:secret@cache.example/v1").ok).toBe(
      false
    );
    expect(parseSocketUrlList("http://cache.example/v1").ok).toBe(false);
    expect(primalSocketConfigError("https://cache.example")).toContain(
      "PRIMAL_UPSTREAM_URLS"
    );
    expect(
      primalSocketConfigError(
        Array.from(
          { length: 9 },
          (_, index) => `wss://cache${index}.example/v1`
        ).join(",")
      )
    ).toContain("at most");
  });
});
