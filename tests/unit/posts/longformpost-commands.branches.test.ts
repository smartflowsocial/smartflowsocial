// @ts-nocheck -- mocked collaborators are narrower than the production types.
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

interface CreateArgs {
  data: Record<string, unknown>;
}

interface FindArgs {
  where: { id: string; userId: string };
}

interface TransitionOptions {
  additionalPostData?: Record<string, unknown>;
}

interface TxClient {
  longFormPost: {
    delete: (args: FindArgs) => Promise<{ id: string; userId: string }>;
  };
}

interface UpdateArgs {
  data: Record<string, unknown>;
  where: { id: string; userId: string };
}

interface DeleteEnv {
  ENABLE_NOSTR_DELETE_EVENTS: string | undefined;
}

interface CalculatorModule {
  calculateLongFormStatus: (input: {
    isPublished: boolean;
    scheduledFor?: string | null;
    signedEvent?: Record<string, unknown> | null;
  }) => {
    finalScheduledFor: string | null;
    nostrEventId: string | null;
    publishedAt: Date | null;
    status: string;
  };
}

const envState = vi.hoisted(() => {
  const state: DeleteEnv = { ENABLE_NOSTR_DELETE_EVENTS: "" };
  return state;
});

const logger = vi.hoisted(() => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

const machines = vi.hoisted(() => ({
  transition: vi.fn<
    (
      id: string,
      userId: string,
      state: string,
      reason: string,
      options?: TransitionOptions
    ) => Promise<void>
  >(async () => undefined),
}));

const outbox = vi.hoisted(() => ({
  createOutboxEventInTransaction: vi.fn<
    (
      tx: unknown,
      eventType: string,
      id: string,
      model: string,
      payload: Record<string, unknown>,
      fifth?: unknown,
      sixth?: unknown,
      correlationId?: string
    ) => Promise<void>
  >(async () => undefined),
}));

const db = vi.hoisted(() => ({
  create: vi.fn<(args: CreateArgs) => Promise<{ id: string }>>(async () => ({
    id: "created",
  })),
  findUnique: vi.fn<(args: FindArgs) => Promise<unknown>>(async () => null),
  transaction: vi.fn<
    (fn: (tx: TxClient) => Promise<unknown>) => Promise<unknown>
  >(async (fn) => fn(txClient)),
  update: vi.fn<(args: UpdateArgs) => Promise<{ id: string }>>(
    async (args) => ({
      id: args.where.id,
    })
  ),
}));

const deletePost = vi.fn(async (_args: FindArgs) => ({
  id: "lf-1",
  userId: "user-1",
}));

const txClient: TxClient = {
  longFormPost: {
    delete: deletePost,
  },
};

vi.mock("~/lib/env.server", () => ({ env: envState }));
vi.mock("~/lib/error-logger.server", () => logger);
vi.mock("~/infra/outbox/outbox.server", () => outbox);
vi.mock("~/lib/prisma.server", () => ({
  prisma: {
    $transaction: db.transaction,
    longFormPost: {
      create: db.create,
      findUnique: db.findUnique,
      update: db.update,
    },
  },
}));
vi.mock("~/features/posts/server/longform", async () => {
  const calculator = await vi.importActual<CalculatorModule>(
    "~/features/posts/longform/services/longform-status-calculator.server"
  );
  return {
    calculateLongFormStatus: calculator.calculateLongFormStatus,
    LongFormPostStateMachine: class LongFormPostStateMachine {
      transition = machines.transition;
    },
  };
});

import {
  createLongFormPost,
  deleteLongFormPost,
  publishLongFormPost,
  updateLongFormPost,
} from "~/features/posts/data/longformpost.commands.server";

const USER = "user-1";
const POST = "lf-1";
const PUBKEY = "ab".repeat(32);

function signed(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "evt-1",
    pubkey: PUBKEY,
    created_at: 1_700_000_000,
    kind: 30023,
    content: "body",
    tags: [
      ["d", "slug"],
      ["published_at", "1700000000"],
    ],
    sig: "sig",
    ...extra,
  };
}

function scheduleValue(value: string): Date | number | null | undefined {
  return value as unknown as Date;
}

function tagsValue(value: string): string[] {
  return value as unknown as string[];
}

function createdData(): Record<string, unknown> {
  const data = db.create.mock.calls.at(-1)?.[0]?.data;
  if (!data) throw new Error("expected create");
  return data;
}

function updatedData(): Record<string, unknown> {
  const data = db.update.mock.calls.at(-1)?.[0]?.data;
  if (!data) throw new Error("expected update");
  return data;
}

function recent(value: unknown): void {
  expect(value).toBeInstanceOf(Date);
  if (value instanceof Date) {
    expect(Math.abs(value.getTime() - Date.now())).toBeLessThan(5000);
  }
}

describe("longform post command branches", () => {
  beforeEach(() => {
    envState.ENABLE_NOSTR_DELETE_EVENTS = "";
    db.create.mockClear();
    db.findUnique.mockReset();
    db.findUnique.mockResolvedValue(null);
    db.update.mockClear();
    db.transaction.mockClear();
    machines.transition.mockClear();
    outbox.createOutboxEventInTransaction.mockReset();
    outbox.createOutboxEventInTransaction.mockResolvedValue(undefined);
    logger.logError.mockReset();
    logger.logInfo.mockReset();
    deletePost.mockClear();
  });

  it("creates drafts, scheduled articles, and published articles", async () => {
    await expect(
      createLongFormPost({
        userId: USER,
        title: "Draft",
        content: "Body",
        hashTagPresetId: "preset-1",
        queueTypeId: "queue-1",
      })
    ).resolves.toEqual({ id: "created" });
    expect(createdData()).toMatchObject({
      userId: USER,
      title: "Draft",
      content: "Body",
      tags: [],
      status: "DRAFT",
      currentState: "DRAFT",
      postedAt: null,
      nostrEventId: null,
      hashTagPresetId: "preset-1",
      queueTypeId: "queue-1",
    });
    expect(createdData()["scheduledAtUtc"]).toBeUndefined();

    const when = new Date("2026-03-01T00:00:00.000Z");
    await createLongFormPost({
      userId: USER,
      title: "Later",
      content: "Body",
      summary: "Sum",
      image: "https://cdn.example/a.png",
      tags: ["nostr"],
      scheduledAtUtc: when,
      nostrEvent: { id: "raw" },
      signedEvent: signed({ tags: [["d", "slug"]] }),
    });
    expect(createdData()).toMatchObject({
      status: "SCHEDULED",
      currentState: "SCHEDULED",
      postedAt: null,
      tags: ["nostr"],
      summary: "Sum",
      image: "https://cdn.example/a.png",
      nostrEventId: "evt-1",
      scheduledAtUtc: when,
    });

    await createLongFormPost({
      userId: USER,
      title: "Live",
      content: "Body",
      isPublished: true,
      scheduledAtUtc: 1_700_000_000,
      signedEvent: signed(),
    });
    expect(createdData()).toMatchObject({
      status: "ACTIVE",
      currentState: "PUBLISHED",
      nostrEventId: "evt-1",
      scheduledAtUtc: new Date(1_700_000_000 * 1000),
    });
    recent(createdData()["postedAt"]);
    expect(createdData()["publishedAt"]).toBeInstanceOf(Date);

    await createLongFormPost({
      userId: USER,
      title: "Bad time",
      content: "Body",
      signedEvent: signed({
        tags: [
          ["published_at", "nope"],
          ["d", "slug"],
        ],
      }),
    });
    expect(createdData()).toMatchObject({
      status: "SCHEDULED",
      currentState: "SCHEDULED",
      postedAt: null,
    });
    expect(createdData()["scheduledAtUtc"]).toBeUndefined();

    await createLongFormPost({
      userId: USER,
      title: "Number",
      content: "Body",
      scheduledAtUtc: null,
    });
    expect(createdData()["currentState"]).toBe("DRAFT");

    await createLongFormPost({
      userId: USER,
      title: "Weird",
      content: "Body",
      scheduledAtUtc: scheduleValue("nope"),
    });
    expect(createdData()["currentState"]).toBe("DRAFT");
  });

  it("updates fields, queue links, events, and state transitions", async () => {
    await updateLongFormPost({
      id: POST,
      userId: USER,
      title: "Title",
      summary: null,
      content: "Body",
      image: null,
    });
    expect(machines.transition).not.toHaveBeenCalled();
    expect(updatedData()).toMatchObject({
      title: "Title",
      summary: null,
      content: "Body",
      image: null,
    });
    expect("queueHoldStatus" in updatedData()).toBe(false);
    expect("tags" in updatedData()).toBe(false);
    expect("queueType" in updatedData()).toBe(false);

    await updateLongFormPost({
      id: POST,
      userId: USER,
      tags: tagsValue(" a, b, , c "),
      queueTypeId: null,
      signedEvent: null,
      nostrEvent: { id: "raw" },
    });
    expect(updatedData()).toMatchObject({
      tags: ["a", "b", "c"],
      queueType: { disconnect: true },
      queueHoldStatus: "NONE",
      queueHeldAtUtc: null,
      queueHeldOriginalScheduledAtUtc: null,
      queueHeldByQueueTypeId: null,
      signedEvent: null,
      nostrEventId: null,
      nostrEvent: { id: "raw" },
    });

    await updateLongFormPost({
      id: POST,
      userId: USER,
      tags: ["ignored"],
      queueTypeId: "queue-9",
      signedEvent: signed({ id: 5 }),
    });
    expect("tags" in updatedData()).toBe(false);
    expect(updatedData()["queueType"]).toEqual({ connect: { id: "queue-9" } });
    expect(updatedData()["nostrEventId"]).toBe("5");

    await updateLongFormPost({
      id: POST,
      userId: USER,
      signedEvent: "raw-event",
    });
    expect(updatedData()["nostrEventId"]).toBeNull();
    expect(updatedData()["signedEvent"]).toBe("raw-event");

    await updateLongFormPost({
      id: POST,
      userId: USER,
      isPublished: false,
    });
    expect(machines.transition).toHaveBeenCalledWith(
      POST,
      USER,
      "DRAFT",
      "Longform post saved as draft"
    );
    expect(updatedData()["status"]).toBe("DRAFT");

    await updateLongFormPost({
      id: POST,
      userId: USER,
      scheduledAtUtc: scheduleValue("nope"),
      signedEvent: signed({ tags: [["published_at", "1700001111"]] }),
    });
    expect(machines.transition).toHaveBeenCalledWith(
      POST,
      USER,
      "SCHEDULED",
      "Longform post scheduled"
    );
    expect(updatedData()["scheduledAtUtc"]).toEqual(
      new Date(1_700_001_111 * 1000)
    );
    expect(updatedData()["status"]).toBe("SCHEDULED");
    expect(updatedData()["publishedAt"]).toEqual(
      new Date(1_700_001_111 * 1000)
    );

    await updateLongFormPost({
      id: POST,
      userId: USER,
      isPublished: true,
      scheduledAtUtc: 1_700_000_000,
      signedEvent: signed({ published_at: 1_700_002_222 }),
    });
    expect(machines.transition).toHaveBeenCalledWith(
      POST,
      USER,
      "PUBLISHED",
      "Longform post published"
    );
    expect(updatedData()["status"]).toBe("ACTIVE");
    expect(updatedData()["publishedAt"]).toEqual(
      new Date(1_700_002_222 * 1000)
    );
    expect(updatedData()["scheduledAtUtc"]).toEqual(
      new Date(1_700_000_000 * 1000)
    );
    recent(updatedData()["postedAt"]);

    await updateLongFormPost({
      id: POST,
      userId: USER,
      isPublished: true,
      signedEvent: { hello: true },
    });
    recent(updatedData()["publishedAt"]);

    await updateLongFormPost({
      id: POST,
      userId: USER,
      scheduledAtUtc: null,
    });
    expect(updatedData()["scheduledAtUtc"]).toBeNull();
    expect(updatedData()["status"]).toBe("DRAFT");

    await updateLongFormPost({
      id: POST,
      userId: USER,
      isPublished: false,
      signedEvent: signed({ tags: [["published_at", "not-a-time"]] }),
    });
    expect(updatedData()["scheduledAtUtc"]).toBeNull();
    expect(updatedData()["status"]).toBe("SCHEDULED");
    expect(updatedData()["publishedAt"]).toBeInstanceOf(Date);
    const publishedAt = updatedData()["publishedAt"];
    if (publishedAt instanceof Date) {
      expect(Number.isNaN(publishedAt.getTime())).toBe(true);
    }
  });

  it("deletes a missing article without writing an outbox row", async () => {
    await expect(
      deleteLongFormPost({ id: POST, userId: USER, correlationId: "corr" })
    ).resolves.toBeNull();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("deletes without a nostr delete request when the flag or metadata is missing", async () => {
    db.findUnique.mockResolvedValue({
      id: POST,
      userId: USER,
      signedEvent: signed({ tags: [] }),
      nostrEvent: null,
      nostrEventId: null,
    });
    await expect(
      deleteLongFormPost({ id: POST, userId: USER })
    ).resolves.toEqual({
      id: POST,
      userId: USER,
    });
    expect(outbox.createOutboxEventInTransaction).toHaveBeenCalledTimes(1);
    expect(outbox.createOutboxEventInTransaction.mock.calls[0]?.[1]).toBe(
      "LONGFORM_DELETED"
    );
    expect(logger.logInfo).not.toHaveBeenCalled();

    envState.ENABLE_NOSTR_DELETE_EVENTS = "true";
    logger.logInfo.mockClear();
    outbox.createOutboxEventInTransaction.mockClear();
    await deleteLongFormPost({ id: POST, userId: USER, correlationId: "corr" });
    expect(outbox.createOutboxEventInTransaction).toHaveBeenCalledTimes(1);
    expect(logger.logInfo.mock.calls[0]?.[0]).toContain("missing metadata");
  });

  it("writes a delete request and swallows a constraint error", async () => {
    envState.ENABLE_NOSTR_DELETE_EVENTS = "yes";
    db.findUnique.mockResolvedValue({
      id: POST,
      userId: USER,
      signedEvent: signed(),
      nostrEvent: { id: "evt-1", pubkey: PUBKEY, tags: [["d", "slug"]] },
      nostrEventId: "evt-1",
    });
    await deleteLongFormPost({ id: POST, userId: USER, correlationId: "corr" });
    expect(txClient.longFormPost.delete).toHaveBeenCalledWith({
      where: { id: POST, userId: USER },
    });
    expect(outbox.createOutboxEventInTransaction).toHaveBeenCalledTimes(2);
    const request = outbox.createOutboxEventInTransaction.mock.calls[1];
    expect(request?.[0]).toBe(txClient);
    expect(request?.[1]).toBe("LONGFORM_DELETE_REQUESTED");
    expect(request?.[4]).toMatchObject({
      postId: POST,
      userId: USER,
      originalEventId: "evt-1",
      originalEventPubkey: PUBKEY,
      aCoordinate: `30023:${PUBKEY}:slug`,
      correlationId: "corr",
    });
    expect(request?.[7]).toBe("corr");
    expect(logger.logInfo).not.toHaveBeenCalled();

    outbox.createOutboxEventInTransaction.mockImplementation(
      async (_tx, eventType) => {
        if (eventType === "LONGFORM_DELETE_REQUESTED") {
          throw new Error("OutboxEvent_eventType_check");
        }
      }
    );
    logger.logInfo.mockClear();
    await expect(
      deleteLongFormPost({ id: POST, userId: USER })
    ).resolves.toEqual({ id: POST, userId: USER });
    expect(String(logger.logInfo.mock.calls[0]?.[0])).toContain(
      "DB constraint not yet updated"
    );
  });

  it("logs and rethrows delete failures from Error and string throws", async () => {
    envState.ENABLE_NOSTR_DELETE_EVENTS = "on";
    db.findUnique.mockResolvedValue({
      id: POST,
      userId: USER,
      signedEvent: signed(),
      nostrEvent: null,
      nostrEventId: "evt-1",
    });
    const failure = new Error("delete failed");
    db.transaction.mockRejectedValueOnce(failure);
    await expect(deleteLongFormPost({ id: POST, userId: USER })).rejects.toBe(
      failure
    );
    expect(logger.logError.mock.calls[0]?.[0]).toBe(failure);

    db.transaction.mockRejectedValueOnce("delete string");
    await expect(
      deleteLongFormPost({ id: POST, userId: USER, correlationId: "corr" })
    ).rejects.toBe("delete string");
    const logged: unknown = logger.logError.mock.calls.at(-1)?.[0];
    expect(logged).toBeInstanceOf(Error);
    if (logged instanceof Error) expect(logged.message).toBe("delete string");
    expect(logger.logError.mock.calls.at(-1)?.[1]).toMatchObject({
      postId: POST,
      userId: USER,
      correlationId: "corr",
    });

    db.transaction.mockImplementation(async (fn) => fn(txClient));
    outbox.createOutboxEventInTransaction.mockImplementation(
      async (_tx, eventType) => {
        if (eventType === "LONGFORM_DELETE_REQUESTED") throw "inner";
      }
    );
    await expect(deleteLongFormPost({ id: POST, userId: USER })).rejects.toBe(
      "inner"
    );
  });

  it("publishes with and without signed event metadata", async () => {
    db.findUnique.mockResolvedValue({ id: POST, userId: USER });
    const event = signed();
    await expect(
      publishLongFormPost({
        id: POST,
        userId: USER,
        signedEvent: event,
        nostrEvent: { id: "raw" },
      })
    ).resolves.toEqual({ id: POST, userId: USER });
    const options = machines.transition.mock.calls[0]?.[4];
    expect(machines.transition.mock.calls[0]?.slice(0, 4)).toEqual([
      POST,
      USER,
      "PUBLISHED",
      "Longform post published",
    ]);
    expect(options?.additionalPostData).toMatchObject({
      status: "ACTIVE",
      nostrEventId: "evt-1",
      publishAttemptId: createHash("sha256")
        .update(`publish:${POST}:1700000000:0`)
        .digest("hex"),
      signedEvent: event,
      nostrEvent: { id: "raw" },
      publishingLockId: null,
      publishingLockExpiresAt: null,
    });
    recent(options?.additionalPostData?.["publishedAt"]);
    recent(options?.additionalPostData?.["postedAt"]);

    await publishLongFormPost({
      id: POST,
      userId: USER,
      signedEvent: { id: 4, created_at: "nope" },
      nostrEvent: null,
    });
    expect(
      machines.transition.mock.calls.at(-1)?.[4]?.additionalPostData
    ).toMatchObject({
      nostrEventId: null,
      publishAttemptId: null,
    });

    await publishLongFormPost({
      id: POST,
      userId: USER,
      signedEvent: null,
      nostrEvent: null,
    });
    expect(
      machines.transition.mock.calls.at(-1)?.[4]?.additionalPostData?.[
        "nostrEventId"
      ]
    ).toBeNull();

    db.findUnique.mockResolvedValueOnce(null);
    await expect(
      publishLongFormPost({
        id: POST,
        userId: USER,
        signedEvent: event,
        nostrEvent: null,
      })
    ).rejects.toThrow(`LongFormPost ${POST} not found for user ${USER}`);
  });
});
