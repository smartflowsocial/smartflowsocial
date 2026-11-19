import { beforeEach, describe, expect, it, vi } from "vitest";

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

const envState = vi.hoisted(() => ({
  BLASTR_ADMIN_URL: "https://blastr.example/admin/",
  BLASTR_ADMIN_API_TOKEN: "token-1",
}));

const logs = vi.hoisted(() => ({
  logError:
    vi.fn<(error: unknown, context?: Record<string, unknown>) => void>(),
}));

const nostr = vi.hoisted(() => ({
  decodeNpub: vi.fn<(value: string) => string | null>(),
}));

vi.mock("~/lib/env.server", () => ({ env: envState }));
vi.mock("~/lib/error-logger.server", () => logs);
vi.mock("~/lib/nostr-adapter.server", () => ({ nostrAdapter: nostr }));

import {
  addPolicyRelay,
  getUserPolicy,
  putUserPolicy,
  removePolicyRelay,
  resolvePubkeyHex,
  syncEntitlement,
} from "~/infra/blastr/blastr-admin.client.server";

const PUBKEY = "ab".repeat(32);
const calls: FetchCall[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function lastCall(): FetchCall {
  const call = calls.at(-1);
  if (!call) throw new Error("missing fetch call");
  return call;
}

describe("blastr admin client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    envState.BLASTR_ADMIN_URL = "https://blastr.example/admin/";
    envState.BLASTR_ADMIN_API_TOKEN = "token-1";
    nostr.decodeNpub.mockImplementation((value) => `decoded:${value}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const headers = init?.headers;
        calls.push({
          url,
          method: init?.method ?? "GET",
          headers:
            headers && typeof headers === "object" && !Array.isArray(headers)
              ? (headers as Record<string, string>)
              : {},
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        return jsonResponse({ ok: true });
      })
    );
  });

  it("resolves hex, npub, and unusable pubkeys", () => {
    expect(resolvePubkeyHex(null as unknown as string)).toBeNull();
    expect(resolvePubkeyHex("")).toBeNull();
    expect(resolvePubkeyHex("ab")).toBeNull();
    expect(resolvePubkeyHex(`  ${"AB".repeat(32)}  `)).toBe(PUBKEY);
    const npub = `npub1${"x".repeat(40)}`;
    nostr.decodeNpub.mockReturnValueOnce("cd".repeat(32));
    expect(resolvePubkeyHex(npub)).toBe("cd".repeat(32));
    expect(nostr.decodeNpub).toHaveBeenCalledWith(npub);
    nostr.decodeNpub.mockReturnValueOnce(null);
    expect(resolvePubkeyHex(`${npub}missing`)).toBe(`${npub}missing`);
  });

  it("no-ops entitlement sync without a base url or a usable pubkey", async () => {
    envState.BLASTR_ADMIN_URL = "   ";
    await syncEntitlement(PUBKEY, "active", "pro");
    envState.BLASTR_ADMIN_URL = "https://blastr.example/admin/";
    await syncEntitlement("short", "expired");
    await syncEntitlement("", "suspended");
    expect(calls).toHaveLength(0);
  });

  it("puts an entitlement and logs failed or thrown responses", async () => {
    await syncEntitlement(PUBKEY, "grace");
    expect(lastCall()).toMatchObject({
      url: `https://blastr.example/admin/admin/entitlements/${PUBKEY}`,
      method: "PUT",
      body: JSON.stringify({ status: "grace", plan_tier: "default" }),
    });
    expect(lastCall().headers["Authorization"]).toBe("Bearer token-1");
    expect(lastCall().headers["X-API-TOKEN"]).toBe("token-1");
    expect(lastCall().headers["Content-Type"]).toBe("application/json");
    expect(logs.logError).not.toHaveBeenCalled();

    envState.BLASTR_ADMIN_API_TOKEN = "  ";
    envState.BLASTR_ADMIN_URL = "https://blastr.example";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          method: init?.method ?? "GET",
          headers: (init?.headers ?? {}) as Record<string, string>,
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        return new Response("nope-".repeat(200), { status: 503 });
      })
    );
    await syncEntitlement(PUBKEY, "suspended", "creator");
    expect(lastCall().url).toBe(
      `https://blastr.example/admin/entitlements/${PUBKEY}`
    );
    expect(lastCall().body).toBe(
      JSON.stringify({ status: "suspended", plan_tier: "creator" })
    );
    expect(lastCall().headers["Authorization"]).toBeUndefined();
    const logged = logs.logError.mock.calls[0]?.[0];
    expect(logged).toBeInstanceOf(Error);
    expect((logged as Error).message).toBe(
      "Blastr entitlement sync failed: 503"
    );
    expect(logs.logError.mock.calls[0]?.[1]).toMatchObject({
      pubkeyLength: 64,
      status: "suspended",
    });
    const responseText = logs.logError.mock.calls[0]?.[1]?.["response"];
    expect(typeof responseText).toBe("string");
    expect((responseText as string).length).toBe(500);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    await syncEntitlement(PUBKEY, "active", "pro");
    expect((logs.logError.mock.calls[1]?.[0] as Error).message).toBe(
      "network down"
    );
    expect(logs.logError.mock.calls[1]?.[1]).toEqual({
      context: "Blastr syncEntitlement",
      pubkeyLength: 64,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "network string";
      })
    );
    await syncEntitlement(PUBKEY, "expired");
    expect((logs.logError.mock.calls[2]?.[0] as Error).message).toBe(
      "network string"
    );
  });

  it("normalizes a user policy response and returns null on failure", async () => {
    envState.BLASTR_ADMIN_URL = undefined;
    await expect(getUserPolicy(PUBKEY)).resolves.toBeNull();
    await expect(getUserPolicy("short")).resolves.toBeNull();

    envState.BLASTR_ADMIN_URL = "https://blastr.example/";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          method: init?.method ?? "GET",
          headers: {},
        });
        return jsonResponse({
          pubkey: "server-key",
          policy: { mode: "whitelist", enabled: 1 },
          relays: [
            { relay_url: "wss://a.example", action: "allow" },
            { relay_url: 12, action: "nope" },
          ],
        });
      })
    );
    await expect(getUserPolicy(` ${PUBKEY} `)).resolves.toEqual({
      pubkey: "server-key",
      policy: { mode: "whitelist", enabled: true },
      relays: [
        { relay_url: "wss://a.example", action: "allow" },
        { relay_url: "", action: "block" },
      ],
    });
    expect(lastCall().url).toBe(
      `https://blastr.example/admin/users/${encodeURIComponent(` ${PUBKEY} `)}/policy`
    );
    expect(lastCall().method).toBe("GET");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          policy: { mode: "blacklist", enabled: 0 },
        })
      )
    );
    await expect(getUserPolicy(PUBKEY)).resolves.toEqual({
      pubkey: PUBKEY,
      policy: { mode: "blacklist", enabled: false },
      relays: [],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ policy: null }))
    );
    await expect(getUserPolicy(PUBKEY)).resolves.toEqual({
      pubkey: PUBKEY,
      policy: null,
      relays: [],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 404 }))
    );
    await expect(getUserPolicy(PUBKEY)).resolves.toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("policy down");
      })
    );
    await expect(getUserPolicy(PUBKEY)).resolves.toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "policy string";
      })
    );
    await expect(getUserPolicy(PUBKEY)).resolves.toBeNull();
  });

  it("puts, adds, and removes policy relays", async () => {
    expect(
      await putUserPolicy("short", { mode: "blacklist", enabled: true })
    ).toBe(false);
    expect(await addPolicyRelay(PUBKEY, "  ", "allow")).toBe(false);
    expect(await removePolicyRelay(PUBKEY, "   ")).toBe(false);
    expect(calls).toHaveLength(0);

    envState.BLASTR_ADMIN_URL = undefined;
    expect(
      await putUserPolicy(PUBKEY, { mode: "whitelist", enabled: false })
    ).toBe(false);
    envState.BLASTR_ADMIN_URL = "https://blastr.example";

    await expect(
      putUserPolicy(PUBKEY, { mode: "whitelist", enabled: false })
    ).resolves.toBe(true);
    expect(lastCall()).toMatchObject({
      method: "PUT",
      url: `https://blastr.example/admin/users/${PUBKEY}/policy`,
      body: JSON.stringify({ mode: "whitelist", enabled: false }),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 500 }))
    );
    await expect(
      putUserPolicy(PUBKEY, { mode: "blacklist", enabled: true })
    ).resolves.toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "put string";
      })
    );
    await expect(
      putUserPolicy(PUBKEY, { mode: "blacklist", enabled: true })
    ).resolves.toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          method: init?.method ?? "GET",
          headers: {},
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        return new Response(null, { status: 201 });
      })
    );
    await expect(
      addPolicyRelay(PUBKEY, "  wss://relay.example/path  ", "block")
    ).resolves.toBe(true);
    expect(lastCall()).toMatchObject({
      method: "POST",
      url: `https://blastr.example/admin/users/${PUBKEY}/relays`,
      body: JSON.stringify({
        relay_url: "wss://relay.example/path",
        action: "block",
      }),
    });
    await expect(
      removePolicyRelay(PUBKEY, " wss://relay.example/a b ")
    ).resolves.toBe(true);
    expect(lastCall().method).toBe("DELETE");
    expect(lastCall().url).toBe(
      `https://blastr.example/admin/users/${PUBKEY}/relays?relay_url=${encodeURIComponent("wss://relay.example/a b")}`
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("relay down");
      })
    );
    await expect(
      addPolicyRelay(PUBKEY, "wss://relay.example", "allow")
    ).resolves.toBe(false);
    await expect(
      removePolicyRelay(PUBKEY, "wss://relay.example")
    ).resolves.toBe(false);
  });

  it("prefixes a relative admin path", async () => {
    envState.BLASTR_ADMIN_URL = "https://blastr.example/root";
    await getUserPolicy(PUBKEY);
    expect(lastCall().url).toBe(
      `https://blastr.example/root/admin/users/${PUBKEY}/policy`
    );
  });
});
