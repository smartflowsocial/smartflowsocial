import { describe, expect, it, vi } from "vitest";

import type { SocketAttempt } from "~/features/cache/cache-socket.server";
import {
  NostrReadError,
  readNostrUpstreams,
  type ReadUpstreamDeps,
} from "~/features/cache/read-service.server";

const PUBKEY = "a".repeat(64);
const EVENT_ID = "b".repeat(64);

function deps(overrides: Partial<ReadUpstreamDeps> = {}): ReadUpstreamDeps {
  return {
    now: () => 0,
    budgetMs: 15_000,
    connectTimeoutMs: 3_000,
    responseTimeoutMs: 5_000,
    queryNative: vi.fn(async () => null),
    querySocket: vi.fn(async (): Promise<SocketAttempt> => ({
      ok: false,
      failure: "unavailable",
      detail: "down",
    })),
    nostrmashWsUrl: "wss://api.nostrmash.com/primal/ws/v1",
    primalEndpoints: [
      "wss://cache1.primal.net/v1",
      "wss://cache2.primal.net/v1",
    ],
    ...overrides,
  };
}

function page(event: Record<string, unknown>): unknown[] {
  return [
    ["EVENT", "sub", event],
    ["EOSE", "sub"],
  ];
}

describe("readNostrUpstreams", () => {
  it("returns a usable NostrMash HTTP profile without opening a socket", async () => {
    const profile = page({
      kind: 0,
      pubkey: PUBKEY,
      content: JSON.stringify({ name: "ada" }),
    });
    const querySocket = vi.fn();
    const result = await readNostrUpstreams(
      "user_profile",
      { pubkey: PUBKEY },
      deps({
        queryNative: async () => profile,
        querySocket,
      })
    );
    expect(result).toMatchObject({ source: "nostrmash-native", empty: false });
    expect(result.messages).toEqual(profile);
    expect(querySocket).not.toHaveBeenCalled();
  });

  it("falls through an invalid native page to the NostrMash socket", async () => {
    const good = page({ kind: 0, pubkey: PUBKEY, content: "{}" });
    const querySocket = vi.fn(async (): Promise<SocketAttempt> => ({
      ok: true,
      messages: good,
    }));
    const result = await readNostrUpstreams(
      "user_profile",
      { pubkey: PUBKEY },
      deps({
        queryNative: async () =>
          page({ kind: 1, pubkey: PUBKEY, content: "no" }),
        querySocket,
      })
    );
    expect(result.source).toBe("nostrmash-ws");
    expect(querySocket).toHaveBeenCalledTimes(1);
  });

  it("uses Primal after the NostrMash socket times out", async () => {
    const good = page({ id: EVENT_ID, kind: 1, content: "note" });
    const querySocket = vi.fn(
      async (endpoint: string): Promise<SocketAttempt> => {
        if (endpoint.includes("nostrmash")) {
          return { ok: false, failure: "response_timeout", detail: "slow" };
        }
        return { ok: true, messages: good };
      }
    );
    const result = await readNostrUpstreams(
      "events",
      { event_ids: [EVENT_ID] },
      deps({ querySocket })
    );
    expect(result.source).toBe("primal");
    expect(result.messages[0]).toEqual(good[0]);
    expect(querySocket).toHaveBeenCalledTimes(2);
  });

  it("rejects NostrMash profile metadata for event_actions and keeps the reaction", async () => {
    const reaction = page({
      kind: 7,
      id: "d".repeat(64),
      tags: [["e", EVENT_ID]],
    });
    const querySocket = vi.fn(
      async (endpoint: string): Promise<SocketAttempt> => {
        if (endpoint.includes("nostrmash")) {
          return {
            ok: true,
            messages: page({ kind: 0, pubkey: PUBKEY, content: "{}" }),
          };
        }
        return { ok: true, messages: reaction };
      }
    );
    const result = await readNostrUpstreams(
      "likes",
      { event_id: EVENT_ID },
      deps({ querySocket })
    );
    expect(result.source).toBe("primal");
    expect(querySocket).toHaveBeenCalledWith(
      expect.any(String),
      "event_actions",
      expect.objectContaining({ kind: 7, event_id: EVENT_ID }),
      expect.any(Object)
    );
    const event = result.messages[0];
    expect(Array.isArray(event) && (event[2] as { kind: number }).kind).toBe(7);
  });

  it("returns a finished empty notification page after every socket is empty", async () => {
    const empty: SocketAttempt = {
      ok: false,
      failure: "empty",
      detail: "EOSE with no events",
      messages: [["EOSE", "sub"]],
    };
    const result = await readNostrUpstreams(
      "get_notifications",
      { pubkey: PUBKEY },
      deps({ querySocket: async () => empty })
    );
    expect(result.empty).toBe(true);
    expect(result.messages).toEqual([["EOSE", "sub"]]);
  });

  it("does not turn an empty thread into a successful page", async () => {
    const empty: SocketAttempt = {
      ok: false,
      failure: "empty",
      detail: "EOSE with no events",
      messages: [["EOSE", "sub"]],
    };
    await expect(
      readNostrUpstreams(
        "thread_view",
        { event_id: EVENT_ID },
        deps({ querySocket: async () => empty })
      )
    ).rejects.toBeInstanceOf(NostrReadError);
  });

  it("throws when every upstream is unavailable", async () => {
    try {
      await readNostrUpstreams("user_infos", { pubkeys: [PUBKEY] }, deps());
      throw new Error("expected the read to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NostrReadError);
      const sources = (error as NostrReadError).failures.map(
        (failure) => failure.source
      );
      expect(sources).toEqual(
        expect.arrayContaining(["nostrmash-native", "nostrmash-ws", "primal"])
      );
    }
  });

  it("continues after a native exception and a partial socket", async () => {
    const good = page({ id: EVENT_ID, kind: 1 });
    let sockets = 0;
    const result = await readNostrUpstreams(
      "events",
      { event_ids: [EVENT_ID] },
      deps({
        queryNative: async () => {
          throw new Error("native down");
        },
        querySocket: async (): Promise<SocketAttempt> => {
          sockets += 1;
          if (sockets === 1) {
            return { ok: false, failure: "partial", detail: "closed" };
          }
          return { ok: true, messages: good };
        },
      })
    );
    expect(result.source).toBe("primal");
  });

  it("stops before Primal when the budget is already gone", async () => {
    const querySocket = vi.fn();
    await expect(
      readNostrUpstreams(
        "events",
        { event_ids: [EVENT_ID] },
        deps({ budgetMs: 0, querySocket })
      )
    ).rejects.toBeInstanceOf(NostrReadError);
    expect(querySocket).not.toHaveBeenCalled();
  });

  it("rejects an unused request type", async () => {
    await expect(
      readNostrUpstreams("search", { query: "ada" }, deps())
    ).rejects.toMatchObject({
      failures: [{ source: "primal", failure: "unsupported" }],
    });
  });

  it("keeps a valid empty page when a later socket fails", async () => {
    let calls = 0;
    const result = await readNostrUpstreams(
      "contact_list",
      { pubkey: PUBKEY },
      deps({
        querySocket: async (): Promise<SocketAttempt> => {
          calls += 1;
          if (calls === 1) {
            return {
              ok: false,
              failure: "empty",
              detail: "none",
              messages: [["EOSE", "sub"]],
            };
          }
          return { ok: false, failure: "unavailable", detail: "down" };
        },
      })
    );
    expect(result.empty).toBe(true);
    expect(result.source).toBe("nostrmash-ws");
  });
});
