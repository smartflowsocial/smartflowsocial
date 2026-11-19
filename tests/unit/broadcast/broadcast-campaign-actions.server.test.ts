import {
  BroadcastCampaignStatus,
  BroadcastRecipientStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => {
  const tx = {
    broadcastCampaign: { create: vi.fn() },
    broadcastEventLog: { create: vi.fn() },
  };
  const prismaMock = {
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) =>
      work(tx)
    ),
    broadcastCampaign: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    broadcastRecipient: { update: vi.fn() },
    broadcastEventLog: { findMany: vi.fn(), create: vi.fn() },
  };
  return { tx, prismaMock };
});

const queue = vi.hoisted(() => ({
  enqueueBroadcastRecipientJob: vi.fn(),
  cancelBroadcastRecipientJob: vi.fn(),
  broadcastRecipientJobId: (campaignId: string, recipientId: string) =>
    `broadcast:${campaignId}:${recipientId}`,
}));

const entitlements = vi.hoisted(() => ({
  getEffectiveBroadcastPlanLimits: vi.fn(),
  getEffectivePlanEntitlements: vi.fn(),
}));

const subscriptions = vi.hoisted(() => ({
  getSubscriptionData: vi.fn(),
}));

const recipientsApi = vi.hoisted(() => ({
  resolveRecipientsForCampaign: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: boundary.prismaMock }));
vi.mock("~/infra/queue", () => queue);
vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => entitlements
);
vi.mock("~/features/payments/subscriptions.server", () => subscriptions);
vi.mock(
  "~/features/broadcast/broadcast-recipients.server",
  () => recipientsApi
);

import {
  anyDate,
  captureBroadcastActionError,
  objectContaining,
} from "./action-error";

import {
  archiveBroadcastCampaign,
  cancelBroadcastCampaign,
  createBroadcastDraft,
  deleteBroadcastDraft,
  duplicateBroadcastCampaign,
  finalizeBroadcastCampaign,
  retryBroadcastFailedRecipients,
  unarchiveBroadcastCampaign,
} from "~/features/broadcast/broadcast-campaign-actions.server";
import type {
  CreateBroadcastDraftInput,
  FinalizeBroadcastInput,
} from "~/features/broadcast/broadcast-types";

const { prismaMock, tx } = boundary;
const SENDER = "a".repeat(64);
const HEX_A = "b".repeat(64);
const HEX_B = "c".repeat(64);
const CLEAN_MESSAGE = "Hello friends, here is a real update for you today.";
const SPAM_MESSAGE = "Spam spam SPAM sPaM spam extra";

interface Limits {
  maxRecipientsPerCampaign: number | null;
  maxConcurrentActiveCampaigns: number | null;
  maxDailyBroadcastRecipients: number | null;
  allowedAudienceTypes: Array<"CUSTOM" | "MUTUALS">;
  allowAdvancedDelivery: boolean;
  allowSchedule: boolean;
  allowStaggered: boolean;
}

function limits(overrides: Partial<Limits> = {}): Limits {
  return {
    maxRecipientsPerCampaign: 500,
    maxConcurrentActiveCampaigns: null,
    maxDailyBroadcastRecipients: null,
    allowedAudienceTypes: ["CUSTOM", "MUTUALS"],
    allowAdvancedDelivery: true,
    allowSchedule: true,
    allowStaggered: true,
    ...overrides,
  };
}

function draftInput(
  overrides: Partial<CreateBroadcastDraftInput> = {}
): CreateBroadcastDraftInput {
  return {
    name: "Launch",
    audienceType: "CUSTOM",
    customNpubLines: ["npub-line"],
    messageBody: CLEAN_MESSAGE,
    deliveryMode: "BEST_COMPATIBILITY",
    sendStrategy: "STANDARD",
    ...overrides,
  };
}

function signedPayload(
  recipientId: string,
  recipientPubkey: string,
  extras?: {
    giftWraps?: Array<Record<string, unknown>>;
    publishRelays?: string[];
    kind?: number;
    pubkey?: string;
    tags?: string[][];
    omitShape?: boolean;
  }
) {
  return {
    recipientId,
    signedEvent: extras?.omitShape
      ? { id: "partial" }
      : {
          id: `evt-${recipientId}`,
          pubkey: extras?.pubkey ?? SENDER,
          created_at: 1_700_000_000,
          kind: extras?.kind ?? 4,
          tags: extras?.tags ?? [["p", recipientPubkey.toLowerCase()]],
          content: "hello",
          sig: "sig",
        },
    giftWraps: extras?.giftWraps,
    publishRelays: extras?.publishRelays,
  };
}

describe("broadcast campaign actions", () => {
  beforeEach(() => {
    tx.broadcastCampaign.create.mockReset();
    tx.broadcastEventLog.create.mockReset();
    prismaMock.$transaction.mockReset();
    prismaMock.broadcastCampaign.findFirst.mockReset();
    prismaMock.broadcastCampaign.create.mockReset();
    prismaMock.broadcastCampaign.update.mockReset();
    prismaMock.broadcastCampaign.delete.mockReset();
    prismaMock.broadcastCampaign.count.mockReset();
    prismaMock.broadcastRecipient.update.mockReset();
    prismaMock.broadcastEventLog.findMany.mockReset();
    prismaMock.broadcastEventLog.create.mockReset();
    queue.enqueueBroadcastRecipientJob.mockReset();
    queue.cancelBroadcastRecipientJob.mockReset();
    entitlements.getEffectiveBroadcastPlanLimits.mockReset();
    entitlements.getEffectivePlanEntitlements.mockReset();
    subscriptions.getSubscriptionData.mockReset();
    recipientsApi.resolveRecipientsForCampaign.mockReset();

    prismaMock.$transaction.mockImplementation(
      async (work: (client: typeof tx) => Promise<unknown>) => work(tx)
    );
    tx.broadcastCampaign.create.mockResolvedValue({ id: "camp-new" });
    tx.broadcastEventLog.create.mockResolvedValue({ id: "log-tx" });
    prismaMock.broadcastCampaign.create.mockResolvedValue({ id: "camp-copy" });
    prismaMock.broadcastCampaign.update.mockResolvedValue({ id: "camp-1" });
    prismaMock.broadcastCampaign.delete.mockResolvedValue({ id: "camp-1" });
    prismaMock.broadcastRecipient.update.mockResolvedValue({ id: "rec-1" });
    prismaMock.broadcastEventLog.create.mockResolvedValue({ id: "log-1" });
    prismaMock.broadcastEventLog.findMany.mockResolvedValue([]);
    prismaMock.broadcastCampaign.count.mockResolvedValue(0);
    queue.enqueueBroadcastRecipientJob.mockResolvedValue(undefined);
    queue.cancelBroadcastRecipientJob.mockResolvedValue(true);
    entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue(limits());
    entitlements.getEffectivePlanEntitlements.mockReturnValue({
      canSendBroadcast: true,
      canExecuteBulkActions: true,
      maxFutureScheduledItems: null,
      maxQueues: null,
      maxDrafts: null,
      maxTemplates: null,
    });
    subscriptions.getSubscriptionData.mockResolvedValue({
      user: { id: "user-1", isEnabled: true },
      currentSubscription: null,
    });
    recipientsApi.resolveRecipientsForCampaign.mockResolvedValue({
      total: 1,
      suppressed: 0,
      invalidCustom: 0,
    });
  });

  describe("createBroadcastDraft", () => {
    it("rejects a plan that cannot broadcast or use the requested features", async () => {
      entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue(
        limits({ allowedAudienceTypes: [] })
      );
      const unpaid = await captureBroadcastActionError(
        createBroadcastDraft("user-1", draftInput())
      );
      expect(unpaid).toMatchObject({
        code: "PLAN",
        message: "Broadcasts require a paid plan",
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();

      entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue(
        limits({ allowedAudienceTypes: ["CUSTOM"] })
      );
      const audience = await captureBroadcastActionError(
        createBroadcastDraft("user-1", draftInput({ audienceType: "MUTUALS" }))
      );
      expect(audience).toMatchObject({
        code: "AUDIENCE",
        message: "This audience type is not available on your plan",
      });

      entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue(
        limits({ allowAdvancedDelivery: false })
      );
      const advanced = await captureBroadcastActionError(
        createBroadcastDraft(
          "user-1",
          draftInput({ deliveryMode: "NIP17_ONLY" })
        )
      );
      expect(advanced).toMatchObject({
        code: "PLAN",
        message: "Advanced delivery requires a higher plan",
      });

      entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue(
        limits({ allowStaggered: false })
      );
      const staggered = await captureBroadcastActionError(
        createBroadcastDraft(
          "user-1",
          draftInput({ sendStrategy: "STAGGERED" })
        )
      );
      expect(staggered).toMatchObject({
        code: "PLAN",
        message: "Staggered sending is not available on your plan",
      });

      entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue(
        limits({ allowSchedule: false })
      );
      const schedule = await captureBroadcastActionError(
        createBroadcastDraft(
          "user-1",
          draftInput({ scheduledForIso: "2030-01-01T00:00:00.000Z" })
        )
      );
      expect(schedule).toMatchObject({
        code: "PLAN",
        message: "Scheduling is not available on your plan",
      });

      entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue(limits());
      const invalid = await captureBroadcastActionError(
        createBroadcastDraft(
          "user-1",
          draftInput({ scheduledForIso: "not-a-date" })
        )
      );
      expect(invalid).toMatchObject({
        code: "VALIDATION",
        message: "Invalid schedule time",
      });
      expect(subscriptions.getSubscriptionData).toHaveBeenCalledWith("user-1");
    });

    it("creates a draft when advanced features are turned off", async () => {
      entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue(
        limits({
          allowAdvancedDelivery: false,
          allowSchedule: false,
          allowStaggered: false,
        })
      );

      await expect(
        createBroadcastDraft("user-1", draftInput())
      ).resolves.toEqual({ id: "camp-new" });
      expect(tx.broadcastCampaign.create).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          name: "Launch",
          status: BroadcastCampaignStatus.DRAFT,
          audienceType: "CUSTOM",
          messageBody: CLEAN_MESSAGE,
          deliveryMode: "BEST_COMPATIBILITY",
          sendStrategy: "STANDARD",
          scheduledFor: null,
          customNpubLines: ["npub-line"],
          parseSnapshotJson: undefined,
          exclusionRulesJson: undefined,
        },
      });
      expect(tx.broadcastEventLog.create).toHaveBeenCalledWith({
        data: {
          campaignId: "camp-new",
          level: "INFO",
          eventType: "draft_created",
          message: "Draft created",
          metadataJson: undefined,
        },
      });
      expect(prismaMock.broadcastEventLog.create).not.toHaveBeenCalled();
      expect(entitlements.getEffectiveBroadcastPlanLimits).toHaveBeenCalledWith(
        "free"
      );
    });

    it("stores a schedule and optional snapshots", async () => {
      const scheduledForIso = "2030-01-02T03:04:05.000Z";
      await expect(
        createBroadcastDraft(
          "user-1",
          draftInput({
            audienceType: "MUTUALS",
            customNpubLines: [],
            deliveryMode: "NIP17_ONLY",
            sendStrategy: "STAGGERED",
            scheduledForIso,
            parseSnapshotJson: { kept: true },
            exclusionRulesJson: { excludePriorBroadcastRecipients: true },
          })
        )
      ).resolves.toEqual({ id: "camp-new" });
      expect(tx.broadcastCampaign.create).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          name: "Launch",
          status: BroadcastCampaignStatus.DRAFT,
          audienceType: "MUTUALS",
          messageBody: CLEAN_MESSAGE,
          deliveryMode: "NIP17_ONLY",
          sendStrategy: "STAGGERED",
          scheduledFor: new Date(scheduledForIso),
          customNpubLines: [],
          parseSnapshotJson: { kept: true },
          exclusionRulesJson: { excludePriorBroadcastRecipients: true },
        },
      });
    });
  });

  describe("finalizeBroadcastCampaign", () => {
    function pendingCampaign(overrides?: Record<string, unknown>) {
      return {
        id: "camp-1",
        userId: "user-1",
        status: BroadcastCampaignStatus.DRAFT,
        messageBody: CLEAN_MESSAGE,
        sendStrategy: "STANDARD",
        scheduledFor: null,
        recipients: [
          {
            id: "rec-1",
            campaignId: "camp-1",
            recipientPubkey: HEX_A.toUpperCase(),
            status: BroadcastRecipientStatus.PENDING,
          },
          {
            id: "rec-sent",
            campaignId: "camp-1",
            recipientPubkey: HEX_B,
            status: BroadcastRecipientStatus.SENT,
          },
        ],
        ...overrides,
      };
    }

    it("rejects an unpaid plan and a missing campaign", async () => {
      entitlements.getEffectivePlanEntitlements.mockReturnValue({
        canSendBroadcast: false,
        canExecuteBulkActions: true,
        maxFutureScheduledItems: null,
        maxQueues: null,
        maxDrafts: null,
        maxTemplates: null,
      });
      const unpaid = await captureBroadcastActionError(
        finalizeBroadcastCampaign("user-1", SENDER, {
          campaignId: "camp-1",
          recipients: [signedPayload("rec-1", HEX_A)],
        })
      );
      expect(unpaid).toMatchObject({
        code: "PLAN",
        message: "Broadcast sending is available on paid plans.",
      });
      expect(prismaMock.broadcastCampaign.findFirst).not.toHaveBeenCalled();
      expect(entitlements.getEffectivePlanEntitlements).toHaveBeenCalledWith(
        "free"
      );

      entitlements.getEffectivePlanEntitlements.mockReturnValue({
        canSendBroadcast: true,
        canExecuteBulkActions: true,
        maxFutureScheduledItems: null,
        maxQueues: null,
        maxDrafts: null,
        maxTemplates: null,
      });
      prismaMock.broadcastCampaign.findFirst.mockResolvedValue(null);
      const missing = await captureBroadcastActionError(
        finalizeBroadcastCampaign("user-1", SENDER, {
          campaignId: "camp-1",
          recipients: [signedPayload("rec-1", HEX_A)],
        })
      );
      expect(missing).toMatchObject({
        code: "NOT_FOUND",
        message: "Campaign not found",
      });
    });

    it("rejects a finalized, spammy, or over-limit campaign", async () => {
      prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
        pendingCampaign({ status: BroadcastCampaignStatus.SENDING })
      );
      const state = await captureBroadcastActionError(
        finalizeBroadcastCampaign("user-1", SENDER, {
          campaignId: "camp-1",
          recipients: [signedPayload("rec-1", HEX_A)],
        })
      );
      expect(state).toMatchObject({
        code: "STATE",
        message: "Campaign already finalized",
      });

      prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
        pendingCampaign({ messageBody: SPAM_MESSAGE })
      );
      const spam = await captureBroadcastActionError(
        finalizeBroadcastCampaign("user-1", SENDER, {
          campaignId: "camp-1",
          recipients: [signedPayload("rec-1", HEX_A)],
        })
      );
      expect(spam).toMatchObject({
        code: "SPAM",
        message: "Message looks repetitive; revise before sending",
      });
      expect(prismaMock.broadcastEventLog.findMany).not.toHaveBeenCalled();

      entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue(
        limits({ maxDailyBroadcastRecipients: 10 })
      );
      prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
        pendingCampaign()
      );
      prismaMock.broadcastEventLog.findMany.mockResolvedValue([
        { metadataJson: { count: 10 } },
      ]);
      const daily = await captureBroadcastActionError(
        finalizeBroadcastCampaign("user-1", SENDER, {
          campaignId: "camp-1",
          recipients: [signedPayload("rec-1", HEX_A)],
        })
      );
      expect(daily.code).toBe("LIMIT");
      expect(daily.message).toBe(
        "Daily broadcast recipient limit exceeded (max 10 signed sends per UTC day)."
      );
      expect(prismaMock.broadcastCampaign.count).not.toHaveBeenCalled();

      entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue(
        limits({ maxConcurrentActiveCampaigns: 2 })
      );
      prismaMock.broadcastCampaign.count.mockResolvedValue(2);
      const concurrent = await captureBroadcastActionError(
        finalizeBroadcastCampaign("user-1", SENDER, {
          campaignId: "camp-1",
          recipients: [signedPayload("rec-1", HEX_A)],
        })
      );
      expect(concurrent.code).toBe("LIMIT");
      expect(concurrent.message).toBe(
        "Too many active broadcasts (max 2). Cancel or finish one before starting another."
      );
      expect(prismaMock.broadcastCampaign.count).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          archivedAt: null,
          id: { not: "camp-1" },
          status: {
            in: [
              BroadcastCampaignStatus.SCHEDULED,
              BroadcastCampaignStatus.QUEUED,
              BroadcastCampaignStatus.SENDING,
              BroadcastCampaignStatus.PAUSED,
            ],
          },
        },
      });
    });

    it("rejects a batch that does not match the pending recipients", async () => {
      prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
        pendingCampaign({
          recipients: [
            {
              id: "rec-1",
              campaignId: "camp-1",
              recipientPubkey: HEX_A,
              status: BroadcastRecipientStatus.PENDING,
            },
            {
              id: "rec-2",
              campaignId: "camp-1",
              recipientPubkey: HEX_B,
              status: BroadcastRecipientStatus.PENDING,
            },
          ],
        })
      );
      const mismatch = await captureBroadcastActionError(
        finalizeBroadcastCampaign("user-1", SENDER, {
          campaignId: "camp-1",
          recipients: [signedPayload("rec-1", HEX_A)],
        })
      );
      expect(mismatch).toMatchObject({
        code: "VALIDATION",
        message:
          "Recipient batch must include every pending recipient exactly once",
      });

      prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
        pendingCampaign()
      );
      const missingId = await captureBroadcastActionError(
        finalizeBroadcastCampaign("user-1", SENDER, {
          campaignId: "camp-1",
          recipients: [signedPayload("missing", HEX_A)],
        })
      );
      expect(missingId.message).toBe("Invalid recipient id");

      const sentId = await captureBroadcastActionError(
        finalizeBroadcastCampaign("user-1", SENDER, {
          campaignId: "camp-1",
          recipients: [signedPayload("rec-sent", HEX_B)],
        })
      );
      expect(sentId.message).toBe("Invalid recipient id");
      expect(queue.enqueueBroadcastRecipientJob).not.toHaveBeenCalled();
    });

    it("rejects a bad signature, pubkey, kind, or p tag", async () => {
      prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
        pendingCampaign()
      );
      const cases: Array<{
        input: FinalizeBroadcastInput;
        code: string;
        message: string;
      }> = [
        {
          input: {
            campaignId: "camp-1",
            recipients: [signedPayload("rec-1", HEX_A, { omitShape: true })],
          },
          code: "VALIDATION",
          message: "Invalid signedEvent shape",
        },
        {
          input: {
            campaignId: "camp-1",
            recipients: [
              signedPayload("rec-1", HEX_A, { pubkey: "e".repeat(64) }),
            ],
          },
          code: "PUBKEY",
          message: "Signed event pubkey mismatch",
        },
        {
          input: {
            campaignId: "camp-1",
            recipients: [signedPayload("rec-1", HEX_A, { kind: 1 })],
          },
          code: "VALIDATION",
          message: "Only kind 4 DMs supported in V1",
        },
        {
          input: {
            campaignId: "camp-1",
            recipients: [signedPayload("rec-1", HEX_A, { tags: [] })],
          },
          code: "PTAG",
          message: "DM p tag does not match recipient",
        },
        {
          input: {
            campaignId: "camp-1",
            recipients: [
              signedPayload("rec-1", HEX_A, {
                tags: [["p", "e".repeat(64)]],
              }),
            ],
          },
          code: "PTAG",
          message: "DM p tag does not match recipient",
        },
      ];

      for (const item of cases) {
        const error = await captureBroadcastActionError(
          finalizeBroadcastCampaign("user-1", SENDER.toUpperCase(), item.input)
        );
        expect(error.code).toBe(item.code);
        expect(error.message).toBe(item.message);
      }
      expect(prismaMock.broadcastRecipient.update).not.toHaveBeenCalled();
    });

    it("queues staggered recipients under the daily and concurrency caps", async () => {
      const random = vi.spyOn(Math, "random").mockReturnValue(0);
      try {
        entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue(
          limits({
            maxDailyBroadcastRecipients: 100,
            maxConcurrentActiveCampaigns: 5,
          })
        );
        prismaMock.broadcastEventLog.findMany.mockResolvedValue([
          { metadataJson: { count: 4 } },
        ]);
        prismaMock.broadcastCampaign.count.mockResolvedValue(1);
        prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
          pendingCampaign({
            sendStrategy: "STAGGERED",
            recipients: [
              {
                id: "rec-1",
                campaignId: "camp-1",
                recipientPubkey: HEX_A.toUpperCase(),
                status: BroadcastRecipientStatus.PENDING,
              },
              {
                id: "rec-2",
                campaignId: "camp-1",
                recipientPubkey: HEX_B.toUpperCase(),
                status: BroadcastRecipientStatus.PENDING,
              },
              {
                id: "rec-sent",
                campaignId: "camp-1",
                recipientPubkey: "f".repeat(64),
                status: BroadcastRecipientStatus.SENT,
              },
            ],
          })
        );

        const result = await finalizeBroadcastCampaign(
          "user-1",
          SENDER.toUpperCase(),
          {
            campaignId: "camp-1",
            recipients: [
              signedPayload("rec-1", HEX_A, {
                giftWraps: [{ id: "wrap-1" }],
              }),
              signedPayload("rec-2", HEX_B, {
                publishRelays: ["wss://relay.example"],
              }),
            ],
          }
        );

        expect(result).toEqual({ enqueued: 2 });
        expect(prismaMock.broadcastRecipient.update).toHaveBeenNthCalledWith(
          1,
          {
            where: { id: "rec-1" },
            data: {
              signedEvent: objectContaining({ kind: 4, pubkey: SENDER }),
              giftWraps: [{ id: "wrap-1" }],
              publishRelays: [],
              status: BroadcastRecipientStatus.READY,
            },
          }
        );
        expect(prismaMock.broadcastRecipient.update).toHaveBeenNthCalledWith(
          2,
          {
            where: { id: "rec-1" },
            data: { status: BroadcastRecipientStatus.QUEUED },
          }
        );
        expect(prismaMock.broadcastRecipient.update).toHaveBeenNthCalledWith(
          3,
          {
            where: { id: "rec-2" },
            data: objectContaining({
              giftWraps: undefined,
              publishRelays: ["wss://relay.example"],
              status: BroadcastRecipientStatus.READY,
            }),
          }
        );
        expect(queue.enqueueBroadcastRecipientJob).toHaveBeenNthCalledWith(1, {
          campaignId: "camp-1",
          recipientId: "rec-1",
          userId: "user-1",
          scheduledForUnix: 0,
          additionalDelayMs: 0,
        });
        expect(queue.enqueueBroadcastRecipientJob).toHaveBeenNthCalledWith(2, {
          campaignId: "camp-1",
          recipientId: "rec-2",
          userId: "user-1",
          scheduledForUnix: 0,
          additionalDelayMs: 800,
        });
        expect(prismaMock.broadcastCampaign.update).toHaveBeenCalledWith({
          where: { id: "camp-1" },
          data: {
            status: BroadcastCampaignStatus.QUEUED,
            queuedCount: 2,
            startedAt: anyDate(),
          },
        });
        expect(prismaMock.broadcastEventLog.create).toHaveBeenCalledWith({
          data: {
            campaignId: "camp-1",
            level: "INFO",
            eventType: "finalized",
            message: "Signed events stored and publish jobs enqueued",
            metadataJson: { count: 2 },
          },
        });
      } finally {
        random.mockRestore();
      }
    });

    it("schedules a campaign that is still awaiting signature", async () => {
      const scheduledFor = new Date(Date.now() + 86_400_000);
      prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
        pendingCampaign({
          status: BroadcastCampaignStatus.AWAITING_SIGNATURE,
          scheduledFor,
        })
      );

      await expect(
        finalizeBroadcastCampaign("user-1", SENDER, {
          campaignId: "camp-1",
          recipients: [signedPayload("rec-1", HEX_A)],
        })
      ).resolves.toEqual({ enqueued: 1 });
      expect(queue.enqueueBroadcastRecipientJob).toHaveBeenCalledWith({
        campaignId: "camp-1",
        recipientId: "rec-1",
        userId: "user-1",
        scheduledForUnix: Math.floor(scheduledFor.getTime() / 1000),
        additionalDelayMs: 0,
      });
      expect(prismaMock.broadcastCampaign.update).toHaveBeenCalledWith({
        where: { id: "camp-1" },
        data: {
          status: BroadcastCampaignStatus.SCHEDULED,
          queuedCount: 1,
          startedAt: null,
        },
      });
      expect(prismaMock.broadcastEventLog.findMany).not.toHaveBeenCalled();
      expect(prismaMock.broadcastCampaign.count).not.toHaveBeenCalled();
    });
  });

  describe("cancelBroadcastCampaign", () => {
    it("rejects a missing campaign and ignores a terminal one", async () => {
      prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce(null);
      const missing = await captureBroadcastActionError(
        cancelBroadcastCampaign("user-1", "camp-1")
      );
      expect(missing).toMatchObject({
        code: "NOT_FOUND",
        message: "Campaign not found",
      });

      prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce({
        id: "camp-1",
        status: BroadcastCampaignStatus.COMPLETED,
        recipients: [{ id: "rec-1", status: BroadcastRecipientStatus.QUEUED }],
      });
      await expect(
        cancelBroadcastCampaign("user-1", "camp-1")
      ).resolves.toBeUndefined();
      expect(queue.cancelBroadcastRecipientJob).not.toHaveBeenCalled();
      expect(prismaMock.broadcastCampaign.update).not.toHaveBeenCalled();
    });

    it("cancels queued and ready jobs", async () => {
      prismaMock.broadcastCampaign.findFirst.mockResolvedValue({
        id: "camp-1",
        status: BroadcastCampaignStatus.SENDING,
        recipients: [
          { id: "rec-q", status: BroadcastRecipientStatus.QUEUED },
          { id: "rec-r", status: BroadcastRecipientStatus.READY },
          { id: "rec-s", status: BroadcastRecipientStatus.SENT },
          { id: "rec-p", status: BroadcastRecipientStatus.PENDING },
          { id: "rec-f", status: BroadcastRecipientStatus.FAILED },
        ],
      });

      await cancelBroadcastCampaign("user-1", "camp-1");
      expect(queue.cancelBroadcastRecipientJob).toHaveBeenCalledTimes(2);
      expect(queue.cancelBroadcastRecipientJob).toHaveBeenCalledWith(
        "camp-1",
        "rec-q"
      );
      expect(queue.cancelBroadcastRecipientJob).toHaveBeenCalledWith(
        "camp-1",
        "rec-r"
      );
      expect(prismaMock.broadcastCampaign.update).toHaveBeenCalledWith({
        where: { id: "camp-1" },
        data: {
          status: BroadcastCampaignStatus.CANCELLED,
          cancelledAt: anyDate(),
        },
      });
      expect(prismaMock.broadcastEventLog.create).toHaveBeenCalledWith({
        data: {
          campaignId: "camp-1",
          level: "INFO",
          eventType: "cancelled",
          message: "Campaign cancelled by user",
          metadataJson: undefined,
        },
      });
    });
  });

  describe("deleteBroadcastDraft", () => {
    it("rejects a missing or non-draft campaign and deletes drafts", async () => {
      prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce(null);
      const missing = await captureBroadcastActionError(
        deleteBroadcastDraft("user-1", "camp-1")
      );
      expect(missing.code).toBe("NOT_FOUND");

      prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce({
        id: "camp-1",
        status: BroadcastCampaignStatus.QUEUED,
      });
      const locked = await captureBroadcastActionError(
        deleteBroadcastDraft("user-1", "camp-1")
      );
      expect(locked).toMatchObject({
        code: "STATE",
        message: "Only drafts can be deleted",
      });
      expect(prismaMock.broadcastCampaign.delete).not.toHaveBeenCalled();

      prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce({
        id: "camp-1",
        status: BroadcastCampaignStatus.DRAFT,
      });
      await deleteBroadcastDraft("user-1", "camp-1");
      prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce({
        id: "camp-1",
        status: BroadcastCampaignStatus.AWAITING_SIGNATURE,
      });
      await deleteBroadcastDraft("user-1", "camp-1");
      expect(prismaMock.broadcastCampaign.delete).toHaveBeenCalledTimes(2);
      expect(prismaMock.broadcastCampaign.delete).toHaveBeenCalledWith({
        where: { id: "camp-1" },
      });
    });
  });

  describe("archiveBroadcastCampaign", () => {
    it("rejects a missing campaign and archives an owned one", async () => {
      prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce(null);
      const missing = await captureBroadcastActionError(
        archiveBroadcastCampaign("user-1", "camp-1")
      );
      expect(missing.message).toBe("Campaign not found");

      prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce({
        id: "camp-1",
      });
      await archiveBroadcastCampaign("user-1", "camp-1");
      expect(prismaMock.broadcastCampaign.findFirst).toHaveBeenCalledWith({
        where: { id: "camp-1", userId: "user-1" },
      });
      expect(prismaMock.broadcastCampaign.update).toHaveBeenCalledWith({
        where: { id: "camp-1" },
        data: { archivedAt: anyDate() },
      });
    });
  });

  describe("unarchiveBroadcastCampaign", () => {
    it("rejects a missing campaign and clears archivedAt", async () => {
      prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce(null);
      const missing = await captureBroadcastActionError(
        unarchiveBroadcastCampaign("user-1", "camp-1")
      );
      expect(missing.code).toBe("NOT_FOUND");

      prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce({
        id: "camp-1",
      });
      await unarchiveBroadcastCampaign("user-1", "camp-1");
      expect(prismaMock.broadcastCampaign.update).toHaveBeenCalledWith({
        where: { id: "camp-1" },
        data: { archivedAt: null },
      });
    });
  });

  describe("duplicateBroadcastCampaign", () => {
    it("rejects a missing campaign and removed audiences", async () => {
      prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce(null);
      const missing = await captureBroadcastActionError(
        duplicateBroadcastCampaign("user-1", "camp-1")
      );
      expect(missing.code).toBe("NOT_FOUND");

      prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce({
        id: "camp-1",
        audienceType: "FOLLOWING",
      });
      const following = await captureBroadcastActionError(
        duplicateBroadcastCampaign("user-1", "camp-1")
      );
      expect(following.code).toBe("AUDIENCE");
      expect(following.message).toBe(
        "The “Following” audience is no longer available. Create a new broadcast using Mutuals or a custom list of accounts that follow you."
      );

      prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce({
        id: "camp-1",
        audienceType: "FOLLOWERS",
      });
      const followers = await captureBroadcastActionError(
        duplicateBroadcastCampaign("user-1", "camp-1")
      );
      expect(followers.code).toBe("AUDIENCE");
      expect(followers.message).toContain("followers");
      expect(prismaMock.broadcastCampaign.create).not.toHaveBeenCalled();
    });

    it("copies a campaign and omits null snapshots", async () => {
      prismaMock.broadcastCampaign.findFirst.mockResolvedValue({
        id: "camp-1",
        name: "Launch",
        audienceType: "MUTUALS",
        messageBody: CLEAN_MESSAGE,
        deliveryMode: "BOTH",
        sendStrategy: "STANDARD",
        customNpubLines: [HEX_A],
        parseSnapshotJson: null,
        exclusionRulesJson: null,
      });

      await expect(
        duplicateBroadcastCampaign("user-1", "camp-1")
      ).resolves.toEqual({ id: "camp-copy" });
      expect(prismaMock.broadcastCampaign.create).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          name: "Launch (copy)",
          status: BroadcastCampaignStatus.DRAFT,
          audienceType: "MUTUALS",
          messageBody: CLEAN_MESSAGE,
          deliveryMode: "BOTH",
          sendStrategy: "STANDARD",
          scheduledFor: null,
          customNpubLines: [HEX_A],
          parseSnapshotJson: undefined,
          exclusionRulesJson: undefined,
          duplicatedFromId: "camp-1",
        },
      });
      expect(prismaMock.broadcastEventLog.create).toHaveBeenCalledWith({
        data: {
          campaignId: "camp-copy",
          level: "INFO",
          eventType: "draft_created",
          message: "Duplicated from another broadcast",
          metadataJson: { sourceCampaignId: "camp-1" },
        },
      });
    });

    it("keeps snapshot json when duplicating", async () => {
      prismaMock.broadcastCampaign.findFirst.mockResolvedValue({
        id: "camp-1",
        name: "Launch",
        audienceType: "CUSTOM",
        messageBody: CLEAN_MESSAGE,
        deliveryMode: "BEST_COMPATIBILITY",
        sendStrategy: "STAGGERED",
        customNpubLines: [],
        parseSnapshotJson: { kept: true },
        exclusionRulesJson: { excludePriorBroadcastRecipients: true },
      });
      await duplicateBroadcastCampaign("user-1", "camp-1");
      expect(prismaMock.broadcastCampaign.create).toHaveBeenCalledWith({
        data: objectContaining({
          parseSnapshotJson: { kept: true },
          exclusionRulesJson: { excludePriorBroadcastRecipients: true },
          duplicatedFromId: "camp-1",
        }),
      });
    });
  });

  describe("retryBroadcastFailedRecipients", () => {
    it("rejects a missing campaign and a campaign with no failures", async () => {
      prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce(null);
      const missing = await captureBroadcastActionError(
        retryBroadcastFailedRecipients("user-1", "camp-1")
      );
      expect(missing.code).toBe("NOT_FOUND");

      prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce({
        id: "camp-1",
        name: "Launch",
        recipients: [],
      });
      const empty = await captureBroadcastActionError(
        retryBroadcastFailedRecipients("user-1", "camp-1")
      );
      expect(empty).toMatchObject({
        code: "STATE",
        message: "No failed recipients to retry",
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("creates a custom retry draft and resolves it", async () => {
      prismaMock.broadcastCampaign.findFirst.mockResolvedValue({
        id: "camp-1",
        name: "Launch",
        messageBody: CLEAN_MESSAGE,
        deliveryMode: "NIP04_ONLY",
        sendStrategy: "STAGGERED",
        recipients: [{ recipientPubkey: HEX_A }, { recipientPubkey: HEX_B }],
      });

      await expect(
        retryBroadcastFailedRecipients("user-1", "camp-1")
      ).resolves.toEqual({ id: "camp-new" });
      expect(tx.broadcastCampaign.create).toHaveBeenCalledWith({
        data: objectContaining({
          userId: "user-1",
          name: "Retry: Launch",
          audienceType: "CUSTOM",
          customNpubLines: [HEX_A, HEX_B],
          messageBody: CLEAN_MESSAGE,
          deliveryMode: "NIP04_ONLY",
          sendStrategy: "STAGGERED",
          status: BroadcastCampaignStatus.DRAFT,
        }),
      });
      expect(recipientsApi.resolveRecipientsForCampaign).toHaveBeenCalledWith(
        "user-1",
        "camp-new"
      );
      expect(prismaMock.broadcastEventLog.create).toHaveBeenCalledWith({
        data: {
          campaignId: "camp-new",
          level: "INFO",
          eventType: "retry_draft_created",
          message: "Retry draft for 2 failed recipient(s)",
          metadataJson: { sourceCampaignId: "camp-1" },
        },
      });
    });
  });
});
