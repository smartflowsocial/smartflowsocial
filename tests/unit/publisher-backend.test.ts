import { describe, expect, it } from "vitest";

import { resolveNostrPublisherBackend } from "~/infra/publishers/publisher-backend";

describe("resolveNostrPublisherBackend", () => {
  it("selects the internal publisher when the backend is unset", () => {
    expect(
      resolveNostrPublisherBackend({
        configured: undefined,
        publisherUrl: undefined,
      })
    ).toEqual({ ok: true, backend: "internal" });
    expect(
      resolveNostrPublisherBackend({ configured: "  ", publisherUrl: "" })
    ).toEqual({ ok: true, backend: "internal" });
  });

  it("refuses a publisher URL that has no explicit backend", () => {
    const decision = resolveNostrPublisherBackend({
      configured: undefined,
      publisherUrl: "https://publisher.example/publish",
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toContain("NOSTR_PUBLISHER_URL");
      expect(decision.reason).toContain("http");
    }
  });

  it("keeps an explicit HTTP adapter", () => {
    expect(
      resolveNostrPublisherBackend({
        configured: "http",
        publisherUrl: "https://publisher.example/publish",
      })
    ).toEqual({ ok: true, backend: "http" });
    expect(
      resolveNostrPublisherBackend({
        configured: "INTERNAL",
        publisherUrl: "https://publisher.example/publish",
      })
    ).toEqual({ ok: true, backend: "internal" });
  });

  it("rejects an unknown backend instead of guessing", () => {
    const decision = resolveNostrPublisherBackend({
      configured: "cloudflare",
      publisherUrl: undefined,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toContain("http");
      expect(decision.reason).toContain("internal");
    }
  });
});
