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
  it("refuses an HTTP proxy when the backend is unset", () => {
    const decision = resolveNostrReadBackend({
      configured: undefined,
      primalCachingUrl: "https://cache.example/api",
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toContain("legacy_http");
    }
  });

  it("selects the in-process reader when the backend and HTTP proxy are unset", () => {
    expect(
      resolveNostrReadBackend({
        configured: "  ",
        primalCachingUrl: undefined,
      })
    ).toEqual({ ok: true, backend: "internal" });
    expect(
      resolveNostrReadBackend({
        configured: undefined,
        primalCachingUrl: "wss://cache.example/v1",
      })
    ).toEqual({ ok: true, backend: "internal" });
  });

  it("lets an explicit flag override the default", () => {
    expect(
      resolveNostrReadBackend({
        configured: "INTERNAL",
        primalCachingUrl: undefined,
      })
    ).toEqual({ ok: true, backend: "internal" });
    expect(
      resolveNostrReadBackend({
        configured: "legacy_http",
        primalCachingUrl: "https://cache.example/api",
      })
    ).toEqual({ ok: true, backend: "legacy_http" });
  });

  it("rejects an unknown flag", () => {
    const decision = resolveNostrReadBackend({
      configured: "cloudflare",
      primalCachingUrl: undefined,
    });
    expect(decision.ok).toBe(false);
  });
});

describe("read backend configuration errors", () => {
  it("rejects the internal reader combined with an HTTP proxy", () => {
    const error = readBackendSelectionError({
      configured: "internal",
      primalCachingUrl: "https://worker.example",
    });
    expect(error?.key).toBe("NOSTR_READ_BACKEND");
    expect(error?.reason).toContain("HTTP");
  });

  it("requires an HTTP URL for the legacy proxy", () => {
    const error = readBackendSelectionError({
      configured: "legacy_http",
      primalCachingUrl: "wss://cache.example/v1",
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
