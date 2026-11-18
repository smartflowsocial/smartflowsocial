import { describe, expect, it } from "vitest";

import { resolveNostrPublisherBackend } from "~/infra/publishers/publisher-backend";

describe("resolveNostrPublisherBackend", () => {
  it("keeps an unset hosted install on the HTTP publisher", () => {
    expect(
      resolveNostrPublisherBackend({
        configured: undefined,
        selfHosted: undefined,
      })
    ).toEqual({ ok: true, backend: "http" });
    expect(
      resolveNostrPublisherBackend({ configured: "  ", selfHosted: "false" })
    ).toEqual({ ok: true, backend: "http" });
  });

  it("selects the internal publisher for each accepted self-host flag", () => {
    for (const selfHosted of [
      "true",
      "1",
      "yes",
      "self-hosted",
      "self_hosted",
      " TRUE ",
    ]) {
      expect(
        resolveNostrPublisherBackend({ configured: undefined, selfHosted })
      ).toEqual({ ok: true, backend: "internal" });
    }
  });

  it("lets an explicit backend override the self-host default", () => {
    expect(
      resolveNostrPublisherBackend({
        configured: "http",
        selfHosted: "true",
      })
    ).toEqual({ ok: true, backend: "http" });
    expect(
      resolveNostrPublisherBackend({
        configured: "INTERNAL",
        selfHosted: "false",
      })
    ).toEqual({ ok: true, backend: "internal" });
  });

  it("rejects an unknown backend instead of guessing", () => {
    const decision = resolveNostrPublisherBackend({
      configured: "cloudflare",
      selfHosted: "true",
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toContain("http");
      expect(decision.reason).toContain("internal");
    }
  });
});
