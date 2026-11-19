import { describe, expect, it } from "vitest";

import {
  allowsEmptyResult,
  cacheKeyVersion,
  cacheTtlForRequest,
  readCacheKey,
  shouldStoreReadCache,
} from "~/features/cache/cache-policy";
import {
  isCompleteEmpty,
  isSyntheticCacheEvent,
  isUsableCachePayload,
} from "~/features/cache/payload";
import {
  resetSingleFlightForTests,
  singleFlight,
} from "~/features/cache/single-flight";
import { cacheReqFrame, canonicalCacheRequest } from "~/features/cache/wire";

const PUBKEY_A = "a".repeat(64);
const PUBKEY_B = "b".repeat(64);
const EVENT_ID = "c".repeat(64);

describe("cache policy", () => {
  it("keeps the existing TTLs", () => {
    expect(cacheTtlForRequest("thread_view")).toEqual({
      ttlSeconds: 30,
      negativeTtlSeconds: 5,
    });
    expect(cacheTtlForRequest("user_profile").ttlSeconds).toBe(300);
    expect(cacheTtlForRequest("user_infos").ttlSeconds).toBe(300);
    expect(cacheTtlForRequest("event_actions")).toEqual({
      ttlSeconds: 30,
      negativeTtlSeconds: 5,
    });
    expect(cacheTtlForRequest("get_notifications")).toEqual({
      ttlSeconds: 15,
      negativeTtlSeconds: 5,
    });
    expect(cacheTtlForRequest("feed").ttlSeconds).toBeNull();
  });

  it("separates users and request types in the reader cache key", () => {
    const first = readCacheKey({
      requestType: "get_notifications",
      params: { pubkey: PUBKEY_A, limit: 10 },
    });
    const swapped = readCacheKey({
      requestType: "get_notifications",
      params: { limit: 10, pubkey: PUBKEY_A },
    });
    const otherUser = readCacheKey({
      requestType: "get_notifications",
      params: { pubkey: PUBKEY_B, limit: 10 },
    });
    const otherType = readCacheKey({
      requestType: "user_profile",
      params: { pubkey: PUBKEY_A, limit: 10 },
    });
    expect(first).toBe(swapped);
    expect(first).not.toBe(otherUser);
    expect(first).not.toBe(otherType);
    expect(cacheKeyVersion()).toBe("v2");
    expect(first).toContain(":v2:");
  });

  it("does not store a user-scoped page that has no pubkey", () => {
    expect(shouldStoreReadCache("get_notifications", { limit: 10 })).toBe(
      false
    );
    expect(shouldStoreReadCache("user_profile", { pubkey: PUBKEY_A })).toBe(
      true
    );
    expect(allowsEmptyResult("get_notifications")).toBe(true);
    expect(allowsEmptyResult("thread_view")).toBe(false);
  });
});

describe("payload validation", () => {
  it("rejects event actions that are not the requested kind", () => {
    const messages: unknown[] = [
      ["EVENT", "s", { kind: 0, pubkey: PUBKEY_A, content: "{}" }],
      ["EOSE", "s"],
    ];
    expect(
      isUsableCachePayload(
        "event_actions",
        { kind: 7, event_id: EVENT_ID },
        messages
      )
    ).toBe(false);
    messages.unshift(["EVENT", "s", { kind: 7, id: "d".repeat(64) }]);
    expect(
      isUsableCachePayload(
        "event_actions",
        { kind: 7, event_id: EVENT_ID },
        messages
      )
    ).toBe(true);
  });

  it("requires the focal note in a thread and the requested event id", () => {
    const other = "d".repeat(64);
    expect(
      isUsableCachePayload("thread_view", { event_id: EVENT_ID }, [
        ["EVENT", "s", { id: other, kind: 1 }],
        ["EOSE", "s"],
      ])
    ).toBe(false);
    expect(
      isUsableCachePayload("thread_view", { event_id: EVENT_ID }, [
        ["EVENT", "s", { id: EVENT_ID, kind: 1 }],
        ["EOSE", "s"],
      ])
    ).toBe(true);
    expect(
      isUsableCachePayload("events", { event_ids: [EVENT_ID] }, [
        ["EVENT", "s", { id: other, kind: 1 }],
      ])
    ).toBe(false);
  });

  it("requires profile metadata for profile calls and kind 3 for contacts", () => {
    expect(
      isUsableCachePayload("user_profile", { pubkey: PUBKEY_A }, [
        ["EVENT", "s", { kind: 1, pubkey: PUBKEY_A }],
      ])
    ).toBe(false);
    expect(
      isUsableCachePayload("user_profile", { pubkey: PUBKEY_A }, [
        [
          "EVENT",
          "s",
          {
            kind: 10000105,
            content: JSON.stringify({ pubkey: PUBKEY_A }),
            synthetic: true,
          },
        ],
      ])
    ).toBe(true);
    expect(
      isUsableCachePayload("contact_list", { pubkey: PUBKEY_A }, [
        ["EVENT", "s", { kind: 3, pubkey: PUBKEY_A, tags: [["p", PUBKEY_B]] }],
      ])
    ).toBe(true);
    expect(
      isUsableCachePayload("mutelist", { pubkey: PUBKEY_A }, [
        ["EVENT", "s", { kind: 10000, tags: [] }],
      ])
    ).toBe(true);
    expect(isCompleteEmpty([["EOSE", "s"]])).toBe(true);
    expect(isCompleteEmpty([])).toBe(false);
    expect(
      isSyntheticCacheEvent({ kind: 10000100, synthetic: true, sig: "" })
    ).toBe(true);
    expect(isSyntheticCacheEvent({ kind: 1, sig: "abc" })).toBe(false);
  });
});

describe("wire format", () => {
  it("maps reaction aliases onto event_actions and preserves profile params", () => {
    const likes = canonicalCacheRequest("likes", { event_id: EVENT_ID });
    expect(likes?.requestType).toBe("event_actions");
    expect(likes?.params).toMatchObject({
      event_id: EVENT_ID,
      kind: 7,
      limit: 100,
    });
    const zaps = canonicalCacheRequest("zaps", {
      event_id: EVENT_ID,
      limit: 5,
    });
    expect(zaps?.params).toMatchObject({ kind: 9735, limit: 5 });
    const profile = canonicalCacheRequest("user_profile", { pubkey: PUBKEY_A });
    expect(cacheReqFrame("sub", profile!)).toEqual([
      "REQ",
      "sub",
      { cache: ["user_profile", { pubkey: PUBKEY_A }] },
    ]);
    expect(canonicalCacheRequest("net_stats", {})?.cache).toEqual([
      "network_stats",
    ]);
    expect(canonicalCacheRequest("search", { query: "ada" })).toBeNull();
  });

  it("caps follower lookups and defaults notification and mute params", () => {
    expect(
      canonicalCacheRequest("user_followers", { pubkey: PUBKEY_A, limit: 5000 })
        ?.params["limit"]
    ).toBe(1000);
    expect(
      canonicalCacheRequest("get_notifications", { pubkey: PUBKEY_A })?.params
    ).toMatchObject({ pubkey: PUBKEY_A, limit: 100 });
    expect(
      canonicalCacheRequest("mutelist", { pubkey: PUBKEY_A })?.params[
        "extended_response"
      ]
    ).toBe(true);
    expect(
      canonicalCacheRequest("contact_list", { pubkey: PUBKEY_A })?.params[
        "extended_response"
      ]
    ).toBe(false);
  });
});

describe("single flight", () => {
  it("runs one computation for concurrent callers and retries after failure", async () => {
    resetSingleFlightForTests();
    let calls = 0;
    let release: (value: string) => void = () => undefined;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const first = singleFlight("profile", async () => {
      calls += 1;
      return gate;
    });
    const second = singleFlight("profile", async () => {
      calls += 1;
      return "other";
    });
    release("shared");
    await expect(Promise.all([first, second])).resolves.toEqual([
      "shared",
      "shared",
    ]);
    expect(calls).toBe(1);

    await expect(
      singleFlight("profile", async () => {
        throw new Error("upstream down");
      })
    ).rejects.toThrow("upstream down");
    await expect(
      singleFlight("profile", async () => "recovered")
    ).resolves.toBe("recovered");
    resetSingleFlightForTests();
  });
});
