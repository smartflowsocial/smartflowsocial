import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPublish } = vi.hoisted(() => ({
  mockPublish: vi.fn(),
}));

vi.mock("~/infra/publishers/nostr-publisher.server", () => ({
  getNostrPublisher: () => ({
    publish: mockPublish,
  }),
}));

vi.mock("~/lib/env.server", () => ({
  env: {
    NOSTR_NSEC: "nsec1test",
    NODE_ENV: "test",
  },
}));

// Avoid pulling in real Redis / ioredis in tests.
vi.mock("~/lib/redis-cache.server", () => ({
  buildCacheKey: vi.fn(() => "key"),
  getOrSetJson: vi.fn(async (input: { compute: () => Promise<unknown> }) => {
    return await input.compute();
  }),
}));

vi.mock("nostr-tools/nip17", () => ({
  wrapManyEvents: vi.fn(() => [
    {
      kind: 1059,
      tags: [["p", "e".repeat(64)]],
      id: "gw-sender",
      content: "c1",
    },
    {
      kind: 1059,
      tags: [["p", "f".repeat(64)]],
      id: "gw-recipient",
      content: "c2",
    },
  ]),
}));

vi.mock("nostr-tools/pure", () => ({
  getPublicKey: vi.fn(() => "e".repeat(64)),
}));

// Mock nostr-tools so the test doesn't do crypto or network.
vi.mock("nostr-tools", () => {
  class MockPool {
    /** When non-empty, `get` returns `shift()` each call; else `nextGetResult`. */
    static sequence: unknown[] = [];
    static nextGetResult: unknown = null;
    get = vi.fn(async () => {
      if (MockPool.sequence.length > 0) {
        const v = MockPool.sequence.shift();
        return v === undefined ? null : v;
      }
      return MockPool.nextGetResult;
    });
    list = vi.fn(async () => []);
    close = vi.fn();
  }
  return {
    nip04: { encrypt: vi.fn(() => "enc") },
    finalizeEvent: vi.fn(() => ({ id: "evt-1", pubkey: "pk", kind: 4 })),
    nip19: {
      decode: vi.fn((v: string) => {
        if (v.startsWith("nsec")) {
          return { type: "nsec", data: new Uint8Array(32) };
        }
        return { type: "npub", data: "f".repeat(64) };
      }),
    },
    SimplePool: MockPool,
  };
});

import { DEFAULT_USER_WRITE_RELAYS } from "~/features/relays/relay-constants";
import { sendNostrDirectMessage } from "~/lib/nostr.messenger.server";

async function setNextPoolGetResult(value: unknown) {
  const mod = await import("nostr-tools");
  const Pool = mod.SimplePool as unknown as {
    nextGetResult: unknown;
    sequence: unknown[];
  };
  Pool.sequence = [];
  Pool.nextGetResult = value;
}

async function setPoolGetSequence(values: unknown[]) {
  const mod = await import("nostr-tools");
  const Pool = mod.SimplePool as unknown as {
    nextGetResult: unknown;
    sequence: unknown[];
  };
  Pool.nextGetResult = null;
  Pool.sequence = [...values];
}

function publishedCall(index: number): {
  event: { id?: string; kind: number };
  relays: string[];
} {
  const call = mockPublish.mock.calls[index] as
    [{ id?: string; kind: number }, string[]] | undefined;
  if (!call) throw new Error("publisher was not called");
  return { event: call[0], relays: call[1] };
}

describe("sendNostrDirectMessage relay targeting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["NOSTR_NSEC"] = "nsec1test";
    mockPublish.mockResolvedValue({
      results: [{ relay: "wss://relay.example", ok: true }],
    });
  });

  it("falls back to DEFAULT_USER_WRITE_RELAYS when no NIP-65 relay list found", async () => {
    await setNextPoolGetResult(null);

    await sendNostrDirectMessage("f".repeat(64), "hello");

    expect([...publishedCall(0).relays].sort()).toEqual(
      [...DEFAULT_USER_WRITE_RELAYS].sort()
    );
  });

  it("uses recipient read/unmarked relays + fallback", async () => {
    await setNextPoolGetResult({
      tags: [
        ["r", "wss://relay.read.example", "read"],
        ["r", "wss://relay.unmarked.example"],
        ["r", "wss://relay.write.example", "write"],
      ],
    });

    await sendNostrDirectMessage("f".repeat(64), "hello");

    const relays = publishedCall(0).relays;

    expect(relays).toContain("wss://relay.read.example");
    expect(relays).toContain("wss://relay.unmarked.example");
    expect(relays).not.toContain("wss://relay.write.example");
    for (const relay of DEFAULT_USER_WRITE_RELAYS) {
      expect(relays).toContain(relay);
    }
  });

  it("when kind 10050 inbox exists, publishes two gift wraps then NIP-04", async () => {
    await setPoolGetSequence([
      { tags: [["relay", "wss://dm.inbox.example"]] },
      null,
      null,
    ]);

    const result = await sendNostrDirectMessage("f".repeat(64), "hello");

    expect(mockPublish).toHaveBeenCalledTimes(3);

    expect(result).not.toEqual(false);
    expect(result).toMatchObject({
      nip17: { attempted: true, recipientPublished: true },
      nip04: { success: true },
    });

    expect(publishedCall(0).event.kind).toBe(1059);
    expect(publishedCall(1).event.kind).toBe(1059);
    expect(publishedCall(2).event.kind).toBe(4);
  });

  it("still publishes NIP-04 when NIP-17 gift wrap publish fails", async () => {
    await setPoolGetSequence([
      { tags: [["relay", "wss://dm.inbox.example"]] },
      null,
      null,
    ]);

    mockPublish.mockImplementation(async (event: { id?: string }) => {
      if (event.id === "gw-recipient") {
        return {
          results: [
            { relay: "wss://relay.example", ok: false, error: "rejected" },
          ],
        };
      }
      return { results: [{ relay: "wss://relay.example", ok: true }] };
    });

    const result = await sendNostrDirectMessage("f".repeat(64), "hello");

    expect(mockPublish.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(result).not.toEqual(false);
    expect(result).toMatchObject({
      success: true,
      nip04: { success: true },
    });
    expect(
      (result as { nip17?: { errors?: string[] } }).nip17?.errors?.length
    ).toBeGreaterThan(0);
  });
});
