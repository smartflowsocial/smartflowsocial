/**
 * The in-process reader is the only cache path.
 * HTTP retries against an external cache worker are not part of this app.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());

vi.mock("~/lib/error-logger.server", () => ({
  logError: vi.fn(),
  logWarning: vi.fn(),
}));

vi.mock("~/lib/redis-cache.server", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getOrSetJson: vi.fn(async <T>(opts: { compute: () => Promise<T> }) =>
      opts.compute()
    ),
  };
});

vi.mock("~/features/cache/read-service.server", () => ({
  readNostrUpstreamsFromEnv: read,
}));

import {
  connectToPrimalCache,
  fetchFromCache,
} from "~/features/cache/primalCache.server";
import { resetSingleFlightForTests } from "~/features/cache/single-flight";
import { logError } from "~/lib/error-logger.server";

const PAGE = [
  ["EVENT", "sub", { id: "event-123", kind: 1 }],
  ["EOSE", "sub"],
];

describe("in-process Nostr read cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSingleFlightForTests();
    read.mockResolvedValue({
      messages: PAGE,
      source: "nostrmash-native",
      empty: false,
    });
  });

  it("returns the in-process reader page", async () => {
    await expect(
      fetchFromCache("thread_view", { event_id: "event-123" })
    ).resolves.toEqual(PAGE);
    expect(read).toHaveBeenCalledWith("thread_view", { event_id: "event-123" });
  });

  it("returns a page that contains events", async () => {
    await expect(
      connectToPrimalCache("thread_view", { event_id: "event-123" })
    ).resolves.toEqual(PAGE);
    expect(logError).not.toHaveBeenCalled();
  });

  it("rejects an empty thread page", async () => {
    read.mockResolvedValue({
      messages: [["EOSE", "sub"]],
      source: "primal",
      empty: true,
    });
    await expect(
      connectToPrimalCache("thread_view", { event_id: "event-123" })
    ).rejects.toThrow("Primal cache gave empty response.");
    expect(logError).toHaveBeenCalled();
  });

  it("keeps a valid empty notification page", async () => {
    read.mockResolvedValue({
      messages: [["EOSE", "sub"]],
      source: "primal",
      empty: true,
    });
    await expect(
      connectToPrimalCache("get_notifications", { pubkey: "ab".repeat(32) })
    ).resolves.toEqual([["EOSE", "sub"]]);
  });

  it("logs and rethrows a reader failure", async () => {
    read.mockRejectedValue(new Error("upstream down"));
    await expect(
      fetchFromCache("thread_view", { event_id: "event-123" })
    ).rejects.toThrow("upstream down");
    expect(logError).toHaveBeenCalled();
  });
});
