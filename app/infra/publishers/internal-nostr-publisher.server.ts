/**
 * In-process NIP-01 publisher.
 *
 * Callers pass an already signed event. This module checks the id and
 * signature with nostr-tools, then opens its own relay sockets. It does not
 * read or store private keys.
 *
 * A confirmed acknowledgement is remembered per relay. A later attempt can
 * still deliver the same event to a relay that has not acknowledged it.
 * One transient failure is retried here. A negative acknowledgement is not.
 */

import { getEventHash, verifyEvent } from "nostr-tools";

import type { SignedEvent } from "~/features/nostr/types";
import { relaysArray as systemDefaultRelays } from "~/features/relays/relay-constants";
import { logInfo, logWarning } from "~/lib/error-logger.server";
import { ValidationError } from "~/lib/errors";
import { recordRelayRequest } from "~/lib/metrics/relay-metrics.server";

import {
  prioritizeRelaysByHealth,
  recordRelayFailure,
  recordRelaySuccess,
} from "../relays/relay-health.server";

import type {
  NostrPublisher,
  NostrPublishResult,
  PublishPolicy,
  RelayPublishResult,
} from "./nostr-publisher.server";
import {
  createMemoryPublishLedger,
  createRedisPublishLedger,
  type PublishConfirmationLedger,
} from "./publisher-ledger";
import {
  recordInternalRelayPublish,
  setInternalPublisherOpenSockets,
} from "./publisher-metrics.server";
import {
  internalPublisherOpenSocketCount,
  publishEventOnce,
  RelaySocketError,
} from "./relay-session";
import {
  assessRelayUrl,
  dedupeRelayUrls,
  isTransientPublishFailure,
  relayHostname,
  resolveRelayAddresses,
  type PublishFailureCategory,
} from "./relay-target";

const MAX_RELAYS = 32;
const MAX_EVENT_BYTES = 256 * 1024;

interface PublishingLimits {
  connectTimeoutMs: number;
  ackTimeoutMs: number;
  totalTimeoutMs: number;
  fanoutConcurrency: number;
  transientRetries: number;
}

export interface InternalNostrPublisherOptions {
  allowPrivateRelays?: boolean;
  maxRelays?: number;
  maxEventBytes?: number;
  connectTimeoutMs?: number;
  ackTimeoutMs?: number;
  totalTimeoutMs?: number;
  fanoutConcurrency?: number;
  processConcurrency?: number;
  transientRetries?: number;
  retryDelayMs?: number;
  ledger?: PublishConfirmationLedger;
  resolveAddresses?: (hostname: string) => Promise<string[]>;
}

interface AttemptResult extends RelayPublishResult {
  cached: boolean;
  failureCategory: PublishFailureCategory | "none";
}

class AsyncSemaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) {
      throw new RelaySocketError("publish timed out", "ack_timeout");
    }
    if (this.active >= this.limit) {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const resume = () => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          resolve();
        };
        const onAbort = () => {
          if (settled) return;
          settled = true;
          const index = this.waiting.indexOf(resume);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new RelaySocketError("publish timed out", "ack_timeout"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        this.waiting.push(resume);
      });
    }
    if (signal.aborted) {
      throw new RelaySocketError("publish timed out", "ack_timeout");
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const next = this.waiting.shift();
      next?.();
    };
  }
}

const sharedSemaphore = new AsyncSemaphore(24);
let sharedLedger: PublishConfirmationLedger | null = null;

function limitsFor(
  policy: PublishPolicy,
  overrides: InternalNostrPublisherOptions
): PublishingLimits {
  const base: PublishingLimits =
    policy === "conservative"
      ? {
          connectTimeoutMs: 8_000,
          ackTimeoutMs: 12_000,
          totalTimeoutMs: 20_000,
          fanoutConcurrency: 4,
          transientRetries: 1,
        }
      : policy === "aggressive"
        ? {
            connectTimeoutMs: 3_000,
            ackTimeoutMs: 5_000,
            totalTimeoutMs: 10_000,
            fanoutConcurrency: 12,
            transientRetries: 0,
          }
        : {
            connectTimeoutMs: 5_000,
            ackTimeoutMs: 8_000,
            totalTimeoutMs: 15_000,
            fanoutConcurrency: 8,
            transientRetries: 1,
          };
  return {
    connectTimeoutMs: overrides.connectTimeoutMs ?? base.connectTimeoutMs,
    ackTimeoutMs: overrides.ackTimeoutMs ?? base.ackTimeoutMs,
    totalTimeoutMs: overrides.totalTimeoutMs ?? base.totalTimeoutMs,
    fanoutConcurrency: overrides.fanoutConcurrency ?? base.fanoutConcurrency,
    transientRetries: overrides.transientRetries ?? base.transientRetries,
  };
}

function eventForVerification(event: SignedEvent): SignedEvent {
  // A fresh object drops nostr-tools' cached verification flag. A caller can
  // copy that flag onto a different signature, so it is not evidence.
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  };
}

function assertPublishableEvent(event: SignedEvent): void {
  const candidate = eventForVerification(event);
  let expectedId = "";
  try {
    expectedId = getEventHash(candidate);
  } catch {
    throw new ValidationError("Malformed signed event");
  }
  if (expectedId !== candidate.id) {
    throw new ValidationError("Signed event id does not match its content");
  }
  let verified = false;
  try {
    verified = verifyEvent(candidate);
  } catch {
    verified = false;
  }
  if (!verified) {
    throw new ValidationError("Signed event signature is invalid");
  }
}

async function defaultLedger(): Promise<PublishConfirmationLedger> {
  if (sharedLedger) return sharedLedger;
  try {
    const { redis } = await import("~/infra/queue");
    sharedLedger = createRedisPublishLedger(redis, {
      onError: (error) => {
        logWarning(
          "Nostr publisher: Redis acknowledgement record failed; publishing continues",
          {
            error: error instanceof Error ? error.message : String(error),
          }
        );
      },
    });
  } catch (error) {
    logWarning(
      "Nostr publisher: Redis acknowledgement record is unavailable; using process memory",
      {
        error: error instanceof Error ? error.message : String(error),
      }
    );
    sharedLedger = createMemoryPublishLedger();
  }
  return sharedLedger;
}

function failureCategory(error: unknown): PublishFailureCategory {
  if (error instanceof RelaySocketError) return error.category;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("blocked address")) return "private_address";
  if (message.includes("timed out") || message.includes("timeout")) {
    return "connection_timeout";
  }
  if (message.includes("closed")) return "closed";
  return "connection_failed";
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "relay connection failed";
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return;
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        const item = items[index];
        if (item === undefined) return;
        results[index] = await run(item);
      }
    })
  );
  return results;
}

export class InternalNostrPublisher implements NostrPublisher {
  private readonly allowPrivateRelays: boolean;
  private readonly maxRelays: number;
  private readonly maxEventBytes: number;
  private readonly retryDelayMs: number;
  private readonly semaphore: AsyncSemaphore;
  private readonly ledger: PublishConfirmationLedger | null;
  private readonly resolveAddresses: (hostname: string) => Promise<string[]>;
  private readonly options: InternalNostrPublisherOptions;

  constructor(options: InternalNostrPublisherOptions = {}) {
    this.options = options;
    this.allowPrivateRelays = options.allowPrivateRelays === true;
    this.maxRelays = Math.max(1, options.maxRelays ?? MAX_RELAYS);
    this.maxEventBytes = options.maxEventBytes ?? MAX_EVENT_BYTES;
    this.retryDelayMs = options.retryDelayMs ?? 75;
    this.semaphore =
      options.processConcurrency === undefined
        ? sharedSemaphore
        : new AsyncSemaphore(Math.max(1, options.processConcurrency));
    this.ledger = options.ledger ?? null;
    this.resolveAddresses = options.resolveAddresses ?? resolveRelayAddresses;
  }

  async publish(
    event: SignedEvent,
    relays: string[],
    correlationId?: string,
    policy: PublishPolicy = "default"
  ): Promise<NostrPublishResult> {
    const limits = limitsFor(policy, this.options);
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    const encoded = JSON.stringify(event);
    if (Buffer.byteLength(encoded) > this.maxEventBytes) {
      throw new ValidationError(
        "Signed event exceeds the publisher size limit"
      );
    }
    assertPublishableEvent(event);

    const requested = dedupeRelayUrls(
      relays.length > 0 ? relays : systemDefaultRelays
    );
    let ordered = prioritizeRelaysByHealth(requested);
    if (ordered.length === 0) {
      logWarning("All relays filtered out by health, using original list", {
        correlationId,
        eventId: event.id,
        kind: event.kind,
        publisherBackend: "internal",
      });
      ordered = requested;
    }
    const selected = ordered.slice(0, this.maxRelays);
    const overflow = ordered.slice(this.maxRelays);
    const deadline = AbortSignal.timeout(limits.totalTimeoutMs);
    const published = await mapPool(
      selected,
      limits.fanoutConcurrency,
      (relay) =>
        this.publishRelay(event, relay, limits, deadline, correlationId)
    );
    const overflowResults: AttemptResult[] = overflow.map((relay) => ({
      relay,
      ok: false,
      error: "relay limit exceeded",
      cached: false,
      failureCategory: "unknown",
    }));
    const attempts = [...published, ...overflowResults];
    this.recordHealth(attempts);
    this.logResults(event, attempts, correlationId);
    setInternalPublisherOpenSockets(internalPublisherOpenSocketCount());
    return {
      results: attempts.map(({ relay, ok, latencyMs, error }) => ({
        relay,
        ok,
        latencyMs,
        ...(error && !ok ? { error } : {}),
      })),
    };
  }

  private recordHealth(results: AttemptResult[]): void {
    for (const result of results) {
      if (!result.cached) {
        if (result.ok) {
          recordRelaySuccess(result.relay, result.latencyMs ?? 0);
          recordRelayRequest(result.relay, true);
        } else {
          recordRelayFailure(result.relay, result.error);
          recordRelayRequest(result.relay, false);
        }
      }
      recordInternalRelayPublish({
        ok: result.ok,
        failureCategory: result.failureCategory,
        latencyMs: result.latencyMs ?? 0,
      });
    }
  }

  private logResults(
    event: SignedEvent,
    results: AttemptResult[],
    correlationId?: string
  ): void {
    logInfo("Nostr publisher: relay results", {
      publisherBackend: "internal",
      correlationId,
      eventId: event.id,
      kind: event.kind,
      results: results.map((result) => ({
        relayHost: relayHostname(result.relay),
        result: result.ok ? "ok" : "failed",
        latencyMs: result.latencyMs,
        failureCategory: result.failureCategory,
      })),
    });
  }

  private async ledgerClient(): Promise<PublishConfirmationLedger> {
    return this.ledger ?? (await defaultLedger());
  }

  private async publishRelay(
    event: SignedEvent,
    relay: string,
    limits: PublishingLimits,
    signal: AbortSignal,
    correlationId?: string
  ): Promise<AttemptResult> {
    const started = Date.now();
    const assessed = assessRelayUrl(relay, this.allowPrivateRelays);
    if (!assessed.ok) {
      return {
        relay,
        ok: false,
        latencyMs: Date.now() - started,
        error: assessed.message,
        cached: false,
        failureCategory: assessed.category,
      };
    }

    const cached = await this.readConfirmation(
      event.id,
      assessed.target.canonical,
      relay,
      correlationId
    );
    if (cached) {
      return {
        relay,
        ok: true,
        latencyMs: 0,
        cached: true,
        failureCategory: "none",
      };
    }

    let release: (() => void) | undefined;
    try {
      release = await this.semaphore.acquire(signal);
      return await this.publishWithRetry(
        event,
        relay,
        assessed.target.canonical,
        assessed.target.connectUrl,
        limits,
        signal,
        started,
        correlationId
      );
    } catch (error) {
      return {
        relay,
        ok: false,
        latencyMs: Date.now() - started,
        error: failureMessage(error),
        cached: false,
        failureCategory: failureCategory(error),
      };
    } finally {
      release?.();
    }
  }

  private async readConfirmation(
    eventId: string,
    relayKey: string,
    relay: string,
    correlationId?: string
  ): Promise<boolean> {
    try {
      const ledger = await this.ledgerClient();
      return await ledger.confirmed(eventId, relayKey);
    } catch (error) {
      logWarning(
        "Nostr publisher: acknowledgement lookup failed; publishing continues",
        {
          correlationId,
          eventId,
          relayHost: relayHostname(relay),
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  private async publishWithRetry(
    event: SignedEvent,
    relay: string,
    relayKey: string,
    connectUrl: string,
    limits: PublishingLimits,
    signal: AbortSignal,
    started: number,
    correlationId?: string
  ): Promise<AttemptResult> {
    let lastCategory: PublishFailureCategory = "connection_failed";
    let lastMessage = "relay connection failed";
    let attempts = 0;
    const maxAttempts = limits.transientRetries + 1;
    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        const outcome = await publishEventOnce({
          connectUrl,
          event,
          connectTimeoutMs: limits.connectTimeoutMs,
          ackTimeoutMs: limits.ackTimeoutMs,
          allowPrivateRelays: this.allowPrivateRelays,
          resolveAddresses: this.resolveAddresses,
          signal,
        });
        const latencyMs = Date.now() - started;
        if (outcome.ok) {
          await this.remember(event.id, relayKey, correlationId, relay);
          this.logAttempt({
            correlationId,
            eventId: event.id,
            relay,
            ok: true,
            latencyMs,
            failureCategory: "none",
            retryCount: attempts - 1,
          });
          return {
            relay,
            ok: true,
            latencyMs,
            cached: false,
            failureCategory: "none",
          };
        }
        const message = outcome.message
          ? `rejected: ${outcome.message}`
          : "rejected";
        this.logAttempt({
          correlationId,
          eventId: event.id,
          relay,
          ok: false,
          latencyMs,
          failureCategory: "rejected",
          retryCount: attempts - 1,
        });
        return {
          relay,
          ok: false,
          latencyMs,
          error: message,
          cached: false,
          failureCategory: "rejected",
        };
      } catch (error) {
        lastCategory = failureCategory(error);
        lastMessage = failureMessage(error);
        const retry =
          isTransientPublishFailure(lastCategory) && attempts < maxAttempts;
        if (!retry) break;
        await delay(this.retryDelayMs, signal);
      }
    }
    const latencyMs = Date.now() - started;
    this.logAttempt({
      correlationId,
      eventId: event.id,
      relay,
      ok: false,
      latencyMs,
      failureCategory: lastCategory,
      retryCount: attempts - 1,
    });
    return {
      relay,
      ok: false,
      latencyMs,
      error: lastMessage,
      cached: false,
      failureCategory: lastCategory,
    };
  }

  private logAttempt(input: {
    correlationId?: string;
    eventId: string;
    relay: string;
    ok: boolean;
    latencyMs: number;
    failureCategory: PublishFailureCategory | "none";
    retryCount: number;
  }): void {
    logInfo("Nostr publisher: relay attempt finished", {
      publisherBackend: "internal",
      correlationId: input.correlationId,
      eventId: input.eventId,
      relayHost: relayHostname(input.relay),
      result: input.ok ? "ok" : "failed",
      latencyMs: input.latencyMs,
      failureCategory: input.failureCategory,
      retryCount: input.retryCount,
    });
  }

  private async remember(
    eventId: string,
    relayKey: string,
    correlationId: string | undefined,
    relay: string
  ): Promise<void> {
    try {
      const ledger = await this.ledgerClient();
      await ledger.markConfirmed(eventId, relayKey);
    } catch (error) {
      logWarning(
        "Nostr publisher: could not record the relay acknowledgement; a retry may publish again",
        {
          correlationId,
          eventId,
          relayHost: relayHostname(relay),
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }
}

export {
  closeInternalPublisherConnections,
  internalPublisherOpenSocketCount,
} from "./relay-session";
