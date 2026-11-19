import { beforeEach, describe, expect, it, vi } from "vitest";

interface InternalOptions {
  allowPrivateRelays?: boolean;
}

const envState = vi.hoisted(() => ({
  NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS: undefined as string | undefined,
}));

const internal = vi.hoisted(() => ({
  options: [] as InternalOptions[],
}));

const logger = vi.hoisted(() => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
}));

vi.mock("~/infra/publishers/internal-nostr-publisher.server", () => ({
  InternalNostrPublisher: class InternalNostrPublisher {
    constructor(options: InternalOptions) {
      internal.options.push(options);
    }
  },
}));
vi.mock("~/lib/env.server", () => ({ env: envState }));
vi.mock("~/lib/error-logger.server", () => logger);

import {
  getNostrPublisher,
  resetNostrPublisherForTests,
  setNostrPublisher,
} from "~/infra/publishers/nostr-publisher.server";

describe("getNostrPublisher", () => {
  beforeEach(() => {
    resetNostrPublisherForTests();
    envState.NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS = undefined;
    internal.options.length = 0;
    logger.logInfo.mockClear();
    logger.logWarning.mockClear();
  });

  it("always constructs the internal publisher and caches it", () => {
    const first = getNostrPublisher();
    expect(getNostrPublisher()).toBe(first);
    expect(internal.options).toEqual([{ allowPrivateRelays: false }]);
    expect(logger.logInfo).toHaveBeenCalledTimes(1);
    expect(logger.logInfo.mock.calls[0]?.[1]).toEqual({
      publisherBackend: "internal",
    });
  });

  it("warns when private relays are explicitly allowed", () => {
    envState.NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS = "true";
    getNostrPublisher();
    expect(internal.options).toEqual([{ allowPrivateRelays: true }]);
    expect(
      logger.logWarning.mock.calls.some((call) =>
        String(call[0]).includes("ALLOW_PRIVATE_RELAYS")
      )
    ).toBe(true);
  });

  it("lets a test replace the publisher", () => {
    const custom = {
      publish: vi.fn(async () => ({ results: [] })),
    };
    setNostrPublisher(custom);
    expect(getNostrPublisher()).toBe(custom);
    resetNostrPublisherForTests();
    expect(getNostrPublisher()).not.toBe(custom);
  });
});
