import { beforeEach, describe, expect, it, vi } from "vitest";

const { redisMock } = vi.hoisted(() => ({
  redisMock: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock("~/lib/env.server", () => ({
  env: { NODE_ENV: "production" },
}));
vi.mock("~/lib/error-logger.server", () => ({
  logWarning: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));
vi.mock("~/infra/queue", () => ({ redis: redisMock }));

import { getOrSetJson } from "~/lib/redis-cache.server";

describe("getOrSetJson when Redis is down", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the computed value when the cache get throws", async () => {
    redisMock.get.mockRejectedValue(new Error("connection refused"));
    redisMock.set.mockResolvedValue("OK");
    await expect(
      getOrSetJson({
        cache: "primal",
        key: "smartflow:primal:v2:test",
        ttlSeconds: 30,
        compute: async () => ["fresh"],
      })
    ).resolves.toEqual(["fresh"]);
    expect(redisMock.set).toHaveBeenCalled();
  });

  it("returns the computed value when the cache set throws", async () => {
    redisMock.get.mockResolvedValue(null);
    redisMock.set.mockRejectedValue(new Error("OOM"));
    await expect(
      getOrSetJson({
        cache: "primal",
        key: "smartflow:primal:v2:set",
        ttlSeconds: 30,
        negativeTtlSeconds: 5,
        shouldNegativeCache: (value) =>
          Array.isArray(value) && value.length === 0,
        compute: async () => [],
      })
    ).resolves.toEqual([]);
  });

  it("reports a negative hit for an empty cached page", async () => {
    redisMock.get.mockResolvedValue(JSON.stringify([["EOSE", "sub"]]));
    const seen: string[] = [];
    const value = await getOrSetJson<unknown[]>({
      cache: "primal",
      key: "smartflow:primal:v2:neg",
      ttlSeconds: 30,
      negativeTtlSeconds: 5,
      shouldNegativeCache: (page) =>
        page.every((row) => Array.isArray(row) && row[0] === "EOSE"),
      observe: (event) => seen.push(event),
      compute: async () => {
        throw new Error("should not compute");
      },
    });
    expect(value).toEqual([["EOSE", "sub"]]);
    expect(seen).toEqual(["negative"]);
  });
});
