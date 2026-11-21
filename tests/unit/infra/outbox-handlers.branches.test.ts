import { beforeEach, describe, expect, it, vi } from "vitest";

interface SignedEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface ScheduledPayload {
  postId: string;
  userId: string;
  signedEvent: SignedEvent;
  scheduledFor: number;
  schemaVersion: string;
  correlationId?: string;
}

interface VersionResult {
  success: boolean;
  payload?: ScheduledPayload;
  version?: string;
  error?: string;
}

interface EnqueueResult {
  success: boolean;
  jobId?: string;
  error?: string;
}

interface Kind5Draft {
  expectedPubkey: string;
  unsignedEvent: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  };
}

interface PublishResultRow {
  relay: string;
  ok: boolean;
  error?: string;
}

interface OutboxEvent {
  id: string;
  eventType: string;
  aggregateId: string;
  payload: unknown;
  createdAt: Date;
  scheduledFor: Date | null;
  correlationId?: string | null;
}

const envState = vi.hoisted(() => {
  const state: { NOSTR_NSEC: string | undefined } = {
    NOSTR_NSEC: "nsec-secret",
  };
  return state;
});
const processPayloadWithVersion = vi.hoisted(() =>
  vi.fn<
    (
      payload: unknown,
      context: { eventId: string; aggregateId: string }
    ) => VersionResult
  >()
);
const getPayloadVersion = vi.hoisted(() =>
  vi.fn<(payload: unknown) => string | undefined>()
);
const enqueue = vi.hoisted(() =>
  vi.fn<
    (
      queueName: string,
      jobName: string,
      data: {
        postId: string;
        userId: string;
        signedEvent: SignedEvent;
        correlationId?: string;
      },
      options: { scheduledFor: number; jobId: string }
    ) => Promise<EnqueueResult>
  >()
);
const cancelByJobId = vi.hoisted(() =>
  vi.fn<(queueName: string, jobId: string) => Promise<boolean>>()
);
const buildPostKind5DeleteDraft = vi.hoisted(() =>
  vi.fn<(payload: unknown, createdAtSec: number) => Kind5Draft | null>()
);
const buildLongFormKind5DeleteDraft = vi.hoisted(() =>
  vi.fn<(payload: unknown, createdAtSec: number) => Kind5Draft | null>()
);
const getPublicKey = vi.hoisted(() => vi.fn<(secret: string) => string>());
const finalizeEvent = vi.hoisted(() =>
  vi.fn<(event: Kind5Draft["unsignedEvent"], secret: string) => SignedEvent>()
);
const resolveExecutionRelays = vi.hoisted(() =>
  vi.fn<(userId: string) => Promise<string[]>>()
);
const publish = vi.hoisted(() =>
  vi.fn<
    (
      event: SignedEvent,
      relays: string[],
      correlationId?: string
    ) => Promise<{ results: PublishResultRow[] }>
  >()
);
const persistPublishRelayAcks = vi.hoisted(() =>
  vi.fn<(input: Record<string, unknown>) => Promise<void>>()
);
const logInfo = vi.hoisted(() =>
  vi.fn<(message: string, context?: Record<string, unknown>) => void>()
);
const logError = vi.hoisted(() =>
  vi.fn<(error: Error, context?: Record<string, unknown>) => void>()
);

vi.mock("~/features/nostr/delete-event.server", () => ({
  buildLongFormKind5DeleteDraft,
  buildPostKind5DeleteDraft,
}));
vi.mock("~/features/relays/publish-relay-acks.server", () => ({
  persistPublishRelayAcks,
}));
vi.mock("~/features/relays/relay-resolution.server", () => ({
  resolveExecutionRelays,
}));
vi.mock("~/infra/blastr/entitlement-sync.server", () => ({
  syncBlastrEntitlementBeforePublish: vi.fn(),
}));
vi.mock("~/infra/publishers/nostr-publisher.server", () => ({
  getNostrPublisher: () => ({ publish }),
}));
vi.mock("~/infra/queue/queue-client.server", () => ({
  queueClient: { enqueue, cancelByJobId },
}));
vi.mock("~/infra/queue/version-handler.server", () => ({
  CURRENT_VERSION: "1.0",
  getPayloadVersion,
  processPayloadWithVersion,
}));
vi.mock("~/lib/env.server", () => ({
  env: {
    get NOSTR_NSEC() {
      return envState.NOSTR_NSEC;
    },
  },
}));
vi.mock("~/lib/error-logger.server", () => ({
  logError,
  logInfo,
}));
vi.mock("~/lib/nostr-adapter.server", () => ({
  nostrAdapter: { finalizeEvent, getPublicKey },
}));

import type { ProcessableOutboxEvent } from "~/infra/outbox/outbox-handlers.server";
import {
  isDefinitelyNonRetryableOutboxError,
  processOutboxEvent,
} from "~/infra/outbox/outbox-handlers.server";

const SIGNED: SignedEvent = {
  id: "signed-id",
  pubkey: "ab".repeat(32),
  created_at: 10,
  kind: 1,
  tags: [],
  content: "hello",
  sig: "sig",
};
const SCHEDULED: ScheduledPayload = {
  postId: "post-1",
  userId: "user-1",
  signedEvent: SIGNED,
  scheduledFor: 1_700_000_000,
  schemaVersion: "1.0",
  correlationId: "corr-payload",
};
const CREATED_AT = new Date("2024-01-02T03:04:05.000Z");
const CREATED_AT_SEC = Math.floor(CREATED_AT.getTime() / 1000);
const DELETE_EVENT: SignedEvent = { ...SIGNED, id: "delete-id", kind: 5 };
const DRAFT: Kind5Draft = {
  expectedPubkey: "signer-pk",
  unsignedEvent: {
    kind: 5,
    created_at: CREATED_AT_SEC,
    tags: [["e", "original"]],
    content: "spam",
  },
};

function event(
  eventType: ProcessableOutboxEvent["eventType"],
  overrides?: Partial<ProcessableOutboxEvent>
): ProcessableOutboxEvent {
  return {
    id: "evt-1",
    eventType,
    aggregateId: "agg-1",
    payload: SCHEDULED,
    createdAt: CREATED_AT,
    scheduledFor: new Date("2024-01-03T00:00:00.000Z"),
    correlationId: "corr-event",
    ...overrides,
  };
}

function infoContext(message: string): Record<string, unknown> | undefined {
  return logInfo.mock.calls.find((call) => call[0] === message)?.[1];
}

describe("isDefinitelyNonRetryableOutboxError", () => {
  it.each([
    "Unknown event type: OTHER",
    "Failed to process payload version",
    "Payload version 9 is unsupported",
    "Schema version mismatch",
    "Invalid delete payload: missing required fields",
    "NOSTR_NSEC not configured for delete event signing",
    "Delete signer pubkey mismatch",
    "Outbox lock lost before finalize",
  ])("treats %s as terminal", (message) => {
    expect(isDefinitelyNonRetryableOutboxError(new Error(message))).toBe(true);
  });

  it("ignores retryable and empty messages", () => {
    expect(isDefinitelyNonRetryableOutboxError(new Error("redis down"))).toBe(
      false
    );
    expect(isDefinitelyNonRetryableOutboxError(new Error(""))).toBe(false);
    expect(
      isDefinitelyNonRetryableOutboxError(new Error("job already exists"))
    ).toBe(false);
  });
});

describe("scheduled outbox events", () => {
  beforeEach(() => {
    processPayloadWithVersion.mockReset();
    getPayloadVersion.mockReset();
    enqueue.mockReset();
    logInfo.mockReset();
    processPayloadWithVersion.mockReturnValue({
      success: true,
      payload: SCHEDULED,
      version: "1.0",
    });
    getPayloadVersion.mockReturnValue("0.9");
    enqueue.mockResolvedValue({ success: true, jobId: "post-1" });
  });

  it("enqueues a post and skips migration logs for the current version", async () => {
    await processOutboxEvent(event("POST_SCHEDULED"));

    expect(processPayloadWithVersion).toHaveBeenCalledWith(SCHEDULED, {
      eventId: "evt-1",
      aggregateId: "agg-1",
    });
    expect(getPayloadVersion).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith(
      "scheduled-posts",
      "publish-post",
      {
        postId: "post-1",
        userId: "user-1",
        signedEvent: SIGNED,
        correlationId: "corr-payload",
      },
      { scheduledFor: 1_700_000_000, jobId: "post-1" }
    );
    expect(infoContext("Enqueued post job from outbox")).toEqual({
      postId: "post-1",
      outboxEventId: "evt-1",
      correlationId: "corr-payload",
      eventType: "POST_SCHEDULED",
      queueName: "scheduled-posts",
      jobId: "post-1",
      schemaVersion: "1.0",
    });
  });

  it("logs a payload migration and falls back to the event correlation id", async () => {
    const { correlationId: _ignored, ...withoutCorrelation } = SCHEDULED;
    processPayloadWithVersion.mockReturnValue({
      success: true,
      payload: withoutCorrelation,
      version: "0.9",
    });

    await processOutboxEvent(
      event("LONGFORM_SCHEDULED", {
        correlationId: null,
        payload: { raw: true },
      })
    );

    expect(getPayloadVersion).toHaveBeenCalledWith({ raw: true });
    expect(infoContext("Processed payload with version migration")).toEqual({
      postId: "post-1",
      outboxEventId: "evt-1",
      eventType: "LONGFORM_SCHEDULED",
    });
    expect(infoContext("Outbox payload schema migration details")).toEqual({
      postId: "post-1",
      eventId: "evt-1",
      originalVersion: "0.9",
      migratedVersion: "0.9",
    });
    expect(enqueue).toHaveBeenCalledWith(
      "scheduled-longform-posts",
      "publish-longform-post",
      {
        postId: "post-1",
        userId: "user-1",
        signedEvent: SIGNED,
        correlationId: undefined,
      },
      { scheduledFor: 1_700_000_000, jobId: "post-1" }
    );
  });

  it.each([
    [
      { success: false, error: "Payload version 0 is unsupported" },
      "Payload version 0 is unsupported",
    ],
    [{ success: false }, "Failed to process payload version"],
    [{ success: true, error: "missing body" }, "missing body"],
    [{ success: true }, "Failed to process payload version"],
  ] as const)("rejects a version result %#", async (result, message) => {
    processPayloadWithVersion.mockReturnValue(result);
    await expect(processOutboxEvent(event("POST_SCHEDULED"))).rejects.toThrow(
      message
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each([
    [
      "Job already exists",
      "Post job already enqueued; treating outbox as idempotent",
      "POST_SCHEDULED",
    ],
    [
      "The job exists already",
      "Longform job already enqueued; treating outbox as idempotent",
      "LONGFORM_SCHEDULED",
    ],
    [
      "Duplicate job id",
      "Post job already enqueued; treating outbox as idempotent",
      "POST_SCHEDULED",
    ],
  ] as const)(
    "treats %s as an idempotent enqueue",
    async (error, logMessage, eventType) => {
      enqueue.mockResolvedValue({ success: false, error });
      await processOutboxEvent(event(eventType));
      expect(infoContext(logMessage)?.["postId"]).toBe("post-1");
      expect(
        logInfo.mock.calls.some((call) => call[0].startsWith("Enqueued"))
      ).toBe(false);
    }
  );

  it("throws the queue error, the default message, or an empty error", async () => {
    enqueue.mockResolvedValueOnce({ success: false, error: "redis down" });
    await expect(processOutboxEvent(event("POST_SCHEDULED"))).rejects.toThrow(
      "redis down"
    );

    enqueue.mockResolvedValueOnce({ success: false });
    await expect(processOutboxEvent(event("POST_SCHEDULED"))).rejects.toThrow(
      "Failed to enqueue post job"
    );

    enqueue.mockResolvedValueOnce({ success: false });
    await expect(
      processOutboxEvent(event("LONGFORM_SCHEDULED"))
    ).rejects.toThrow("Failed to enqueue longform post job");

    enqueue.mockResolvedValueOnce({ success: false, error: "already exists" });
    await expect(processOutboxEvent(event("POST_SCHEDULED"))).rejects.toThrow(
      "already exists"
    );

    enqueue.mockResolvedValueOnce({ success: false, error: "" });
    const thrown = await processOutboxEvent(event("POST_SCHEDULED")).then(
      () => null,
      (error: unknown) => error
    );
    if (!(thrown instanceof Error)) throw new Error("expected enqueue error");
    expect(thrown.message).toBe("");
  });
});

describe("cancelled outbox events", () => {
  beforeEach(() => {
    cancelByJobId.mockReset();
    logInfo.mockReset();
  });

  it("cancels the matching queue and ignores a missing job", async () => {
    cancelByJobId.mockResolvedValueOnce(true);
    await processOutboxEvent(event("POST_CANCELLED", { payload: null }));
    expect(cancelByJobId).toHaveBeenCalledWith("scheduled-posts", "agg-1");
    expect(infoContext("Cancelled job from outbox")).toEqual({
      postId: "agg-1",
      outboxEventId: "evt-1",
      correlationId: "corr-event",
      eventType: "POST_CANCELLED",
    });

    logInfo.mockClear();
    cancelByJobId.mockResolvedValueOnce(false);
    await processOutboxEvent(
      event("LONGFORM_CANCELLED", {
        correlationId: null,
        aggregateId: "long-1",
      })
    );
    expect(cancelByJobId).toHaveBeenCalledWith(
      "scheduled-longform-posts",
      "long-1"
    );
    expect(logInfo).not.toHaveBeenCalled();
  });
});

describe("delete outbox events", () => {
  const postPayload = {
    postId: "post-1",
    userId: "user-1",
    originalEventId: "original-event",
    originalEventPubkey: "signer-pk",
    reason: "spam",
    schemaVersion: "1.0",
    correlationId: "corr-delete",
  };
  const longformPayload = {
    postId: "post-1",
    userId: "user-1",
    aCoordinate: "30023:signer-pk:slug",
    originalEventId: "original-event",
    originalEventPubkey: "signer-pk",
    reason: "spam",
    schemaVersion: "1.0",
    correlationId: "corr-delete",
  };

  beforeEach(() => {
    envState.NOSTR_NSEC = "nsec-secret";
    buildPostKind5DeleteDraft.mockReset();
    buildLongFormKind5DeleteDraft.mockReset();
    getPublicKey.mockReset();
    finalizeEvent.mockReset();
    resolveExecutionRelays.mockReset();
    publish.mockReset();
    persistPublishRelayAcks.mockReset();
    logInfo.mockReset();
    logError.mockReset();
    buildPostKind5DeleteDraft.mockReturnValue(DRAFT);
    buildLongFormKind5DeleteDraft.mockReturnValue(DRAFT);
    getPublicKey.mockReturnValue("signer-pk");
    finalizeEvent.mockReturnValue(DELETE_EVENT);
    resolveExecutionRelays.mockResolvedValue(["wss://relay.example"]);
    publish.mockResolvedValue({
      results: [{ relay: "wss://relay.example", ok: true }],
    });
    persistPublishRelayAcks.mockResolvedValue(undefined);
  });

  it("rejects a post delete payload that is not a complete object", async () => {
    await expect(
      processOutboxEvent(event("POST_DELETE_REQUESTED", { payload: null }))
    ).rejects.toThrow("Invalid delete payload: expected object");
    await expect(
      processOutboxEvent(event("POST_DELETE_REQUESTED", { payload: ["nope"] }))
    ).rejects.toThrow("Invalid delete payload: missing required fields");
    await expect(
      processOutboxEvent(
        event("POST_DELETE_REQUESTED", {
          payload: { ...postPayload, originalEventId: 12 },
        })
      )
    ).rejects.toThrow("Invalid delete payload: missing required fields");
  });

  it("publishes a post delete and omits non-string optional fields", async () => {
    await processOutboxEvent(
      event("POST_DELETE_REQUESTED", {
        payload: { ...postPayload, reason: 12, correlationId: 12 },
        correlationId: "corr-event",
      })
    );

    expect(buildPostKind5DeleteDraft).toHaveBeenCalledWith(
      {
        postId: "post-1",
        userId: "user-1",
        originalEventId: "original-event",
        originalEventPubkey: "signer-pk",
        reason: undefined,
        schemaVersion: "1.0",
        correlationId: undefined,
      },
      CREATED_AT_SEC
    );
    expect(getPublicKey).toHaveBeenCalledWith("nsec-secret");
    expect(finalizeEvent).toHaveBeenCalledWith(
      DRAFT.unsignedEvent,
      "nsec-secret"
    );
    expect(resolveExecutionRelays).toHaveBeenCalledWith("user-1");
    expect(publish).toHaveBeenCalledWith(
      DELETE_EVENT,
      ["wss://relay.example"],
      "corr-event"
    );
    expect(persistPublishRelayAcks).toHaveBeenCalledWith({
      publishAttemptId: "delete:post-1:original-event",
      userId: "user-1",
      eventId: "delete-id",
      results: [{ relay: "wss://relay.example", ok: true }],
    });
    expect(
      infoContext("Published post delete request to relays")?.["deleteEventId"]
    ).toBe("delete-id");
  });

  it("stops when the signer, draft, or relays cannot complete a post delete", async () => {
    envState.NOSTR_NSEC = "   ";
    await expect(
      processOutboxEvent(
        event("POST_DELETE_REQUESTED", { payload: postPayload })
      )
    ).rejects.toThrow("NOSTR_NSEC not configured for delete event signing");

    envState.NOSTR_NSEC = undefined;
    await expect(
      processOutboxEvent(
        event("POST_DELETE_REQUESTED", { payload: postPayload })
      )
    ).rejects.toThrow("NOSTR_NSEC not configured for delete event signing");

    envState.NOSTR_NSEC = "nsec-secret";
    buildPostKind5DeleteDraft.mockReturnValueOnce(null);
    await expect(
      processOutboxEvent(
        event("POST_DELETE_REQUESTED", { payload: postPayload })
      )
    ).rejects.toThrow("Invalid delete payload: could not build kind5 draft");

    getPublicKey.mockReturnValueOnce("other-pk");
    await expect(
      processOutboxEvent(
        event("POST_DELETE_REQUESTED", { payload: postPayload })
      )
    ).rejects.toThrow("Delete signer pubkey mismatch");

    publish.mockResolvedValueOnce({
      results: [
        { relay: "wss://a", ok: false, error: "timeout" },
        { relay: "wss://b", ok: false },
      ],
    });
    await expect(
      processOutboxEvent(
        event("POST_DELETE_REQUESTED", { payload: postPayload })
      )
    ).rejects.toThrow("Publish failed on all relays: timeout");

    publish.mockResolvedValueOnce({
      results: [{ relay: "wss://a", ok: false }],
    });
    await expect(
      processOutboxEvent(
        event("POST_DELETE_REQUESTED", { payload: postPayload })
      )
    ).rejects.toThrow(
      "Publish failed on all relays: no relay accepted the event. Check Network settings and try again."
    );
  });

  it("logs post ack persistence failures and still publishes when one relay accepts", async () => {
    persistPublishRelayAcks.mockRejectedValueOnce(new Error("ack db down"));
    publish.mockResolvedValueOnce({
      results: [
        { relay: "wss://a", ok: false, error: "closed" },
        { relay: "wss://b", ok: true },
      ],
    });
    await processOutboxEvent(
      event("POST_DELETE_REQUESTED", { payload: postPayload })
    );
    expect(logError.mock.calls[0]?.[0].message).toBe("ack db down");
    expect(logError.mock.calls[0]?.[1]?.["message"]).toBe(
      "Failed to persist post delete relay ACKs"
    );

    persistPublishRelayAcks.mockRejectedValueOnce("ack-string");
    publish.mockResolvedValueOnce({ results: [] });
    await processOutboxEvent(
      event("POST_DELETE_REQUESTED", { payload: postPayload })
    );
    const wrapped = logError.mock.calls[1]?.[0];
    if (!(wrapped instanceof Error))
      throw new Error("expected wrapped ack error");
    expect(wrapped.message).toBe("ack-string");
    expect(
      infoContext("Published post delete request to relays")
    ).toBeDefined();
  });

  it("publishes a longform delete and rejects an incomplete payload", async () => {
    await expect(
      processOutboxEvent(
        event("LONGFORM_DELETE_REQUESTED", { payload: "nope" })
      )
    ).rejects.toThrow("Invalid delete payload: expected object");
    await expect(
      processOutboxEvent(
        event("LONGFORM_DELETE_REQUESTED", {
          payload: { ...longformPayload, aCoordinate: 1 },
        })
      )
    ).rejects.toThrow("Invalid delete payload: missing required fields");

    await processOutboxEvent(
      event("LONGFORM_DELETE_REQUESTED", {
        payload: { ...longformPayload, originalEventId: 4, reason: false },
        correlationId: null,
      })
    );
    expect(buildLongFormKind5DeleteDraft).toHaveBeenCalledWith(
      {
        postId: "post-1",
        userId: "user-1",
        aCoordinate: "30023:signer-pk:slug",
        originalEventId: undefined,
        originalEventPubkey: "signer-pk",
        reason: undefined,
        schemaVersion: "1.0",
        correlationId: "corr-delete",
      },
      CREATED_AT_SEC
    );
    expect(persistPublishRelayAcks).toHaveBeenCalledWith({
      publishAttemptId: "delete:post-1:30023:signer-pk:slug",
      userId: "user-1",
      eventId: "delete-id",
      results: [{ relay: "wss://relay.example", ok: true }],
    });
    expect(publish).toHaveBeenCalledWith(
      DELETE_EVENT,
      ["wss://relay.example"],
      "corr-delete"
    );
  });

  it("covers longform signer, draft, relay, and ack failure arms", async () => {
    envState.NOSTR_NSEC = "";
    await expect(
      processOutboxEvent(
        event("LONGFORM_DELETE_REQUESTED", { payload: longformPayload })
      )
    ).rejects.toThrow("NOSTR_NSEC not configured");

    envState.NOSTR_NSEC = "nsec-secret";
    buildLongFormKind5DeleteDraft.mockReturnValueOnce(null);
    await expect(
      processOutboxEvent(
        event("LONGFORM_DELETE_REQUESTED", { payload: longformPayload })
      )
    ).rejects.toThrow("could not build kind5 draft");

    getPublicKey.mockReturnValueOnce("nope");
    await expect(
      processOutboxEvent(
        event("LONGFORM_DELETE_REQUESTED", { payload: longformPayload })
      )
    ).rejects.toThrow("Delete signer pubkey mismatch");

    persistPublishRelayAcks.mockRejectedValueOnce(new Error("long ack"));
    publish.mockResolvedValueOnce({
      results: [{ relay: "wss://a", ok: false, error: "rejected" }],
    });
    await expect(
      processOutboxEvent(
        event("LONGFORM_DELETE_REQUESTED", { payload: longformPayload })
      )
    ).rejects.toThrow("Publish failed on all relays: rejected");
    expect(logError.mock.calls[0]?.[1]?.["message"]).toBe(
      "Failed to persist longform delete relay ACKs"
    );
  });
});

describe("read-model and unknown outbox events", () => {
  it.each([
    "POST_CREATED",
    "POST_UPDATED",
    "POST_PUBLISHED",
    "POST_DELETED",
    "LONGFORM_CREATED",
    "LONGFORM_UPDATED",
    "LONGFORM_PUBLISHED",
    "LONGFORM_DELETED",
  ] as const)("does nothing for %s", async (eventType) => {
    enqueue.mockClear();
    cancelByJobId.mockClear();
    await expect(processOutboxEvent(event(eventType))).resolves.toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
    expect(cancelByJobId).not.toHaveBeenCalled();
  });

  it("throws for an event type outside the known union", async () => {
    const unexpected: OutboxEvent = {
      id: "evt-x",
      eventType: "NOT_A_REAL_TYPE",
      aggregateId: "agg-x",
      payload: null,
      createdAt: CREATED_AT,
      scheduledFor: null,
    };
    const thrown = await processOutboxEvent(
      // @ts-expect-error unexpected stored event type should hit the default arm
      unexpected
    ).then(
      () => null,
      (error: unknown) => error
    );
    if (!(thrown instanceof Error)) throw new Error("expected unknown type");
    expect(thrown.message).toBe("Unknown event type: NOT_A_REAL_TYPE");
    expect(isDefinitelyNonRetryableOutboxError(thrown)).toBe(true);
  });
});
