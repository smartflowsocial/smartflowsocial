import {
  BroadcastCampaignStatus,
  BroadcastRecipientStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => {
  const tx = {
    broadcastRecipient: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    broadcastCampaign: {
      update: vi.fn(),
    },
  };
  const prismaMock = {
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) =>
      work(tx)
    ),
    broadcastCampaign: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    broadcastSuppression: {
      findMany: vi.fn(),
    },
    broadcastRecipient: {
      findMany: vi.fn(),
    },
    broadcastEventLog: {
      create: vi.fn(),
    },
  };
  return { tx, prismaMock };
});

const graph = vi.hoisted(() => ({
  getFollowedPubkeysGraph: vi.fn(),
  getFollowerPubkeysGraph: vi.fn(),
  getMutualPubkeysGraph: vi.fn(),
}));

const users = vi.hoisted(() => ({
  getUserById: vi.fn(),
}));

const entitlements = vi.hoisted(() => ({
  getEffectiveBroadcastPlanLimits: vi.fn(),
  getEffectivePlanEntitlements: vi.fn(),
}));

const subscriptions = vi.hoisted(() => ({
  getSubscriptionData: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: boundary.prismaMock }));
vi.mock("~/features/nostr/social-graph.server", () => graph);
vi.mock("~/features/user", () => users);
vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => entitlements
);
vi.mock("~/features/payments/subscriptions.server", () => subscriptions);

import { captureBroadcastActionError, objectContaining } from "./action-error";

import { resolveRecipientsForCampaign } from "~/features/broadcast/broadcast-recipients.server";

const { prismaMock, tx } = boundary;
const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);
const HEX_SELF = "d".repeat(64);
const HEX_E = "e".repeat(64);

function limits(maxRecipientsPerCampaign: number | null) {
  return {
    maxRecipientsPerCampaign,
    maxConcurrentActiveCampaigns: null,
    maxDailyBroadcastRecipients: null,
    allowedAudienceTypes: ["CUSTOM", "MUTUALS"],
    allowAdvancedDelivery: true,
    allowSchedule: true,
    allowStaggered: true,
  };
}

function campaign(overrides?: Record<string, unknown>) {
  return {
    id: "camp-1",
    userId: "user-1",
    audienceType: "MUTUALS",
    status: BroadcastCampaignStatus.DRAFT,
    customNpubLines: [] as string[],
    exclusionRulesJson: null,
    ...overrides,
  };
}

describe("resolveRecipientsForCampaign", () => {
  beforeEach(() => {
    vi.useRealTimers();
    tx.broadcastRecipient.deleteMany.mockReset();
    tx.broadcastRecipient.createMany.mockReset();
    tx.broadcastCampaign.update.mockReset();
    prismaMock.broadcastCampaign.findFirst.mockReset();
    prismaMock.broadcastSuppression.findMany.mockReset();
    prismaMock.broadcastRecipient.findMany.mockReset();
    prismaMock.broadcastEventLog.create.mockReset();
    graph.getFollowedPubkeysGraph.mockReset();
    graph.getFollowerPubkeysGraph.mockReset();
    graph.getMutualPubkeysGraph.mockReset();
    users.getUserById.mockReset();
    entitlements.getEffectiveBroadcastPlanLimits.mockReset();
    subscriptions.getSubscriptionData.mockReset();

    users.getUserById.mockResolvedValue({ id: "user-1", npub: HEX_SELF });
    entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue(limits(500));
    subscriptions.getSubscriptionData.mockResolvedValue({
      user: { id: "user-1", isEnabled: true },
      currentSubscription: null,
    });
    prismaMock.broadcastSuppression.findMany.mockResolvedValue([]);
    prismaMock.broadcastRecipient.findMany.mockResolvedValue([]);
    graph.getFollowedPubkeysGraph.mockResolvedValue({
      pubkeys: [],
      fetchFailed: false,
    });
    graph.getFollowerPubkeysGraph.mockResolvedValue({
      pubkeys: [],
      fetchFailed: false,
    });
    graph.getMutualPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_A],
      fetchFailed: false,
    });
    tx.broadcastRecipient.deleteMany.mockResolvedValue({ count: 0 });
    tx.broadcastRecipient.createMany.mockResolvedValue({ count: 1 });
    tx.broadcastCampaign.update.mockResolvedValue({ id: "camp-1" });
    prismaMock.broadcastEventLog.create.mockResolvedValue({ id: "log-1" });
  });

  it("rejects a missing npub, missing campaign, removed audience, locked state, and bad pubkey", async () => {
    users.getUserById.mockResolvedValueOnce(null);
    const missingUser = await captureBroadcastActionError(
      resolveRecipientsForCampaign("user-1", "camp-1")
    );
    expect(missingUser).toMatchObject({
      code: "USER",
      message: "User npub missing",
    });
    expect(prismaMock.broadcastCampaign.findFirst).not.toHaveBeenCalled();

    users.getUserById.mockResolvedValueOnce({ id: "user-1", npub: HEX_SELF });
    prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce(null);
    const missingCampaign = await captureBroadcastActionError(
      resolveRecipientsForCampaign("user-1", "camp-1")
    );
    expect(missingCampaign.code).toBe("NOT_FOUND");
    expect(missingCampaign.message).toBe("Campaign not found");

    prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce(
      campaign({ audienceType: "FOLLOWERS" })
    );
    const followers = await captureBroadcastActionError(
      resolveRecipientsForCampaign("user-1", "camp-1")
    );
    expect(followers.code).toBe("AUDIENCE");
    expect(followers.message).toContain("followers");

    prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce(
      campaign({ status: BroadcastCampaignStatus.SENDING })
    );
    const locked = await captureBroadcastActionError(
      resolveRecipientsForCampaign("user-1", "camp-1")
    );
    expect(locked.code).toBe("STATE");
    expect(locked.message).toBe("Audience is locked for this campaign");
    expect(graph.getMutualPubkeysGraph).not.toHaveBeenCalled();

    users.getUserById.mockResolvedValueOnce({
      id: "user-1",
      npub: "not-a-pubkey",
    });
    prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce(campaign());
    const badKey = await captureBroadcastActionError(
      resolveRecipientsForCampaign("user-1", "camp-1")
    );
    expect(badKey).toMatchObject({
      code: "USER",
      message: "Invalid account pubkey",
    });
    expect(prismaMock.broadcastSuppression.findMany).not.toHaveBeenCalled();
  });

  it("stores mutual recipients and skips the sender", async () => {
    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
      campaign({
        status: BroadcastCampaignStatus.AWAITING_SIGNATURE,
      })
    );
    graph.getMutualPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_A, HEX_SELF.toUpperCase()],
      fetchFailed: false,
    });

    await expect(
      resolveRecipientsForCampaign("user-1", "camp-1")
    ).resolves.toEqual({ total: 1, suppressed: 0, invalidCustom: 0 });

    expect(graph.getMutualPubkeysGraph).toHaveBeenCalledWith(HEX_SELF);
    expect(tx.broadcastRecipient.deleteMany).toHaveBeenCalledWith({
      where: { campaignId: "camp-1" },
    });
    expect(tx.broadcastRecipient.createMany).toHaveBeenCalledWith({
      data: [
        {
          campaignId: "camp-1",
          recipientPubkey: HEX_A,
          sourceType: "MUTUALS",
          status: BroadcastRecipientStatus.PENDING,
        },
      ],
    });
    expect(tx.broadcastCampaign.update).toHaveBeenCalledWith({
      where: { id: "camp-1" },
      data: {
        totalRecipients: 1,
        suppressedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        sentCount: 0,
        queuedCount: 0,
        status: BroadcastCampaignStatus.AWAITING_SIGNATURE,
      },
    });
    expect(prismaMock.broadcastEventLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: "camp-1",
        level: "INFO",
        eventType: "audience_resolved",
        message: "Resolved 1 recipients",
        metadataJson: {
          suppressedCount: 0,
          invalidCustom: 0,
          excludedNonFollowers: 0,
          excludedRecentMessaged: 0,
          excludedPriorBroadcast: 0,
        },
      },
    });
    expect(entitlements.getEffectiveBroadcastPlanLimits).toHaveBeenCalledWith(
      "free"
    );
  });

  it("rejects an empty mutual graph, a failed graph, and a fully suppressed graph", async () => {
    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(campaign());
    graph.getMutualPubkeysGraph.mockResolvedValueOnce({
      pubkeys: [],
      fetchFailed: true,
    });
    const failed = await captureBroadcastActionError(
      resolveRecipientsForCampaign("user-1", "camp-1")
    );
    expect(failed.code).toBe("GRAPH_CACHE");
    expect(failed.message).toContain("temporary error");

    graph.getMutualPubkeysGraph.mockResolvedValueOnce({
      pubkeys: [],
      fetchFailed: false,
    });
    const empty = await captureBroadcastActionError(
      resolveRecipientsForCampaign("user-1", "camp-1")
    );
    expect(empty.code).toBe("EMPTY_AUDIENCE");
    expect(empty.message).toBe("No mutual follows found for this audience.");

    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
      campaign({ audienceType: "FOLLOWING" })
    );
    graph.getFollowedPubkeysGraph.mockResolvedValue({
      pubkeys: [],
      fetchFailed: false,
    });
    const following = await captureBroadcastActionError(
      resolveRecipientsForCampaign("user-1", "camp-1")
    );
    expect(following.message).toBe(
      "No accounts found in your follow list (kind 3)."
    );

    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(campaign());
    graph.getMutualPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_SELF],
      fetchFailed: false,
    });
    const suppressed = await captureBroadcastActionError(
      resolveRecipientsForCampaign("user-1", "camp-1")
    );
    expect(suppressed.code).toBe("ALL_SUPPRESSED");
    expect(tx.broadcastRecipient.createMany).not.toHaveBeenCalled();
  });

  it("rejects custom lists that cannot be verified or contain nobody eligible", async () => {
    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
      campaign({
        audienceType: "CUSTOM",
        customNpubLines: [HEX_A, "not-a-pubkey"],
      })
    );
    graph.getFollowerPubkeysGraph.mockResolvedValueOnce({
      pubkeys: [],
      fetchFailed: true,
    });
    const failed = await captureBroadcastActionError(
      resolveRecipientsForCampaign("user-1", "camp-1")
    );
    expect(failed.code).toBe("GRAPH_CACHE");
    expect(failed.message).toContain("verify custom recipients");

    graph.getFollowerPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_B],
      fetchFailed: false,
    });
    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
      campaign({ audienceType: "CUSTOM", customNpubLines: [HEX_A] })
    );
    const nonFollowers = await captureBroadcastActionError(
      resolveRecipientsForCampaign("user-1", "camp-1")
    );
    expect(nonFollowers.message).toBe(
      "None of the accounts you listed follow you. You can only message people who follow you."
    );

    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
      campaign({ audienceType: "CUSTOM", customNpubLines: ["not-a-pubkey"] })
    );
    const invalid = await captureBroadcastActionError(
      resolveRecipientsForCampaign("user-1", "camp-1")
    );
    expect(invalid.message).toBe(
      "No valid recipients. Fix invalid lines or add pubkeys that follow you."
    );

    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
      campaign({ audienceType: "CUSTOM", customNpubLines: ["  "] })
    );
    const empty = await captureBroadcastActionError(
      resolveRecipientsForCampaign("user-1", "camp-1")
    );
    expect(empty.message).toBe("Add at least one recipient who follows you.");

    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
      campaign({ audienceType: "CUSTOM", customNpubLines: [HEX_A] })
    );
    graph.getFollowerPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_A],
      fetchFailed: false,
    });
    prismaMock.broadcastSuppression.findMany.mockResolvedValue([
      { recipientPubkey: HEX_A.toUpperCase() },
    ]);
    const allSuppressed = await captureBroadcastActionError(
      resolveRecipientsForCampaign("user-1", "camp-1")
    );
    expect(allSuppressed.code).toBe("ALL_SUPPRESSED");
  });

  it("keeps custom followers who are not suppressed and applies exclusion rules", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
      campaign({
        audienceType: "CUSTOM",
        customNpubLines: [HEX_A, HEX_B, HEX_C, HEX_E, HEX_SELF],
        exclusionRulesJson: {
          excludeMessagedWithinDays: 400,
          excludePriorBroadcastRecipients: true,
        },
      })
    );
    graph.getFollowerPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_A, HEX_B, HEX_C, HEX_E, HEX_SELF],
      fetchFailed: false,
    });
    prismaMock.broadcastSuppression.findMany.mockResolvedValue([
      { recipientPubkey: HEX_B },
    ]);
    prismaMock.broadcastRecipient.findMany
      .mockResolvedValueOnce([{ recipientPubkey: HEX_C.toUpperCase() }])
      .mockResolvedValueOnce([{ recipientPubkey: HEX_A }]);

    await expect(
      resolveRecipientsForCampaign("user-1", "camp-1")
    ).resolves.toEqual({ total: 1, suppressed: 1, invalidCustom: 0 });

    const since = new Date(
      new Date("2026-06-15T00:00:00.000Z").getTime() - 365 * 86_400_000
    );
    expect(prismaMock.broadcastRecipient.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        campaign: { userId: "user-1" },
        sentAt: { gte: since },
        status: BroadcastRecipientStatus.SENT,
      },
      select: { recipientPubkey: true },
    });
    expect(prismaMock.broadcastRecipient.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        campaign: { userId: "user-1", id: { not: "camp-1" } },
        status: BroadcastRecipientStatus.SENT,
      },
      select: { recipientPubkey: true },
    });
    expect(tx.broadcastRecipient.createMany).toHaveBeenCalledWith({
      data: [
        {
          campaignId: "camp-1",
          recipientPubkey: HEX_E,
          sourceType: "CUSTOM",
          status: BroadcastRecipientStatus.PENDING,
        },
      ],
    });
    expect(prismaMock.broadcastEventLog.create).toHaveBeenCalledWith({
      data: objectContaining({
        metadataJson: {
          suppressedCount: 1,
          invalidCustom: 0,
          excludedNonFollowers: 0,
          excludedRecentMessaged: 1,
          excludedPriorBroadcast: 1,
        },
      }),
    });
  });

  it("rejects a custom audience that exclusion rules empty out", async () => {
    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
      campaign({
        audienceType: "CUSTOM",
        customNpubLines: [HEX_A],
        exclusionRulesJson: { excludePriorBroadcastRecipients: true },
      })
    );
    graph.getFollowerPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_A],
      fetchFailed: false,
    });
    prismaMock.broadcastRecipient.findMany.mockResolvedValue([
      { recipientPubkey: HEX_A },
    ]);

    const error = await captureBroadcastActionError(
      resolveRecipientsForCampaign("user-1", "camp-1")
    );
    expect(error.code).toBe("EMPTY_AUDIENCE");
    expect(error.message).toContain("excluded by your rules");
    expect(tx.broadcastRecipient.createMany).not.toHaveBeenCalled();
  });

  it("does not query recent recipients when exclusion rules are inactive", async () => {
    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
      campaign({
        exclusionRulesJson: {
          excludeMessagedWithinDays: 0,
          excludePriorBroadcastRecipients: false,
        },
      })
    );
    await resolveRecipientsForCampaign("user-1", "camp-1");
    expect(prismaMock.broadcastRecipient.findMany).not.toHaveBeenCalled();
  });

  it("clamps a fractional exclusion window to one day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(
      campaign({
        audienceType: "CUSTOM",
        customNpubLines: [HEX_A],
        exclusionRulesJson: { excludeMessagedWithinDays: 0.2 },
      })
    );
    graph.getFollowerPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_A],
      fetchFailed: false,
    });

    await expect(
      resolveRecipientsForCampaign("user-1", "camp-1")
    ).resolves.toEqual({ total: 1, suppressed: 0, invalidCustom: 0 });
    expect(prismaMock.broadcastRecipient.findMany).toHaveBeenCalledWith({
      where: {
        campaign: { userId: "user-1" },
        sentAt: {
          gte: new Date(
            new Date("2026-06-15T00:00:00.000Z").getTime() - 86_400_000
          ),
        },
        status: BroadcastRecipientStatus.SENT,
      },
      select: { recipientPubkey: true },
    });
  });

  it("rejects a resolved audience over the plan cap", async () => {
    entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue(limits(1));
    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(campaign());
    graph.getMutualPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_A, HEX_B],
      fetchFailed: false,
    });

    const error = await captureBroadcastActionError(
      resolveRecipientsForCampaign("user-1", "camp-1")
    );
    expect(error.code).toBe("LIMIT");
    expect(error.message).toBe("Too many recipients (max 1)");
    expect(tx.broadcastRecipient.createMany).not.toHaveBeenCalled();
  });
});
