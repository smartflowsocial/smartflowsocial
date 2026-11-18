import { describe, expect, it } from "vitest";

import {
  parseSocketUrlList,
  primalSocketEndpoints,
} from "~/infra/nostr-read/endpoints";
import {
  readBackendSelectionError,
  readTimeoutMs,
  resolveNostrReadBackend,
  validateNostrMashWsUrl,
  validateReadTimeoutMs,
} from "~/infra/nostr-read/read-backend";

describe("resolveNostrReadBackend", () => {
  it("keeps an HTTP proxy on the legacy reader when the flag is unset", () => {
    expect(
      resolveNostrReadBackend({
        configured: undefined,
        primalCachingUrl: "https://cache.example/api",
        selfHosted: "true",
      })
    ).toEqual({ ok: true, backend: "legacy_http" });
  });

  it("selects the in-process reader for a self-hosted install with no proxy", () => {
    expect(
      resolveNostrReadBackend({
        configured: "  ",
        primalCachingUrl: undefined,
        selfHosted: "self-hosted",
      })
    ).toEqual({ ok: true, backend: "internal" });
  });

  it("keeps a hosted install with no proxy on direct sockets", () => {
    expect(
      resolveNostrReadBackend({
        configured: undefined,
        primalCachingUrl: "wss://cache.example/v1",
        selfHosted: "false",
      })
    ).toEqual({ ok: true, backend: "legacy_ws" });
  });

  it("lets an explicit flag override the default", () => {
    expect(
      resolveNostrReadBackend({
        configured: "INTERNAL",
        primalCachingUrl: undefined,
        selfHosted: "false",
      })
    ).toEqual({ ok: true, backend: "internal" });
  });

  it("rejects an unknown flag", () => {
    const decision = resolveNostrReadBackend({
      configured: "cloudflare",
      primalCachingUrl: undefined,
      selfHosted: "true",
    });
    expect(decision.ok).toBe(false);
  });
});

describe("read backend configuration errors", () => {
  it("rejects the internal reader combined with an HTTP proxy", () => {
    const error = readBackendSelectionError({
      configured: "internal",
      primalCachingUrl: "https://worker.example",
      selfHosted: "false",
    });
    expect(error?.key).toBe("NOSTR_READ_BACKEND");
    expect(error?.reason).toContain("HTTP");
  });

  it("requires an HTTP URL for the legacy proxy", () => {
    const error = readBackendSelectionError({
      configured: "legacy_http",
      primalCachingUrl: "wss://cache.example/v1",
      selfHosted: "false",
    });
    expect(error?.key).toBe("PRIMAL_CACHING_URL");
  });

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
  });

  it("bounds the read timeout", () => {
    expect(validateReadTimeoutMs("15000")).toBeNull();
    expect(validateReadTimeoutMs("1000")).toContain("3000");
    expect(validateReadTimeoutMs("nope")).toContain("integer");
    expect(readTimeoutMs(undefined)).toBe(15_000);
    expect(readTimeoutMs("12000")).toBe(12_000);
  });
});

describe("primal socket endpoints", () => {
  it("uses public Primal sockets when the proxy URL is HTTP or unset", () => {
    expect(primalSocketEndpoints(undefined)).toEqual([
      "wss://cache1.primal.net/v1",
      "wss://cache2.primal.net/v1",
    ]);
    expect(primalSocketEndpoints("https://worker.example")).toEqual([
      "wss://cache1.primal.net/v1",
      "wss://cache2.primal.net/v1",
    ]);
  });

  it("keeps a configured WebSocket list and rejects credentials", () => {
    const parsed = parseSocketUrlList(
      "wss://cache.example/v1, wss://other.example/v1"
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.urls).toEqual([
        "wss://cache.example/v1",
        "wss://other.example/v1",
      ]);
    }
    expect(parseSocketUrlList("wss://user:secret@cache.example/v1").ok).toBe(
      false
    );
    expect(parseSocketUrlList("http://cache.example/v1").ok).toBe(false);
  });
});
