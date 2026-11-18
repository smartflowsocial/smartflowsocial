/**
 * Remembers relays that have already acknowledged an event.
 *
 * The key is event id plus relay, so a success on relay A does not block a
 * later publish of the same event to relay B. An unacknowledged attempt is
 * not recorded.
 */

export interface PublishConfirmationLedger {
  confirmed(eventId: string, relayKey: string): Promise<boolean>;
  markConfirmed(eventId: string, relayKey: string): Promise<void>;
}

export interface PublishLedgerRedis {
  status: string;
  connect?(): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    expiryMode: "EX",
    ttlSeconds: number
  ): Promise<unknown>;
}

const KEY_PREFIX = "nostr-publish:v1:";
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

function ledgerKey(eventId: string, relayKey: string): string {
  return `${KEY_PREFIX}${eventId}:${relayKey}`;
}

export function createMemoryPublishLedger(): PublishConfirmationLedger & {
  size(): number;
} {
  const confirmed = new Set<string>();
  return {
    async confirmed(eventId, relayKey) {
      return confirmed.has(ledgerKey(eventId, relayKey));
    },
    async markConfirmed(eventId, relayKey) {
      confirmed.add(ledgerKey(eventId, relayKey));
    },
    size() {
      return confirmed.size;
    },
  };
}

/**
 * Redis is the shared record across processes. When Redis is down, reads fail
 * open (the event is published again) and a process-local memory entry still
 * suppresses an immediate duplicate in this process after a confirmed ack.
 *
 * The shared client connects lazily. The ledger opens it on first use, so the
 * record reaches Redis even when the ledger is the first Redis user in a
 * process.
 */
export function createRedisPublishLedger(
  client: PublishLedgerRedis,
  options?: {
    ttlSeconds?: number;
    onError?: (error: unknown) => void;
  }
): PublishConfirmationLedger {
  const memory = createMemoryPublishLedger();
  const ttl = options?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  let opening: Promise<void> | undefined;

  async function openClient(): Promise<void> {
    try {
      await client.connect?.();
    } catch (error) {
      options?.onError?.(error);
    } finally {
      opening = undefined;
    }
  }

  async function redisReady(): Promise<boolean> {
    if (client.status === "ready") return true;
    if (client.status === "wait" && client.connect) {
      opening ??= openClient();
    }
    if (opening) await opening;
    return client.status === "ready";
  }

  return {
    async confirmed(eventId, relayKey) {
      if (await memory.confirmed(eventId, relayKey)) return true;
      if (!(await redisReady())) return false;
      try {
        const value = await client.get(ledgerKey(eventId, relayKey));
        if (value === "1") {
          await memory.markConfirmed(eventId, relayKey);
          return true;
        }
        return false;
      } catch (error) {
        options?.onError?.(error);
        return false;
      }
    },
    async markConfirmed(eventId, relayKey) {
      await memory.markConfirmed(eventId, relayKey);
      if (!(await redisReady())) return;
      try {
        await client.set(ledgerKey(eventId, relayKey), "1", "EX", ttl);
      } catch (error) {
        options?.onError?.(error);
      }
    },
  };
}
