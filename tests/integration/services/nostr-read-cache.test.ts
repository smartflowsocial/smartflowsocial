import { beforeEach, describe, expect, it, vi } from "vitest";

const { testEnv, nativeMock, socketMock, redisMock } = vi.hoisted(() => {
  const redisStore = new Map<string, string>();
  return {
    testEnv: {
      NODE_ENV: "production",
      PRIMAL_UPSTREAM_URLS: undefined as string | undefined,
      NOSTRMASH_WS_URL: undefined as string | undefined,
      NOSTR_READ_TIMEOUT_MS: "15000",
    },
    nativeMock: vi.fn(
      async (..._args: unknown[]): Promise<unknown[] | null> => null
    ),
    socketMock: vi.fn(
      async (
        ..._args: unknown[]
      ): Promise<{
        ok: boolean;
        failure?: string;
        detail?: string;
        messages?: unknown[];
      }> => ({
        ok: false,
        failure: "unavailable",
        detail: "down",
      })
    ),
    redisMock: {
      store: redisStore,
      get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
      set: vi.fn(
        async (key: string, value: string, _mode: string, _ttl: number) => {
          redisStore.set(key, value);
          return "OK";
        }
      ),
      del: vi.fn(async (key: string) => {
        redisStore.delete(key);
        return 1;
      }),
    },
  };
});

vi.mock("~/lib/env.server", () => ({ env: testEnv }));
vi.mock("~/lib/error-logger.server", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarning: vi.fn(),
}));
vi.mock("~/infra/queue", () => ({ redis: redisMock }));
vi.mock("~/features/nostrmash/native-frames.server", () => ({
  tryNativePrimalFrames: nativeMock,
}));
vi.mock("~/features/cache/cache-socket.server", () => ({
  queryCacheSocket: socketMock,
}));
vi.mock("~/lib/nostrwebsocket.server", () => ({
  connectToPrimalCache: vi.fn(async () => {
    throw new Error("legacy socket should not run");
  }),
}));

import {
  connectToPrimalCache,
  fetchFromCache,
} from "~/features/cache/primalCache.server";
import { resetSingleFlightForTests } from "~/features/cache/single-flight";

const PUBKEY_A = "a".repeat(64);
const PUBKEY_B = "b".repeat(64);
const EVENT_ID = "c".repeat(64);

function profilePage(pubkey: string): unknown[] {
  return [
    [
      "EVENT",
      "sub",
      {
        kind: 0,
        pubkey,
        content: JSON.stringify({ name: "ada", display_name: "Ada" }),
      },
    ],
    [
      "EVENT",
      "sub",
      {
        kind: 10000105,
        pubkey,
        synthetic: true,
        sig: "",
        content: JSON.stringify({
          followers_count: 4,
          total_zap_count: 2,
          total_satszapped: 25,
        }),
      },
    ],
    ["EOSE", "sub"],
  ];
}

describe("internal read cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.store.clear();
    resetSingleFlightForTests();
    testEnv.PRIMAL_UPSTREAM_URLS = undefined;
    testEnv.NODE_ENV = "production";
    nativeMock.mockResolvedValue(null);
    socketMock.mockResolvedValue({
      ok: false,
      failure: "unavailable",
      detail: "down",
    });
  });

  it("returns a Redis hit without calling upstreams", async () => {
    nativeMock.mockResolvedValueOnce(profilePage(PUBKEY_A));
    await fetchFromCache("user_profile", { pubkey: PUBKEY_A });
    nativeMock.mockClear();
    socketMock.mockClear();
    const cached = await fetchFromCache("user_profile", { pubkey: PUBKEY_A });
    expect(cached).toEqual(profilePage(PUBKEY_A));
    expect(nativeMock).not.toHaveBeenCalled();
    expect(socketMock).not.toHaveBeenCalled();
  });

  it("stores a native profile miss and keeps users apart", async () => {
    nativeMock.mockImplementation(async (...args: unknown[]) => {
      const params = args[1] as { pubkey: string };
      return profilePage(params.pubkey);
    });
    const first = await fetchFromCache("user_profile", { pubkey: PUBKEY_A });
    const second = await fetchFromCache("user_profile", { pubkey: PUBKEY_B });
    expect(first).toEqual(profilePage(PUBKEY_A));
    expect(second).toEqual(profilePage(PUBKEY_B));
    expect(redisMock.set).toHaveBeenCalledTimes(2);
    const ttls = redisMock.set.mock.calls.map((call) => call[3]);
    expect(ttls).toEqual([300, 300]);
    const keys = redisMock.set.mock.calls.map((call) => call[0]);
    expect(keys[0]).not.toBe(keys[1]);
    expect(String(keys[0])).toContain(":v2:");
  });

  it("shares one upstream call across concurrent identical reads", async () => {
    let release: (value: unknown[]) => void = () => undefined;
    const gate = new Promise<unknown[]>((resolve) => {
      release = resolve;
    });
    nativeMock.mockImplementation(async () => gate);
    const pending = Promise.all([
      fetchFromCache("user_profile", { pubkey: PUBKEY_A }),
      fetchFromCache("user_profile", { pubkey: PUBKEY_A }),
    ]);
    release(profilePage(PUBKEY_A));
    const [first, second] = await pending;
    expect(first).toEqual(second);
    expect(nativeMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to Primal when native HTTP and the NostrMash socket fail", async () => {
    const thread = [
      ["EVENT", "sub", { id: EVENT_ID, kind: 1, content: "hello" }],
      [
        "EVENT",
        "sub",
        {
          kind: 10000100,
          synthetic: true,
          sig: "",
          content: JSON.stringify({
            event_id: EVENT_ID,
            replies: 2,
            likes: 3,
            reposts: 4,
            zaps: 1,
            satszapped: 50,
          }),
        },
      ],
      ["EOSE", "sub"],
    ];
    nativeMock.mockResolvedValue(null);
    socketMock.mockImplementation(async (...args: unknown[]) => {
      if (String(args[0]).includes("nostrmash")) {
        return { ok: false, failure: "response_timeout", detail: "slow" };
      }
      return { ok: true, messages: thread };
    });
    const page = await fetchFromCache("thread_view", { event_id: EVENT_ID });
    expect(page).toEqual(thread);
    expect(redisMock.set.mock.calls[0]?.[3]).toBe(30);
  });

  it("does not cache a transport failure and still reads when Redis get throws", async () => {
    redisMock.get.mockRejectedValueOnce(new Error("redis down"));
    nativeMock.mockResolvedValueOnce(profilePage(PUBKEY_A));
    await expect(
      fetchFromCache("user_profile", { pubkey: PUBKEY_A })
    ).resolves.toEqual(profilePage(PUBKEY_A));

    redisMock.set.mockClear();
    redisMock.store.clear();
    nativeMock.mockResolvedValue(null);
    socketMock.mockResolvedValue({
      ok: false,
      failure: "connect_timeout",
      detail: "timeout",
    });
    await expect(
      fetchFromCache("thread_view", { event_id: EVENT_ID })
    ).rejects.toThrow(/thread_view/);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("caches a valid empty notification page with the short TTL", async () => {
    socketMock.mockResolvedValue({
      ok: false,
      failure: "empty",
      detail: "none",
      messages: [["EOSE", "sub"]],
    });
    const page = await fetchFromCache("get_notifications", {
      pubkey: PUBKEY_A,
      limit: 20,
    });
    expect(page).toEqual([["EOSE", "sub"]]);
    expect(redisMock.set.mock.calls[0]?.[3]).toBe(5);
    await expect(
      connectToPrimalCache("get_notifications", { pubkey: PUBKEY_A, limit: 20 })
    ).resolves.toEqual([["EOSE", "sub"]]);
  });

  it("stores the in-process reader page under the v2 cache key", async () => {
    nativeMock.mockResolvedValueOnce(profilePage(PUBKEY_A));
    await fetchFromCache("user_profile", { pubkey: PUBKEY_A });
    expect(String(redisMock.set.mock.calls[0]?.[0])).toContain(":v2:");
  });
});
