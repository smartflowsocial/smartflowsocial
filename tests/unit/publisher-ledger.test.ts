import { describe, expect, it } from "vitest";

import {
  createMemoryPublishLedger,
  createRedisPublishLedger,
  type PublishLedgerRedis,
} from "~/infra/publishers/publisher-ledger";

function redisDouble(status: string): PublishLedgerRedis & {
  gets: number;
  sets: Array<{ key: string; ttl: number }>;
} {
  const sets: Array<{ key: string; ttl: number }> = [];
  const stored = new Map<string, string>();
  return {
    status,
    gets: 0,
    sets,
    async get(key: string) {
      this.gets += 1;
      return stored.get(key) ?? null;
    },
    async set(key, value, _mode, ttl) {
      stored.set(key, value);
      sets.push({ key, ttl });
      return "OK";
    },
  };
}

describe("publish confirmation ledger", () => {
  it("remembers an acknowledgement for one relay only", async () => {
    const ledger = createMemoryPublishLedger();
    expect(await ledger.confirmed("event", "wss://a.example")).toBe(false);
    await ledger.markConfirmed("event", "wss://a.example");
    expect(await ledger.confirmed("event", "wss://a.example")).toBe(true);
    expect(await ledger.confirmed("event", "wss://b.example")).toBe(false);
    expect(ledger.size()).toBe(1);
  });

  it("does not consult Redis when the client is down", async () => {
    const client = redisDouble("end");
    const ledger = createRedisPublishLedger(client);
    expect(await ledger.confirmed("event", "wss://a.example")).toBe(false);
    await ledger.markConfirmed("event", "wss://a.example");
    expect(client.gets).toBe(0);
    expect(client.sets).toEqual([]);
    expect(await ledger.confirmed("event", "wss://a.example")).toBe(true);
  });

  it("opens a lazy Redis client on first use and records the acknowledgement", async () => {
    const client = redisDouble("wait");
    let connects = 0;
    client.connect = async () => {
      connects += 1;
      client.status = "ready";
    };
    const ledger = createRedisPublishLedger(client, { ttlSeconds: 60 });
    await Promise.all([
      ledger.markConfirmed("event", "wss://a.example"),
      ledger.markConfirmed("event", "wss://b.example"),
    ]);
    expect(connects).toBe(1);
    expect(client.sets.map((entry) => entry.key).sort()).toEqual([
      "nostr-publish:v1:event:wss://a.example",
      "nostr-publish:v1:event:wss://b.example",
    ]);
  });

  it("fails open when a lazy Redis client cannot connect", async () => {
    const errors: unknown[] = [];
    const client = redisDouble("wait");
    client.connect = async () => {
      client.status = "end";
      throw new Error("connection refused");
    };
    const ledger = createRedisPublishLedger(client, {
      onError: (error) => errors.push(error),
    });
    expect(await ledger.confirmed("event", "wss://a.example")).toBe(false);
    await expect(
      ledger.markConfirmed("event", "wss://a.example")
    ).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(client.gets).toBe(0);
    expect(client.sets).toEqual([]);
    expect(await ledger.confirmed("event", "wss://a.example")).toBe(true);
  });

  it("fails open when Redis commands throw", async () => {
    const errors: unknown[] = [];
    const client: PublishLedgerRedis = {
      status: "ready",
      get: async () => {
        throw new Error("redis down");
      },
      set: async () => {
        throw new Error("redis down");
      },
    };
    const ledger = createRedisPublishLedger(client, {
      onError: (error) => errors.push(error),
    });
    expect(await ledger.confirmed("event", "wss://a.example")).toBe(false);
    await expect(
      ledger.markConfirmed("event", "wss://a.example")
    ).resolves.toBeUndefined();
    expect(errors).toHaveLength(2);
    expect(await ledger.confirmed("event", "wss://a.example")).toBe(true);
  });

  it("stores a positive acknowledgement with a bounded TTL", async () => {
    const client = redisDouble("ready");
    const ledger = createRedisPublishLedger(client, { ttlSeconds: 60 });
    await ledger.markConfirmed("abc", "wss://relay.example");
    expect(client.sets).toEqual([
      {
        key: "nostr-publish:v1:abc:wss://relay.example",
        ttl: 60,
      },
    ]);
    expect(await ledger.confirmed("abc", "wss://relay.example")).toBe(true);
  });
});
