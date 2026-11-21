import {
  BroadcastCampaignStatus,
  BroadcastRecipientDeliveryMethod,
  BroadcastRecipientStatus,
} from "@prisma/client";
import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  broadcastRecipient: { update: vi.fn() },
  broadcastCampaign: { update: vi.fn() },
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) =>
    work(tx)
  ),
  broadcastRecipient: {
    findFirst: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  broadcastCampaign: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  broadcastEventLog: { create: vi.fn() },
}));

const publishApi = vi.hoisted(() => ({
  publishSignedEventToRelays: vi.fn(),
}));

const relaysApi = vi.hoisted(() => ({
  resolveExecutionRelays: vi.fn(),
}));

const messenger = vi.hoisted(() => ({
  giftWrapRecipientPubkeyHex: vi.fn(),
  relaysForNip17GiftWrap: vi.fn(),
  resolveCachedKind10050InboxRelays: vi.fn(),
  resolveDmRelaysSafe: vi.fn(),
}));

const validation = vi.hoisted(() => ({
  validateSignedEventCryptographically: vi.fn(),
}));

const logs = vi.hoisted(() => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));
vi.mock("~/features/nostr/publish-event.server", () => publishApi);
vi.mock("~/features/relays/relay-resolution.server", () => relaysApi);
vi.mock("~/lib/nostr.messenger.server", () => messenger);
vi.mock("~/lib/validation/nostr-cryptographic.server", () => validation);
vi.mock("~/lib/error-logger.server", () => logs);

import { anyDate, objectContaining } from "./action-error";

import { runBroadcastDmJob } from "~/features/broadcast/broadcast-job.server";
import type { SignedEvent } from "~/features/nostr/types";
import type { BroadcastJobData } from "~/infra/queue/queue-types";

const CAMPAIGN_ID = "camp-1";
const RECIPIENT_ID = "rec-1";
const USER_ID = "user-1";
const SENDER = "a".repeat(64);
const RECEIVER = "b".repeat(64);

function isValidatedEvent(event: unknown): event is SignedEvent {
  if (!event || typeof event !== "object") return false;
  if (!("id" in event) || typeof event.id !== "string") return false;
  if (!("pubkey" in event) || typeof event.pubkey !== "string") return false;
  if (!("created_at" in event) || typeof event.created_at !== "number") {
    return false;
  }
  if (!("kind" in event) || typeof event.kind !== "number") return false;
  if (!("tags" in event) || !Array.isArray(event.tags)) return false;
  if (!("content" in event) || typeof event.content !== "string") return false;
  if (!("sig" in event) || typeof event.sig !== "string") return false;
  return true;
}

function signedEvent(id = "evt-1"): SignedEvent {
  return {
    id,
    pubkey: SENDER,
    created_at: 1_700_000_000,
    kind: 4,
    tags: [["p", RECEIVER]],
    content: "hello",
    sig: "sig",
  };
}

function broadcastJob(): Job<BroadcastJobData> {
  const stub = {
    data: {
      campaignId: CAMPAIGN_ID,
      recipientId: RECIPIENT_ID,
      userId: USER_ID,
    },
  };
  return stub as unknown as Job<BroadcastJobData>;
}

function recipientRow(overrides?: {
  status?: string;
  campaignStatus?: string;
  userId?: string;
  signedEvent?: unknown;
  giftWraps?: unknown;
  publishRelays?: string[];
  publishedNip04EventId?: string | null;
  recipientPubkey?: string;
}) {
  const hasSignedEvent =
    overrides !== undefined &&
    Object.prototype.hasOwnProperty.call(overrides, "signedEvent");
  return {
    id: RECIPIENT_ID,
    campaignId: CAMPAIGN_ID,
    recipientPubkey: overrides?.recipientPubkey ?? RECEIVER,
    status: overrides?.status ?? BroadcastRecipientStatus.QUEUED,
    signedEvent: hasSignedEvent ? overrides.signedEvent : signedEvent(),
    giftWraps: overrides?.giftWraps ?? null,
    publishRelays: overrides?.publishRelays ?? ["wss://direct.example"],
    publishedNip04EventId: overrides?.publishedNip04EventId ?? null,
    campaign: {
      id: CAMPAIGN_ID,
      userId: overrides?.userId ?? USER_ID,
      status: overrides?.campaignStatus ?? BroadcastCampaignStatus.QUEUED,
    },
  };
}

describe("runBroadcastDmJob", () => {
  beforeEach(() => {
    prismaMock.broadcastRecipient.findFirst.mockReset();
    prismaMock.broadcastRecipient.update.mockReset();
    prismaMock.broadcastRecipient.count.mockReset();
    prismaMock.broadcastCampaign.findUnique.mockReset();
    prismaMock.broadcastCampaign.update.mockReset();
    prismaMock.broadcastEventLog.create.mockReset();
    tx.broadcastRecipient.update.mockReset();
    tx.broadcastCampaign.update.mockReset();
    publishApi.publishSignedEventToRelays.mockReset();
    relaysApi.resolveExecutionRelays.mockReset();
    messenger.giftWrapRecipientPubkeyHex.mockReset();
    messenger.relaysForNip17GiftWrap.mockReset();
    messenger.resolveCachedKind10050InboxRelays.mockReset();
    messenger.resolveDmRelaysSafe.mockReset();
    validation.validateSignedEventCryptographically.mockReset();
    logs.logError.mockReset();
    logs.logInfo.mockReset();

    prismaMock.broadcastRecipient.findFirst.mockResolvedValue(null);
    prismaMock.broadcastRecipient.update.mockResolvedValue({
      id: RECIPIENT_ID,
    });
    prismaMock.broadcastRecipient.count.mockResolvedValue(0);
    prismaMock.broadcastCampaign.findUnique.mockResolvedValue({
      status: BroadcastCampaignStatus.QUEUED,
      failedCount: 0,
    });
    prismaMock.broadcastCampaign.update.mockResolvedValue({ id: CAMPAIGN_ID });
    prismaMock.broadcastEventLog.create.mockResolvedValue({ id: "log-1" });
    tx.broadcastRecipient.update.mockResolvedValue({ id: RECIPIENT_ID });
    tx.broadcastCampaign.update.mockResolvedValue({ id: CAMPAIGN_ID });
    publishApi.publishSignedEventToRelays.mockResolvedValue({
      results: [{ ok: true }],
    });
    relaysApi.resolveExecutionRelays.mockResolvedValue(["wss://user.example"]);
    messenger.resolveDmRelaysSafe.mockResolvedValue(["wss://dm.example"]);
    messenger.resolveCachedKind10050InboxRelays.mockResolvedValue([
      "wss://inbox.example",
    ]);
    messenger.relaysForNip17GiftWrap.mockResolvedValue(["wss://nip17.example"]);
    messenger.giftWrapRecipientPubkeyHex.mockReturnValue(RECEIVER);
    validation.validateSignedEventCryptographically.mockImplementation(
      (event: unknown) => {
        if (!isValidatedEvent(event) || event.id === "bad") {
          throw new Error("invalid signature");
        }
        return event;
      }
    );
  });

  it("skips a missing recipient and a recipient owned by someone else", async () => {
    await expect(runBroadcastDmJob(broadcastJob())).resolves.toEqual({
      success: true,
      skipped: true,
    });
    expect(logs.logInfo).toHaveBeenCalledWith(
      "broadcast_dm_skip_missing_recipient",
      { recipientId: RECIPIENT_ID, campaignId: CAMPAIGN_ID }
    );

    prismaMock.broadcastRecipient.findFirst.mockResolvedValue(
      recipientRow({ userId: "other-user" })
    );
    await expect(runBroadcastDmJob(broadcastJob())).resolves.toEqual({
      success: true,
      skipped: true,
    });
    expect(publishApi.publishSignedEventToRelays).not.toHaveBeenCalled();
  });

  it("skips cancelled, paused, already sent, and failed rows", async () => {
    for (const row of [
      recipientRow({ campaignStatus: BroadcastCampaignStatus.CANCELLED }),
      recipientRow({ campaignStatus: BroadcastCampaignStatus.PAUSED }),
      recipientRow({
        status: BroadcastRecipientStatus.SENT,
        publishedNip04EventId: "evt-sent",
      }),
      recipientRow({ status: BroadcastRecipientStatus.FAILED }),
    ]) {
      prismaMock.broadcastRecipient.findFirst.mockResolvedValue(row);
      await expect(runBroadcastDmJob(broadcastJob())).resolves.toEqual({
        success: true,
        skipped: true,
      });
    }
    expect(prismaMock.broadcastRecipient.update).not.toHaveBeenCalled();
    expect(logs.logInfo).not.toHaveBeenCalled();
  });

  it("fails a recipient with no signed event and leaves a missing campaign open", async () => {
    prismaMock.broadcastRecipient.findFirst.mockResolvedValue(
      recipientRow({ signedEvent: null })
    );
    prismaMock.broadcastCampaign.findUnique.mockResolvedValue(null);

    await expect(runBroadcastDmJob(broadcastJob())).resolves.toEqual({
      success: false,
    });
    expect(prismaMock.broadcastRecipient.update).toHaveBeenCalledWith({
      where: { id: RECIPIENT_ID },
      data: {
        status: BroadcastRecipientStatus.FAILED,
        failureCode: "NO_SIGNED_EVENT",
        failureReason: "Missing signed event payload",
      },
    });
    expect(prismaMock.broadcastCampaign.update).not.toHaveBeenCalled();
    expect(prismaMock.broadcastRecipient.count).not.toHaveBeenCalled();
  });

  it("does not complete a cancelled or paused campaign after a missing event", async () => {
    prismaMock.broadcastRecipient.findFirst.mockResolvedValue(
      recipientRow({ signedEvent: undefined, giftWraps: undefined })
    );
    prismaMock.broadcastCampaign.findUnique.mockResolvedValue({
      status: BroadcastCampaignStatus.CANCELLED,
      failedCount: 0,
    });
    await expect(runBroadcastDmJob(broadcastJob())).resolves.toEqual({
      success: false,
    });

    prismaMock.broadcastCampaign.findUnique.mockResolvedValue({
      status: BroadcastCampaignStatus.PAUSED,
      failedCount: 1,
    });
    await expect(runBroadcastDmJob(broadcastJob())).resolves.toEqual({
      success: false,
    });
    expect(prismaMock.broadcastRecipient.count).not.toHaveBeenCalled();
    expect(prismaMock.broadcastCampaign.update).not.toHaveBeenCalled();
  });

  it("records an invalid event and waits while other recipients are open", async () => {
    prismaMock.broadcastRecipient.count.mockResolvedValue(2);
    validation.validateSignedEventCryptographically.mockImplementation(() => {
      throw new Error("bad signature");
    });
    prismaMock.broadcastRecipient.findFirst.mockResolvedValue(recipientRow());

    await expect(runBroadcastDmJob(broadcastJob())).resolves.toEqual({
      success: false,
    });
    expect(prismaMock.broadcastRecipient.update).toHaveBeenCalledWith({
      where: { id: RECIPIENT_ID },
      data: {
        status: BroadcastRecipientStatus.FAILED,
        failureCode: "INVALID_EVENT",
        failureReason: "bad signature",
      },
    });
    expect(prismaMock.broadcastCampaign.update).toHaveBeenCalledWith({
      where: { id: CAMPAIGN_ID },
      data: { failedCount: { increment: 1 } },
    });
    expect(prismaMock.broadcastEventLog.create).not.toHaveBeenCalled();
  });

  it("completes with failures when a non-error validation failure is the last send", async () => {
    validation.validateSignedEventCryptographically.mockImplementation(() => {
      throw "string failure";
    });
    prismaMock.broadcastRecipient.findFirst.mockResolvedValue(recipientRow());
    prismaMock.broadcastCampaign.findUnique.mockResolvedValue({
      status: BroadcastCampaignStatus.SENDING,
      failedCount: 2,
    });

    await expect(runBroadcastDmJob(broadcastJob())).resolves.toEqual({
      success: false,
    });
    expect(prismaMock.broadcastRecipient.update).toHaveBeenCalledWith({
      where: { id: RECIPIENT_ID },
      data: {
        status: BroadcastRecipientStatus.FAILED,
        failureCode: "INVALID_EVENT",
        failureReason: "string failure",
      },
    });
    expect(prismaMock.broadcastCampaign.update).toHaveBeenCalledWith({
      where: { id: CAMPAIGN_ID },
      data: {
        status: BroadcastCampaignStatus.COMPLETED_WITH_FAILURES,
        completedAt: anyDate(),
      },
    });
    expect(prismaMock.broadcastEventLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: CAMPAIGN_ID,
        level: "INFO",
        eventType: "completed_with_failures",
        message: "Delivery finished with one or more failures",
        metadataJson: { failedCount: 2 },
      },
    });
  });

  it("publishes a kind-4 DM and leaves the campaign open", async () => {
    prismaMock.broadcastRecipient.count.mockResolvedValue(1);
    prismaMock.broadcastRecipient.findFirst.mockResolvedValue(
      recipientRow({ giftWraps: { not: "an array" }, publishRelays: [] })
    );
    relaysApi.resolveExecutionRelays.mockResolvedValue([
      " wss://user.example ",
      "",
      "wss://user.example",
    ]);
    messenger.resolveDmRelaysSafe.mockResolvedValue([
      "wss://user.example",
      "wss://dm.example",
    ]);

    await expect(runBroadcastDmJob(broadcastJob())).resolves.toEqual({
      success: true,
    });
    expect(prismaMock.broadcastRecipient.update).toHaveBeenCalledWith({
      where: { id: RECIPIENT_ID },
      data: {
        status: BroadcastRecipientStatus.SENDING,
        attemptCount: { increment: 1 },
        lastAttemptAt: anyDate(),
      },
    });
    expect(publishApi.publishSignedEventToRelays).toHaveBeenCalledWith({
      signedEvent: signedEvent(),
      relays: ["wss://user.example", "wss://dm.example"],
      userId: USER_ID,
      correlationId: `broadcast:${CAMPAIGN_ID}:${RECIPIENT_ID}:k4`,
    });
    expect(tx.broadcastRecipient.update).toHaveBeenCalledWith({
      where: { id: RECIPIENT_ID },
      data: {
        status: BroadcastRecipientStatus.SENT,
        publishedNip04EventId: "evt-1",
        sentAt: anyDate(),
        failureCode: null,
        failureReason: null,
        deliveryMethodUsed: BroadcastRecipientDeliveryMethod.NIP04,
      },
    });
    expect(prismaMock.broadcastCampaign.update).not.toHaveBeenCalledWith(
      objectContaining({
        data: objectContaining({
          status: BroadcastCampaignStatus.COMPLETED,
        }),
      })
    );
  });

  it("caps merged relays at 24", async () => {
    prismaMock.broadcastRecipient.count.mockResolvedValue(1);
    const userRelays = Array.from(
      { length: 30 },
      (_, index) => ` wss://u${String(index)}.example `
    );
    relaysApi.resolveExecutionRelays.mockResolvedValue(userRelays);
    prismaMock.broadcastRecipient.findFirst.mockResolvedValue(
      recipientRow({ publishRelays: [], giftWraps: null })
    );

    await expect(runBroadcastDmJob(broadcastJob())).resolves.toEqual({
      success: true,
    });
    expect(publishApi.publishSignedEventToRelays).toHaveBeenCalledWith(
      objectContaining({
        relays: userRelays.slice(0, 24).map((relay) => relay.trim()),
      })
    );
  });

  it("publishes gift wraps, starts a scheduled campaign, and completes it", async () => {
    const wraps = [
      signedEvent("bad"),
      signedEvent("skip-wrap"),
      signedEvent("wrap-relays"),
      signedEvent("wrap-fallback"),
    ];
    prismaMock.broadcastRecipient.findFirst.mockResolvedValue(
      recipientRow({
        campaignStatus: BroadcastCampaignStatus.SCHEDULED,
        recipientPubkey: RECEIVER.toUpperCase(),
        publishRelays: ["wss://direct.example"],
        giftWraps: wraps,
        status: BroadcastRecipientStatus.SENT,
        publishedNip04EventId: null,
      })
    );
    messenger.giftWrapRecipientPubkeyHex.mockImplementation(
      (event: { id?: string }) => {
        if (event.id === "skip-wrap") return null;
        if (event.id === "wrap-relays") return RECEIVER;
        return "f".repeat(64);
      }
    );
    messenger.relaysForNip17GiftWrap.mockImplementation(
      async (params: { giftWrapPTag: string }) =>
        params.giftWrapPTag === RECEIVER ? ["wss://nip17.example"] : []
    );
    publishApi.publishSignedEventToRelays.mockResolvedValue({
      results: [{ ok: false, error: "one relay" }, { ok: true }],
    });

    await expect(runBroadcastDmJob(broadcastJob())).resolves.toEqual({
      success: true,
    });

    expect(prismaMock.broadcastCampaign.update).toHaveBeenCalledWith({
      where: { id: CAMPAIGN_ID },
      data: {
        status: BroadcastCampaignStatus.SENDING,
        startedAt: anyDate(),
      },
    });
    expect(relaysApi.resolveExecutionRelays).toHaveBeenCalledWith(USER_ID);
    expect(messenger.resolveDmRelaysSafe).toHaveBeenCalledWith(RECEIVER);
    expect(messenger.resolveCachedKind10050InboxRelays).toHaveBeenCalledWith(
      RECEIVER
    );
    expect(publishApi.publishSignedEventToRelays).toHaveBeenNthCalledWith(1, {
      signedEvent: signedEvent(),
      relays: ["wss://direct.example"],
      userId: USER_ID,
      correlationId: `broadcast:${CAMPAIGN_ID}:${RECIPIENT_ID}:k4`,
    });
    expect(publishApi.publishSignedEventToRelays).toHaveBeenNthCalledWith(2, {
      signedEvent: signedEvent("wrap-relays"),
      relays: ["wss://nip17.example"],
      userId: USER_ID,
      correlationId: `broadcast:${CAMPAIGN_ID}:${RECIPIENT_ID}:nip17:wrap-relays`,
    });
    expect(publishApi.publishSignedEventToRelays).toHaveBeenNthCalledWith(3, {
      signedEvent: signedEvent("wrap-fallback"),
      relays: ["wss://direct.example"],
      userId: USER_ID,
      correlationId: `broadcast:${CAMPAIGN_ID}:${RECIPIENT_ID}:nip17:wrap-fallback`,
    });
    expect(messenger.relaysForNip17GiftWrap).toHaveBeenCalledWith({
      giftWrapPTag: RECEIVER,
      receiverHexLower: RECEIVER,
      recipientInboxRelays: ["wss://inbox.example"],
      senderHexLower: SENDER,
    });
    expect(tx.broadcastRecipient.update).toHaveBeenCalledWith({
      where: { id: RECIPIENT_ID },
      data: objectContaining({
        deliveryMethodUsed: BroadcastRecipientDeliveryMethod.BOTH,
        publishedNip04EventId: "evt-1",
      }),
    });
    expect(tx.broadcastCampaign.update).toHaveBeenCalledWith({
      where: { id: CAMPAIGN_ID },
      data: { sentCount: { increment: 1 } },
    });
    expect(prismaMock.broadcastCampaign.update).toHaveBeenCalledWith({
      where: { id: CAMPAIGN_ID },
      data: {
        status: BroadcastCampaignStatus.COMPLETED,
        completedAt: anyDate(),
      },
    });
    expect(prismaMock.broadcastEventLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: CAMPAIGN_ID,
        level: "INFO",
        eventType: "completed",
        message: "Delivery completed successfully",
        metadataJson: { failedCount: 0 },
      },
    });
  });

  it("treats an empty relay result list as success", async () => {
    publishApi.publishSignedEventToRelays.mockResolvedValue({ results: [] });
    prismaMock.broadcastRecipient.findFirst.mockResolvedValue(
      recipientRow({ giftWraps: undefined })
    );
    prismaMock.broadcastCampaign.findUnique.mockResolvedValue({
      status: BroadcastCampaignStatus.CANCELLED,
      failedCount: 0,
    });

    await expect(runBroadcastDmJob(broadcastJob())).resolves.toEqual({
      success: true,
    });
    expect(prismaMock.broadcastRecipient.count).not.toHaveBeenCalled();
  });

  it("fails the recipient when every relay rejects the event", async () => {
    prismaMock.broadcastRecipient.count.mockResolvedValue(1);
    publishApi.publishSignedEventToRelays.mockResolvedValue({
      results: [{ ok: false, error: "auth-required" }, { ok: false }],
    });
    prismaMock.broadcastRecipient.findFirst.mockResolvedValue(recipientRow());

    await expect(runBroadcastDmJob(broadcastJob())).rejects.toThrow(
      "auth-required"
    );
    expect(logs.logError).toHaveBeenCalledWith(expect.any(Error), {
      message: "broadcast_dm_publish_failed",
      campaignId: CAMPAIGN_ID,
      recipientId: RECIPIENT_ID,
    });
    expect(prismaMock.broadcastRecipient.update).toHaveBeenCalledWith({
      where: { id: RECIPIENT_ID },
      data: {
        status: BroadcastRecipientStatus.FAILED,
        failureCode: "PUBLISH",
        failureReason: "auth-required",
      },
    });
    expect(prismaMock.broadcastEventLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: CAMPAIGN_ID,
        level: "ERROR",
        eventType: "publish_failed",
        message: "auth-required",
        metadataJson: { recipientId: RECIPIENT_ID },
      },
    });
  });

  it("uses a fallback publish error and completes when the failure is last", async () => {
    publishApi.publishSignedEventToRelays.mockResolvedValueOnce({
      results: [{ ok: false }],
    });
    prismaMock.broadcastRecipient.findFirst.mockResolvedValue(recipientRow());
    prismaMock.broadcastCampaign.findUnique.mockResolvedValue({
      status: BroadcastCampaignStatus.QUEUED,
      failedCount: 1,
    });

    await expect(runBroadcastDmJob(broadcastJob())).rejects.toThrow(
      "Publish failed on all relays"
    );

    publishApi.publishSignedEventToRelays.mockRejectedValueOnce("socket down");
    await expect(runBroadcastDmJob(broadcastJob())).rejects.toThrow(
      "socket down"
    );
    expect(prismaMock.broadcastRecipient.update).toHaveBeenCalledWith({
      where: { id: RECIPIENT_ID },
      data: {
        status: BroadcastRecipientStatus.FAILED,
        failureCode: "PUBLISH",
        failureReason: "socket down",
      },
    });
    expect(logs.logError).toHaveBeenCalledWith(
      objectContaining({ message: "socket down" }),
      {
        message: "broadcast_dm_publish_failed",
        campaignId: CAMPAIGN_ID,
        recipientId: RECIPIENT_ID,
      }
    );
    expect(prismaMock.broadcastCampaign.update).toHaveBeenCalledWith({
      where: { id: CAMPAIGN_ID },
      data: {
        status: BroadcastCampaignStatus.COMPLETED_WITH_FAILURES,
        completedAt: anyDate(),
      },
    });
  });
});
