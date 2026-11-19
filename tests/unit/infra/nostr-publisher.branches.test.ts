import { beforeEach, describe, expect, it, vi } from "vitest";

interface FetchInit {
  body?: string;
  correlationId?: string;
  headers?: Record<string, string>;
  maxRetries?: number;
  method?: string;
  timeout?: number;
}

interface InternalOptions {
  allowPrivateRelays?: boolean;
}

interface PublishBody {
  correlationId?: string;
  event: { id: string };
  relays: string[];
}

interface PublisherEnv {
  NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS: string | undefined;
  NOSTR_PUBLISHER_API_TOKEN: string | undefined;
  NOSTR_PUBLISHER_BACKEND: string | undefined;
  NOSTR_PUBLISHER_URL: string | undefined;
}

const envState = vi.hoisted(() => {
  const state: PublisherEnv = {
    NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS: undefined,
    NOSTR_PUBLISHER_API_TOKEN: undefined,
    NOSTR_PUBLISHER_BACKEND: "http",
    NOSTR_PUBLISHER_URL: "https://publisher.example/publish",
  };
  return state;
});

const health = vi.hoisted(() => ({
  dropAll: false,
  prioritizeRelaysByHealth: vi.fn((relays: string[]) =>
    health.dropAll ? [] : relays
  ),
  recordRelayFailure: vi.fn(),
  recordRelaySuccess: vi.fn(),
}));

const http = vi.hoisted(() => ({
  fetchWithRetry: vi.fn<(url: string, init: FetchInit) => Promise<Response>>(),
}));

const internal = vi.hoisted(() => ({
  options: [] as InternalOptions[],
}));

const logger = vi.hoisted(() => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarning: vi.fn(),
}));

const metrics = vi.hoisted(() => ({
  recordRelayRequest: vi.fn(),
}));

vi.mock("~/infra/publishers/internal-nostr-publisher.server", () => ({
  InternalNostrPublisher: class InternalNostrPublisher {
    constructor(options: InternalOptions) {
      internal.options.push(options);
    }
  },
}));
vi.mock("~/infra/relays/relay-health.server", () => health);
vi.mock("~/lib/env.server", () => ({ env: envState }));
vi.mock("~/lib/error-logger.server", () => logger);
vi.mock("~/lib/fetch.server", () => http);
vi.mock("~/lib/metrics/relay-metrics.server", () => metrics);

import type { SignedEvent } from "~/features/nostr/types";
import { relaysArray } from "~/features/relays/relay-constants";
import {
  DefaultNostrPublisher,
  getNostrPublisher,
  resetNostrPublisherForTests,
  setNostrPublisher,
} from "~/infra/publishers/nostr-publisher.server";

const RELAY = "wss://relay.example.com/path";
const OTHER = "wss://other.example.com";

function signedEvent(): SignedEvent {
  return {
    id: "event-1",
    pubkey: "ab".repeat(32),
    created_at: 1_700_000_000,
    kind: 1,
    tags: [],
    content: "hello",
    sig: "sig",
  };
}

function jsonResponse(
  body: unknown,
  status = 200,
  statusText = "OK",
  headers?: Record<string, string>
): Response {
  const text =
    body === null ? "" : typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, statusText, headers });
}

function lastFetch(): { init: FetchInit; url: string } {
  const call = http.fetchWithRetry.mock.calls.at(-1);
  if (!call) throw new Error("expected fetch");
  return { url: call[0], init: call[1] };
}

function publishBody(): PublishBody {
  const raw = lastFetch().init.body;
  if (typeof raw !== "string") throw new Error("expected body");
  return JSON.parse(raw) as PublishBody;
}

describe("default nostr publisher branches", () => {
  beforeEach(() => {
    envState.NOSTR_PUBLISHER_URL = "https://publisher.example/publish";
    envState.NOSTR_PUBLISHER_API_TOKEN = undefined;
    envState.NOSTR_PUBLISHER_BACKEND = "http";
    envState.NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS = undefined;
    health.dropAll = false;
    internal.options = [];
    resetNostrPublisherForTests();
    http.fetchWithRetry.mockReset();
    health.recordRelayFailure.mockReset();
    health.recordRelaySuccess.mockReset();
    health.prioritizeRelaysByHealth.mockClear();
    logger.logError.mockReset();
    logger.logInfo.mockReset();
    logger.logWarning.mockReset();
    metrics.recordRelayRequest.mockReset();
  });

  it("requires a publisher URL", () => {
    envState.NOSTR_PUBLISHER_URL = undefined;
    expect(() => new DefaultNostrPublisher()).toThrow(
      "NOSTR_PUBLISHER_URL environment variable is not set"
    );
  });

  it("normalizes relays and records per-relay success and failure", async () => {
    envState.NOSTR_PUBLISHER_API_TOKEN = "token-1";
    http.fetchWithRetry.mockResolvedValue(
      jsonResponse({
        results: [
          { relay: RELAY, ok: true, latencyMs: 15, error: 4 },
          {
            relay: OTHER,
            success: false,
            error: "rejected",
            latencyMs: "slow",
          },
          "skip",
          { relay: "", ok: true },
          { ok: true },
        ],
      })
    );
    const publisher = new DefaultNostrPublisher();
    await expect(
      publisher.publish(
        signedEvent(),
        [`  ${RELAY}  `, RELAY, "", "   ", OTHER],
        "corr-1",
        "aggressive"
      )
    ).resolves.toEqual({
      results: [
        { relay: RELAY, ok: true, latencyMs: 15, error: undefined },
        { relay: OTHER, ok: false, latencyMs: undefined, error: "rejected" },
      ],
    });

    const sent = lastFetch();
    expect(sent.url).toBe(
      "https://publisher.example/publish?policy=aggressive"
    );
    expect(sent.init.method).toBe("POST");
    expect(sent.init.timeout).toBe(15000);
    expect(sent.init.maxRetries).toBe(2);
    expect(sent.init.correlationId).toBe("corr-1");
    expect(sent.init.headers).toEqual({
      "Content-Type": "application/json",
      "API-TOKEN": "token-1",
      "X-Request-ID": "corr-1",
    });
    expect(publishBody().relays).toEqual([RELAY, OTHER]);
    expect(health.recordRelaySuccess).toHaveBeenCalledWith(RELAY, 15);
    expect(health.recordRelayFailure).toHaveBeenCalledWith(OTHER, "rejected");
    expect(metrics.recordRelayRequest).toHaveBeenCalledWith(RELAY, true);
    expect(metrics.recordRelayRequest).toHaveBeenCalledWith(OTHER, false);
  });

  it("uses default relays, health fallback, and total latency", async () => {
    http.fetchWithRetry.mockResolvedValue(
      jsonResponse({
        results: [{ relay: relaysArray[0], ok: true }],
      })
    );
    const publisher = new DefaultNostrPublisher();
    await publisher.publish(signedEvent(), [], undefined, "default");
    expect(lastFetch().url).toBe("https://publisher.example/publish");
    expect(lastFetch().init.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(publishBody().relays).toEqual(relaysArray);
    const latency: unknown = health.recordRelaySuccess.mock.calls[0]?.[1];
    expect(typeof latency).toBe("number");

    health.dropAll = true;
    http.fetchWithRetry.mockResolvedValue(
      jsonResponse({
        perRelay: { [OTHER]: true, [RELAY]: "maybe", skipped: false },
      })
    );
    await publisher.publish(signedEvent(), [OTHER], undefined, "conservative");
    expect(lastFetch().url).toContain("policy=conservative");
    expect(publishBody().relays).toEqual([OTHER]);
    expect(logger.logWarning.mock.calls.map((call) => call[0])).toContain(
      "All relays filtered out by health, using original list"
    );
    const fallbackLatency: unknown =
      health.recordRelaySuccess.mock.calls.at(-1)?.[1];
    expect(typeof fallbackLatency).toBe("number");
  });

  it("returns no attributed results when the body cannot be mapped", async () => {
    const publisher = new DefaultNostrPublisher();
    const bodies = ["", "not-json", "[]", "{}"];
    for (const body of bodies) {
      http.fetchWithRetry.mockResolvedValueOnce(jsonResponse(body));
      await expect(publisher.publish(signedEvent(), [RELAY])).resolves.toEqual({
        results: [],
      });
    }
    expect(logger.logWarning).toHaveBeenCalled();
    expect(health.recordRelaySuccess).not.toHaveBeenCalled();

    http.fetchWithRetry.mockResolvedValue(
      jsonResponse({
        results: [{ relay: OTHER, ok: true }],
      })
    );
    await expect(publisher.publish(signedEvent(), ["  ", ""])).resolves.toEqual(
      {
        results: [],
      }
    );
    expect(publishBody().relays).toEqual([]);
  });

  it("matches canonical urls, hostnames, and unmatched upstream rows", async () => {
    const publisher = new DefaultNostrPublisher();
    http.fetchWithRetry.mockResolvedValue(
      jsonResponse({
        results: [{ relay: "wss://relay.example.com/path/", ok: true }],
      })
    );
    await expect(
      publisher.publish(signedEvent(), ["wss://Relay.Example.com/path"])
    ).resolves.toEqual({
      results: [
        {
          relay: "wss://Relay.Example.com/path",
          ok: true,
          latencyMs: undefined,
          error: undefined,
        },
      ],
    });

    http.fetchWithRetry.mockResolvedValue(
      jsonResponse({
        results: [{ relay: "wss://relay.example.com", ok: false, error: "no" }],
      })
    );
    await expect(
      publisher.publish(signedEvent(), ["wss://relay.example.com/inbox"])
    ).resolves.toEqual({
      results: [
        {
          relay: "wss://relay.example.com/inbox",
          ok: false,
          latencyMs: undefined,
          error: "no",
        },
      ],
    });

    http.fetchWithRetry.mockResolvedValue(
      jsonResponse({
        results: [
          { relay: "wss://%", ok: true },
          { relay: OTHER, ok: true },
        ],
      })
    );
    await expect(publisher.publish(signedEvent(), [RELAY])).resolves.toEqual({
      results: [
        { relay: "wss://%", ok: true, latencyMs: undefined, error: undefined },
        { relay: OTHER, ok: true, latencyMs: undefined, error: undefined },
      ],
    });
    expect(
      logger.logWarning.mock.calls.some((call) =>
        String(call[0]).includes("did not match requested relays")
      )
    ).toBe(true);

    http.fetchWithRetry.mockResolvedValue(
      jsonResponse({ results: [], perRelay: { [RELAY]: false } })
    );
    await expect(publisher.publish(signedEvent(), [RELAY])).resolves.toEqual({
      results: [
        { relay: RELAY, ok: false, latencyMs: undefined, error: undefined },
      ],
    });
  });

  it("throws a message for each publisher status", async () => {
    const publisher = new DefaultNostrPublisher();
    const cases: Array<{
      body: unknown;
      status: number;
      statusText: string;
      headers?: Record<string, string>;
      fragment: string;
    }> = [
      {
        status: 409,
        statusText: "Conflict",
        body: { error: "duplicate", code: "REPLAY" },
        fragment: "replay protection",
      },
      {
        status: 429,
        statusText: "Too Many",
        body: { error: "slow down", code: "RATE" },
        headers: { "Retry-After": "12" },
        fragment: "Retry after 12 seconds",
      },
      {
        status: 429,
        statusText: "Too Many",
        body: { error: "slow down" },
        fragment: "Rate limit exceeded",
      },
      {
        status: 400,
        statusText: "Bad Request",
        body: { error: "", code: "VAL" },
        fragment: "Bad Request",
      },
      {
        status: 400,
        statusText: "Bad Request",
        body: { error: "missing sig" },
        fragment: "missing sig",
      },
      {
        status: 500,
        statusText: "Server Error",
        body: "not-json",
        fragment: "Server Error",
      },
    ];

    for (const entry of cases) {
      http.fetchWithRetry.mockResolvedValueOnce(
        jsonResponse(entry.body, entry.status, entry.statusText, entry.headers)
      );
      await expect(publisher.publish(signedEvent(), [RELAY])).rejects.toThrow(
        entry.fragment
      );
    }
    expect(health.recordRelayFailure).toHaveBeenCalled();
    expect(
      logger.logWarning.mock.calls.some((call) =>
        String(call[0]).includes("Replay protection")
      )
    ).toBe(true);
    expect(
      logger.logWarning.mock.calls.some((call) =>
        String(call[0]).includes("Rate limit")
      )
    ).toBe(true);
    expect(logger.logError).toHaveBeenCalled();
  });

  it("logs replay, rate-limit, generic, and string transport failures", async () => {
    const publisher = new DefaultNostrPublisher();
    http.fetchWithRetry.mockRejectedValueOnce(
      new Error("replay protection from transport")
    );
    await expect(publisher.publish(signedEvent(), [RELAY])).rejects.toThrow(
      "replay protection"
    );

    http.fetchWithRetry.mockRejectedValueOnce(
      new Error("Rate limit from transport")
    );
    await expect(publisher.publish(signedEvent(), [RELAY])).rejects.toThrow(
      "Rate limit"
    );

    const failure = new Error("socket down");
    http.fetchWithRetry.mockRejectedValueOnce(failure);
    await expect(publisher.publish(signedEvent(), [RELAY])).rejects.toBe(
      failure
    );
    expect(logger.logError.mock.calls.at(-1)?.[0]).toBe(failure);
    expect(health.recordRelayFailure).toHaveBeenCalledWith(
      RELAY,
      "socket down"
    );

    http.fetchWithRetry.mockRejectedValueOnce("string down");
    await expect(publisher.publish(signedEvent(), [RELAY])).rejects.toBe(
      "string down"
    );
    const logged: unknown = logger.logError.mock.calls.at(-1)?.[0];
    expect(logged).toBeInstanceOf(Error);
    if (logged instanceof Error) expect(logged.message).toBe("string down");
    expect(metrics.recordRelayRequest).toHaveBeenCalledWith(RELAY, false);
  });

  it("selects, caches, and replaces the publisher backend", () => {
    const httpPublisher = getNostrPublisher();
    expect(getNostrPublisher()).toBe(httpPublisher);
    expect(logger.logInfo).toHaveBeenCalledTimes(1);
    expect(internal.options).toEqual([]);

    resetNostrPublisherForTests();
    envState.NOSTR_PUBLISHER_BACKEND = "internal";
    envState.NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS = "true";
    const internalPublisher = getNostrPublisher();
    expect(internalPublisher).not.toBe(httpPublisher);
    expect(internal.options).toEqual([{ allowPrivateRelays: true }]);
    expect(
      logger.logWarning.mock.calls.some((call) =>
        String(call[0]).includes("ALLOW_PRIVATE_RELAYS")
      )
    ).toBe(true);

    resetNostrPublisherForTests();
    logger.logWarning.mockClear();
    envState.NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS = "false";
    getNostrPublisher();
    expect(internal.options.at(-1)).toEqual({ allowPrivateRelays: false });
    expect(
      logger.logWarning.mock.calls.some((call) =>
        String(call[0]).includes("ALLOW_PRIVATE_RELAYS")
      )
    ).toBe(false);

    const custom = {
      publish: vi.fn(async () => ({ results: [] })),
    };
    setNostrPublisher(custom);
    expect(getNostrPublisher()).toBe(custom);

    envState.NOSTR_PUBLISHER_URL = undefined;
    envState.NOSTR_PUBLISHER_BACKEND = "http";
    resetNostrPublisherForTests();
    expect(() => getNostrPublisher()).toThrow("NOSTR_PUBLISHER_URL");
  });
});
