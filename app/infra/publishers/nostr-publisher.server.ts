/**
 * In-process Nostr publisher.
 *
 * Callers share one publisher. Tests can replace it. There is no HTTP
 * publisher and no backend selector.
 */

import type { SignedEvent } from "~/features/nostr/types";
import { env } from "~/lib/env.server";
import { logInfo, logWarning } from "~/lib/error-logger.server";

import { InternalNostrPublisher } from "./internal-nostr-publisher.server";

export interface RelayPublishResult {
  relay: string;
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface NostrPublishResult {
  /**
   * Per-relay acknowledgements. An empty list means this call could not
   * attribute an outcome to a relay.
   */
  results: RelayPublishResult[];
}

/**
 * Policy options for publishing behavior.
 * The internal publisher records the requested policy. Relay delivery
 * uses the same acknowledgement rules for every policy.
 */
export type PublishPolicy = "default" | "conservative" | "aggressive";

export interface NostrPublisher {
  publish(
    event: SignedEvent,
    relays: string[],
    correlationId?: string,
    policy?: PublishPolicy
  ): Promise<NostrPublishResult>;
}

let defaultPublisher: NostrPublisher | null = null;
let loggedBackend = false;

/**
 * The process publisher. It opens relay sockets from this process.
 */
export function getNostrPublisher(): NostrPublisher {
  if (!loggedBackend) {
    loggedBackend = true;
    logInfo("Nostr publisher backend selected", {
      publisherBackend: "internal",
    });
    if (env.NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS === "true") {
      logWarning(
        "NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS is enabled. The publisher can open relay URLs on private networks.",
        { publisherBackend: "internal" }
      );
    }
  }
  defaultPublisher ??= new InternalNostrPublisher({
    allowPrivateRelays: env.NOSTR_PUBLISHER_ALLOW_PRIVATE_RELAYS === "true",
  });
  return defaultPublisher;
}

/**
 * Set a custom Nostr publisher (for testing)
 */
export function setNostrPublisher(publisher: NostrPublisher): void {
  defaultPublisher = publisher;
}

/**
 * Drop the cached publisher so the next read follows the current environment.
 */
export function resetNostrPublisherForTests(): void {
  defaultPublisher = null;
  loggedBackend = false;
}
