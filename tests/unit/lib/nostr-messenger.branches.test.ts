import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface CacheInput {
  cache: string;
  compute: () => Promise<unknown>;
  key: string;
  parts?: unknown;
  shouldNegativeCache?: (value: unknown) => boolean;
}

interface CacheState {
  failCache: string;
  failWith: unknown;
  negativeChecks: boolean[];
}

interface MessengerEnv {
  NOSTR_NSEC: string | undefined;
}

interface PoolGet {
  (relays: string[], filter: unknown): Promise<unknown>;
}

interface PoolState {
  closeCalls: number;
  closeError: unknown;
  getCalls: number;
  getError: unknown;
  getImpl: PoolGet | null;
  getResult: unknown;
  hangGet: boolean;
  hasClose: boolean;
  hasGet: boolean;
  hasList: boolean;
  listCalls: number;
  listError: unknown;
  listResult: unknown;
}

const cacheState = vi.hoisted(() => {
  const state: CacheState = {
    failCache: "",
    failWith: null,
    negativeChecks: [],
  };
  return state;
});

const cache = vi.hoisted(() => ({
  buildCacheKey: vi.fn(
    (input: {
      namespace: string;
      parts: Record<string, string>;
      version: string;
    }) =>
      `${input.namespace}:${input.parts["pubkeyHex"] ?? input.parts["receiverHex"] ?? ""}`
  ),
  getOrSetJson: vi.fn(async (input: CacheInput) => {
    if (cacheState.failCache && cacheState.failCache === input.cache) {
      const error: unknown = cacheState.failWith;
      throw error;
    }
    const value: unknown = await input.compute();
    if (input.shouldNegativeCache) {
      cacheState.negativeChecks.push(input.shouldNegativeCache(value));
    }
    return value;
  }),
}));

const conversion = vi.hoisted(() => ({
  convertToHex: vi.fn<(value: string) => string | null>(() => null),
}));

const envState = vi.hoisted(() => {
  const state: MessengerEnv = { NOSTR_NSEC: "11".repeat(32) };
  return state;
});

const flags = vi.hoisted(() => ({
  nostrDmNip17Enabled: true,
}));

const logger = vi.hoisted(() => ({
  logError: vi.fn(),
  logWarning: vi.fn(),
}));

const nip17 = vi.hoisted(() => ({
  wrapManyEvents: vi.fn<
    (key: Uint8Array, receivers: unknown[], content: string) => unknown[]
  >(() => []),
}));

const poolState = vi.hoisted(() => {
  const state: PoolState = {
    closeCalls: 0,
    closeError: null,
    getCalls: 0,
    getError: null,
    getImpl: null,
    getResult: null,
    hangGet: false,
    hasClose: true,
    hasGet: true,
    hasList: false,
    listCalls: 0,
    listError: null,
    listResult: [],
  };
  return state;
});

const publisher = vi.hoisted(() => ({
  publish: vi.fn<
    (
      event: { id?: string; kind?: number; tags?: unknown },
      relays: string[]
    ) => Promise<{
      results: Array<{ error?: string; ok: boolean; relay: string }>;
    }>
  >(async () => ({
    results: [{ ok: true, relay: "wss://relay.example.com", error: undefined }],
  })),
}));

const pure = vi.hoisted(() => ({
  getPublicKey: vi.fn(() => "ab".repeat(32)),
}));

const tools = vi.hoisted(() => ({
  encrypt: vi.fn(() => "encrypted"),
  finalizeEvent: vi.fn(
    (template: {
      content: string;
      created_at: number;
      kind: number;
      tags: string[][];
    }) => ({
      id: "signed-1",
      pubkey: "pk",
      sig: "sig",
      ...template,
    })
  ),
  decode: vi.fn((value: string) => {
    if (value === "nsec-throws") throw new Error("bad nsec");
    if (value === "nsec-string") throw "bad nsec";
    if (value === "nsec-wrong") return { type: "npub", data: "zz" };
    if (value === "nsec-empty") return { type: "nsec", data: new Uint8Array() };
    if (value.startsWith("nsec")) {
      return { type: "nsec", data: Uint8Array.from({ length: 32 }, () => 7) };
    }
    return { type: "npub", data: "cd".repeat(32) };
  }),
}));

vi.mock("~/lib/websocket-polyfill.server", () => ({
  ensureServerWebSocket: () => undefined,
}));
vi.mock("~/lib/env.server", () => ({ env: envState }));
vi.mock("~/lib/error-logger.server", () => logger);
vi.mock("~/lib/feature-flags.server", () => ({ featureFlags: flags }));
vi.mock("~/lib/nostr-conversion", () => conversion);
vi.mock("~/lib/redis-cache.server", () => cache);
vi.mock("~/infra/publishers/nostr-publisher.server", () => ({
  getNostrPublisher: () => publisher,
}));
vi.mock("nostr-tools/nip17", () => nip17);
vi.mock("nostr-tools/pure", () => pure);
vi.mock("nostr-tools", () => ({
  SimplePool: class SimplePool {
    get?: (relays: string[], filter: unknown) => Promise<unknown>;
    list?: (relays: string[], filters: unknown[]) => Promise<unknown>;
    close?: () => void;
    constructor() {
      if (poolState.hasGet) {
        this.get = async (relays, filter) => {
          poolState.getCalls += 1;
          if (poolState.hangGet) {
            return await new Promise(() => undefined);
          }
          if (poolState.getError) throw poolState.getError;
          if (poolState.getImpl) return poolState.getImpl(relays, filter);
          return poolState.getResult;
        };
      }
      if (poolState.hasList) {
        this.list = async () => {
          poolState.listCalls += 1;
          if (poolState.listError) throw poolState.listError;
          return poolState.listResult;
        };
      }
      if (poolState.hasClose) {
        this.close = () => {
          poolState.closeCalls += 1;
          if (poolState.closeError) throw poolState.closeError;
        };
      }
    }
  },
  finalizeEvent: tools.finalizeEvent,
  nip04: { encrypt: tools.encrypt },
  nip19: { decode: tools.decode },
}));

import { DEFAULT_USER_WRITE_RELAYS } from "~/features/relays/relay-constants";
import {
  giftWrapRecipientPubkeyHex,
  relaysForNip17GiftWrap,
  resolveCachedKind10050InboxRelays,
  resolveDmRelaysSafe,
  sendNostrDirectMessage,
} from "~/lib/nostr.messenger.server";

const RECEIVER = "cd".repeat(32);
const SENDER = "ab".repeat(32);

function relay(index: number): string {
  return `wss://r${index}.example.com`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function kindOf(filter: unknown): number | null {
  if (!isRecord(filter)) return null;
  const kinds = filter["kinds"];
  if (!Array.isArray(kinds)) return null;
  const kind: unknown = kinds[0];
  return typeof kind === "number" ? kind : null;
}

function resetPool(): void {
  poolState.closeCalls = 0;
  poolState.closeError = null;
  poolState.getCalls = 0;
  poolState.getError = null;
  poolState.getImpl = null;
  poolState.getResult = null;
  poolState.hangGet = false;
  poolState.hasClose = true;
  poolState.hasGet = true;
  poolState.hasList = false;
  poolState.listCalls = 0;
  poolState.listError = null;
  poolState.listResult = [];
}

function inboxEvent(urls: string[]): { tags: string[][] } {
  return { tags: urls.map((url) => ["relay", url]) };
}

function listEvent(urls: string[], marker = "read"): { tags: unknown[] } {
  return {
    tags: urls.map((url) => ["r", url, marker]),
  };
}

describe("nostr messenger branches", () => {
  beforeEach(() => {
    resetPool();
    cacheState.failCache = "";
    cacheState.failWith = null;
    cacheState.negativeChecks = [];
    flags.nostrDmNip17Enabled = true;
    envState.NOSTR_NSEC = "11".repeat(32);
    conversion.convertToHex.mockReset();
    conversion.convertToHex.mockReturnValue(null);
    publisher.publish.mockReset();
    publisher.publish.mockResolvedValue({
      results: [{ ok: true, relay: relay(0) }],
    });
    nip17.wrapManyEvents.mockReset();
    nip17.wrapManyEvents.mockReturnValue([]);
    tools.encrypt.mockReset();
    tools.encrypt.mockReturnValue("encrypted");
    tools.finalizeEvent.mockClear();
    logger.logError.mockReset();
    logger.logWarning.mockReset();
    cache.buildCacheKey.mockClear();
    cache.getOrSetJson.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses gift-wrap p tags", () => {
    expect(giftWrapRecipientPubkeyHex({})).toBeNull();
    expect(giftWrapRecipientPubkeyHex({ tags: "nope" })).toBeNull();
    expect(
      giftWrapRecipientPubkeyHex({
        tags: ["r", ["p", "short"], ["p", `  ${RECEIVER.toUpperCase()}  `]],
      })
    ).toBe(RECEIVER);
    expect(giftWrapRecipientPubkeyHex({ tags: [["e", RECEIVER]] })).toBeNull();
  });

  it("resolves kind 10050 inboxes and negative-caches an empty list", async () => {
    expect(await resolveCachedKind10050InboxRelays("short")).toEqual([]);
    expect(cache.getOrSetJson).not.toHaveBeenCalled();

    const urls = Array.from({ length: 9 }, (_item, index) => relay(index));
    poolState.getResult = inboxEvent([
      ...urls,
      "http://bad.example",
      "wss://",
      "",
    ]);
    await expect(
      resolveCachedKind10050InboxRelays(RECEIVER.toUpperCase())
    ).resolves.toEqual(urls.slice(0, 8));
    expect(cache.buildCacheKey).toHaveBeenCalledWith({
      namespace: "dm-inbox-10050",
      version: "v1",
      parts: { pubkeyHex: RECEIVER },
    });
    expect(cacheState.negativeChecks).toEqual([false]);
    expect(poolState.closeCalls).toBe(1);

    poolState.getResult = { tags: "nope" };
    cacheState.negativeChecks = [];
    await expect(resolveCachedKind10050InboxRelays(RECEIVER)).resolves.toEqual(
      []
    );
    expect(cacheState.negativeChecks).toEqual([true]);
  });

  it("reads inbox relays through list, timeout, and pool failures", async () => {
    poolState.hasGet = false;
    poolState.hasList = true;
    poolState.listResult = [inboxEvent([relay(1)])];
    await expect(resolveCachedKind10050InboxRelays(RECEIVER)).resolves.toEqual([
      relay(1),
    ]);
    expect(poolState.listCalls).toBe(1);

    poolState.listResult = [];
    await expect(resolveCachedKind10050InboxRelays(RECEIVER)).resolves.toEqual(
      []
    );
    poolState.listResult = "not-an-array";
    await expect(resolveCachedKind10050InboxRelays(RECEIVER)).resolves.toEqual(
      []
    );

    poolState.hasGet = false;
    poolState.hasList = false;
    await expect(resolveCachedKind10050InboxRelays(RECEIVER)).resolves.toEqual(
      []
    );

    poolState.hasGet = true;
    poolState.getResult = [];
    await expect(resolveCachedKind10050InboxRelays(RECEIVER)).resolves.toEqual(
      []
    );

    poolState.getError = new Error("pool down");
    await expect(resolveCachedKind10050InboxRelays(RECEIVER)).resolves.toEqual(
      []
    );
    expect(String(logger.logWarning.mock.calls.at(-1)?.[0])).toContain("10050");
    const warned: unknown = logger.logWarning.mock.calls.at(-1)?.[1];
    expect(isRecord(warned) ? warned["error"] : "").toBe("pool down");

    poolState.getError = "pool string";
    await expect(resolveCachedKind10050InboxRelays(RECEIVER)).resolves.toEqual(
      []
    );
    const stringWarned: unknown = logger.logWarning.mock.calls.at(-1)?.[1];
    expect(isRecord(stringWarned) ? stringWarned["error"] : "").toBe(
      "pool string"
    );

    poolState.getError = null;
    poolState.closeError = new Error("close");
    poolState.getResult = inboxEvent([relay(2)]);
    await expect(resolveCachedKind10050InboxRelays(RECEIVER)).resolves.toEqual([
      relay(2),
    ]);

    poolState.hasClose = false;
    poolState.closeError = null;
    await expect(resolveCachedKind10050InboxRelays(RECEIVER)).resolves.toEqual([
      relay(2),
    ]);

    vi.useFakeTimers();
    poolState.hangGet = true;
    const pending = resolveCachedKind10050InboxRelays(RECEIVER);
    await vi.advanceTimersByTimeAsync(2500);
    await expect(pending).resolves.toEqual([]);
  });

  it("merges DM target relays and falls back when lookup throws", async () => {
    expect(await resolveDmRelaysSafe("not-hex")).toEqual(
      DEFAULT_USER_WRITE_RELAYS
    );
    expect(cache.getOrSetJson).not.toHaveBeenCalled();

    const reads = Array.from({ length: 10 }, (_item, index) => relay(index));
    poolState.getResult = {
      tags: [
        ...reads.map((url) => ["r", url, "read"]),
        ["r", "wss://write-only.example.com", "WRITE"],
        ["r", relay(20)],
        ["r", "http://bad.example", "read"],
        ["r", ""],
        ["p", relay(21)],
        "skip",
        ["r", 5, "read"],
      ],
    };
    const merged = await resolveDmRelaysSafe(RECEIVER.toUpperCase());
    expect(merged).toHaveLength(12);
    expect(merged[0]).toBe(relay(0));
    expect(merged).toContain(DEFAULT_USER_WRITE_RELAYS[0]);
    expect(merged).not.toContain("wss://write-only.example.com");
    expect(cache.buildCacheKey).toHaveBeenCalledWith({
      namespace: "dm-relays",
      version: "v1",
      parts: { receiverHex: RECEIVER.toUpperCase() },
    });

    poolState.getResult = null;
    const fallback = await resolveDmRelaysSafe(RECEIVER);
    expect(fallback).toEqual(DEFAULT_USER_WRITE_RELAYS);

    cacheState.failCache = "dm-relays";
    cacheState.failWith = new Error("cache down");
    await expect(resolveDmRelaysSafe(RECEIVER)).resolves.toEqual(
      DEFAULT_USER_WRITE_RELAYS
    );
    cacheState.failWith = "cache string";
    await expect(resolveDmRelaysSafe(RECEIVER)).resolves.toEqual(
      DEFAULT_USER_WRITE_RELAYS
    );
    const logged: unknown = logger.logWarning.mock.calls.at(-1)?.[1];
    expect(isRecord(logged) ? logged["error"] : "").toBe("cache string");
  });

  it("chooses gift-wrap relays for the recipient, sender, or anyone else", async () => {
    expect(
      await relaysForNip17GiftWrap({
        giftWrapPTag: RECEIVER.toUpperCase(),
        receiverHexLower: RECEIVER,
        recipientInboxRelays: [],
        senderHexLower: SENDER,
      })
    ).toEqual([]);

    const inboxes = Array.from({ length: 10 }, (_item, index) => relay(index));
    const recipientRelays = await relaysForNip17GiftWrap({
      giftWrapPTag: RECEIVER,
      receiverHexLower: RECEIVER,
      recipientInboxRelays: inboxes,
      senderHexLower: SENDER,
    });
    expect(recipientRelays).toHaveLength(12);
    expect(recipientRelays.slice(0, 10)).toEqual(inboxes);

    poolState.getResult = inboxEvent([relay(30), relay(31)]);
    const senderRelays = await relaysForNip17GiftWrap({
      giftWrapPTag: SENDER,
      receiverHexLower: RECEIVER,
      recipientInboxRelays: inboxes,
      senderHexLower: SENDER,
    });
    expect(senderRelays[0]).toBe(relay(30));
    expect(senderRelays).toContain(DEFAULT_USER_WRITE_RELAYS[0]);

    poolState.getResult = null;
    await expect(
      relaysForNip17GiftWrap({
        giftWrapPTag: SENDER,
        receiverHexLower: RECEIVER,
        recipientInboxRelays: inboxes,
        senderHexLower: SENDER,
      })
    ).resolves.toEqual(DEFAULT_USER_WRITE_RELAYS);

    await expect(
      relaysForNip17GiftWrap({
        giftWrapPTag: "ee".repeat(32),
        receiverHexLower: RECEIVER,
        recipientInboxRelays: inboxes,
        senderHexLower: SENDER,
      })
    ).resolves.toEqual(DEFAULT_USER_WRITE_RELAYS);
  });

  it("rejects an empty message, a missing key, and an unusable key", async () => {
    await expect(sendNostrDirectMessage(RECEIVER, "")).resolves.toBe(false);

    envState.NOSTR_NSEC = undefined;
    await expect(sendNostrDirectMessage(RECEIVER, "hello")).resolves.toEqual({
      success: false,
      error: "NOSTR_NSEC is not set.",
      nip17: { attempted: false, recipientPublished: false },
      nip04: { success: false },
    });

    envState.NOSTR_NSEC = "nsec-empty";
    await expect(
      sendNostrDirectMessage(RECEIVER, "hello")
    ).resolves.toMatchObject({
      success: false,
      error: "NOSTR_NSEC could not be converted to a usable secret key.",
    });

    envState.NOSTR_NSEC = "not-a-key";
    conversion.convertToHex.mockReturnValue("zz");
    await expect(
      sendNostrDirectMessage(RECEIVER, "hello")
    ).resolves.toMatchObject({
      success: false,
    });

    envState.NOSTR_NSEC = "nsec-throws";
    conversion.convertToHex.mockReturnValue(RECEIVER);
    const sent = await sendNostrDirectMessage(RECEIVER, "hello");
    expect(isRecord(sent) ? sent["success"] : false).toBe(true);

    envState.NOSTR_NSEC = "nsec-string";
    conversion.convertToHex.mockReturnValue(null);
    await expect(
      sendNostrDirectMessage(RECEIVER, "hello")
    ).resolves.toMatchObject({
      success: false,
      error: "NOSTR_NSEC could not be converted to a usable secret key.",
    });

    envState.NOSTR_NSEC = "nsec-wrong";
    conversion.convertToHex.mockReturnValue("ab".repeat(32));
    await expect(sendNostrDirectMessage(RECEIVER, "hi")).resolves.toMatchObject(
      {
        success: true,
      }
    );
  });

  it("sends a NIP-04 message and records publish outcomes", async () => {
    flags.nostrDmNip17Enabled = false;
    const ok = await sendNostrDirectMessage(RECEIVER.toUpperCase(), "hello");
    expect(ok).toMatchObject({
      success: true,
      event: { id: "signed-1", content: "encrypted", kind: 4 },
      nip17: { attempted: false, recipientPublished: false, errors: [] },
      nip04: { success: true },
    });
    expect(tools.encrypt).toHaveBeenCalledWith(
      "11".repeat(32),
      RECEIVER,
      "hello"
    );
    const template: unknown = tools.finalizeEvent.mock.calls[0]?.[0];
    expect(isRecord(template) ? template["tags"] : null).toEqual([
      ["p", RECEIVER],
    ]);
    expect(nip17.wrapManyEvents).not.toHaveBeenCalled();

    publisher.publish.mockResolvedValueOnce({
      results: [
        { ok: false, relay: relay(0), error: "rejected" },
        { ok: false, relay: relay(1) },
      ],
    });
    await expect(
      sendNostrDirectMessage(RECEIVER, "hello")
    ).resolves.toMatchObject({
      success: false,
      error: "rejected",
      status: undefined,
      nip04: { success: false },
    });

    publisher.publish.mockResolvedValueOnce({
      results: [{ ok: false, relay: relay(0) }],
    });
    await expect(
      sendNostrDirectMessage(RECEIVER, "hello")
    ).resolves.toMatchObject({
      success: false,
      error: "Publish failed on all relays",
    });

    publisher.publish.mockResolvedValueOnce({ results: [] });
    await expect(
      sendNostrDirectMessage(RECEIVER, "hello")
    ).resolves.toMatchObject({
      success: true,
    });

    publisher.publish.mockResolvedValueOnce({
      results: [
        { ok: false, relay: relay(0), error: "one" },
        { ok: true, relay: relay(1) },
      ],
    });
    await expect(
      sendNostrDirectMessage(RECEIVER, "hello")
    ).resolves.toMatchObject({
      success: true,
    });

    publisher.publish.mockRejectedValueOnce(new Error("publish down"));
    await expect(
      sendNostrDirectMessage(RECEIVER, "hello")
    ).resolves.toMatchObject({
      success: false,
      error: "publish down",
    });
    publisher.publish.mockRejectedValueOnce("publish string");
    await expect(
      sendNostrDirectMessage(RECEIVER, "hello")
    ).resolves.toMatchObject({
      success: false,
      error: "publish string",
    });
  });

  it("publishes NIP-17 gift wraps and keeps going after wrap errors", async () => {
    poolState.getImpl = async (_relays, filter) => {
      if (kindOf(filter) === 10050) return inboxEvent([relay(3)]);
      if (kindOf(filter) === 10002) return listEvent([relay(4)], "");
      return null;
    };
    nip17.wrapManyEvents.mockReturnValue([
      { kind: 1059, id: "bad", content: "x", tags: [["p", "nope"]] },
      {
        kind: 1059,
        id: "recv",
        content: "x",
        tags: [["p", RECEIVER.toUpperCase()]],
      },
      { kind: 1059, id: "sender", content: "x", tags: [["p", SENDER]] },
      { kind: 1059, id: "other", content: "x", tags: [["p", "ee".repeat(32)]] },
    ]);
    const result = await sendNostrDirectMessage(RECEIVER, "secret");
    expect(result).toMatchObject({
      success: true,
      nip17: { attempted: true, recipientPublished: true },
    });
    const nip17Result = isRecord(result) ? result["nip17"] : null;
    const errors = isRecord(nip17Result) ? nip17Result["errors"] : [];
    expect(errors).toEqual(["Gift wrap missing p tag"]);
    expect(publisher.publish).toHaveBeenCalled();
    const relaySets = publisher.publish.mock.calls.map((call) => call[1]);
    expect(relaySets.some((relays) => relays[0] === relay(3))).toBe(true);

    publisher.publish.mockResolvedValue({
      results: [{ ok: false, relay: relay(0) }],
    });
    nip17.wrapManyEvents.mockReturnValue([
      { kind: 1059, id: "recv", content: "x", tags: [["p", RECEIVER]] },
    ]);
    const failed = await sendNostrDirectMessage(RECEIVER, "secret");
    const failedNip = isRecord(failed) ? failed["nip17"] : null;
    expect(isRecord(failedNip) ? failedNip["recipientPublished"] : true).toBe(
      false
    );
    expect(isRecord(failedNip) ? failedNip["errors"] : []).toEqual([
      "Publish failed on all relays",
    ]);

    publisher.publish.mockResolvedValue({
      results: [{ ok: false, relay: relay(0), error: "wrap rejected" }],
    });
    const withError = await sendNostrDirectMessage(RECEIVER, "secret");
    const errorNip = isRecord(withError) ? withError["nip17"] : null;
    expect(isRecord(errorNip) ? errorNip["errors"] : []).toEqual([
      "wrap rejected",
    ]);

    nip17.wrapManyEvents.mockImplementation(() => {
      throw new Error("wrap down");
    });
    const thrown = await sendNostrDirectMessage(RECEIVER, "secret");
    expect(
      isRecord(thrown) && isRecord(thrown["nip17"])
        ? thrown["nip17"]["errors"]
        : []
    ).toEqual(["wrap down"]);
    expect(logger.logError.mock.calls.at(-1)?.[0]).toBeInstanceOf(Error);

    nip17.wrapManyEvents.mockImplementation(() => {
      throw "wrap string";
    });
    const thrownString = await sendNostrDirectMessage(RECEIVER, "secret");
    expect(
      isRecord(thrownString) && isRecord(thrownString["nip17"])
        ? thrownString["nip17"]["errors"]
        : []
    ).toEqual(["wrap string"]);
    const logged: unknown = logger.logError.mock.calls.at(-1)?.[0];
    expect(logged).toBeInstanceOf(Error);
    if (logged instanceof Error) expect(logged.message).toBe("wrap string");
  });

  it("skips NIP-17 for a bad receiver and reports outer send failures", async () => {
    await expect(
      sendNostrDirectMessage("not-a-key", "hello")
    ).resolves.toMatchObject({
      success: true,
      nip17: { attempted: false, recipientPublished: false, errors: [] },
    });
    expect(nip17.wrapManyEvents).not.toHaveBeenCalled();
    expect(publisher.publish.mock.calls[0]?.[1]).toEqual(
      DEFAULT_USER_WRITE_RELAYS
    );

    conversion.convertToHex.mockImplementation((value: string) => {
      if (value === "npub-throws") throw new Error("convert");
      if (value === "npub-string") throw "convert";
      if (value === "npub-null") return null;
      return RECEIVER;
    });
    await sendNostrDirectMessage("npub-ok", "hello");
    expect(tools.encrypt.mock.calls.at(-1)?.[1]).toBe(RECEIVER);

    await sendNostrDirectMessage("npub-null", "hello");
    expect(tools.encrypt.mock.calls.at(-1)?.[1]).toBe("npub-null");

    await sendNostrDirectMessage("npub-throws", "hello");
    expect(tools.encrypt.mock.calls.at(-1)?.[1]).toBe("npub-throws");
    const errorLog: unknown = logger.logWarning.mock.calls.at(-1)?.[1];
    expect(isRecord(errorLog) ? errorLog["error"] : "").toBe("convert");

    await sendNostrDirectMessage("npub-string", "hello");
    const stringLog: unknown = logger.logWarning.mock.calls.at(-1)?.[1];
    expect(isRecord(stringLog) ? stringLog["error"] : "").toBe("convert");

    tools.encrypt.mockImplementation(() => {
      throw new Error("encrypt down");
    });
    await expect(sendNostrDirectMessage(RECEIVER, "hello")).resolves.toEqual({
      success: false,
      error: "encrypt down",
      nip17: { attempted: false, recipientPublished: false },
      nip04: { success: false },
    });

    tools.encrypt.mockImplementation(() => {
      throw "encrypt string";
    });
    await expect(sendNostrDirectMessage(RECEIVER, "hello")).resolves.toEqual({
      success: false,
      error: "encrypt string",
      nip17: { attempted: false, recipientPublished: false },
      nip04: { success: false },
    });
    const logged: unknown = logger.logError.mock.calls.at(-1)?.[0];
    expect(logged).toBeInstanceOf(Error);
    if (logged instanceof Error) expect(logged.message).toBe("encrypt string");
  });

  it("uses the list fallback for NIP-65 when get is missing", async () => {
    poolState.hasGet = false;
    poolState.hasList = true;
    poolState.listResult = [listEvent([relay(8)], "READ")];
    const relays = await resolveDmRelaysSafe(RECEIVER);
    expect(relays[0]).toBe(relay(8));
    expect(poolState.listCalls).toBeGreaterThan(0);

    poolState.getError = null;
    poolState.hasGet = true;
    poolState.listError = new Error("list down");
    poolState.hasList = true;
    poolState.hasGet = false;
    await expect(resolveDmRelaysSafe(RECEIVER)).resolves.toEqual(
      DEFAULT_USER_WRITE_RELAYS
    );
  });
});
