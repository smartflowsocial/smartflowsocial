import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  broadcastEventLog: {
    findMany: vi.fn(),
  },
}));

const entitlements = vi.hoisted(() => ({
  getEffectiveBroadcastPlanLimits: vi.fn(),
  getEffectivePlanEntitlements: vi.fn(),
}));

const subscriptions = vi.hoisted(() => ({
  getSubscriptionData: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));
vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => entitlements
);
vi.mock("~/features/payments/subscriptions.server", () => subscriptions);

import {
  BroadcastActionError,
  countBroadcastRecipientsFinalizedToday,
  emptyGraphAudienceMessage,
  getPlanContext,
  MSG_CAMPAIGN_NOT_FOUND,
  MSG_FOLLOWERS_AUDIENCE_REMOVED,
  MSG_FOLLOWING_AUDIENCE_REMOVED,
  MSG_SAVED_AUDIENCE_NOT_FOUND,
  toSignedEventShape,
} from "~/features/broadcast/broadcast-actions-shared.server";

const validEvent = {
  id: "evt-1",
  pubkey: "a".repeat(64),
  created_at: 1_700_000_000,
  kind: 4,
  tags: [["p", "b".repeat(64)]],
  content: "hello",
  sig: "sig",
};

describe("BroadcastActionError", () => {
  it("sets the name, message, and code", () => {
    const error = new BroadcastActionError("Campaign not found", "NOT_FOUND");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("BroadcastActionError");
    expect(error.message).toBe("Campaign not found");
    expect(error.code).toBe("NOT_FOUND");
    expect(MSG_CAMPAIGN_NOT_FOUND).toBe("Campaign not found");
    expect(MSG_FOLLOWING_AUDIENCE_REMOVED).toContain("Following");
    expect(MSG_FOLLOWERS_AUDIENCE_REMOVED).toContain("followers");
    expect(MSG_SAVED_AUDIENCE_NOT_FOUND).toBe("Saved audience not found");
  });
});

describe("countBroadcastRecipientsFinalizedToday", () => {
  beforeEach(() => {
    vi.useRealTimers();
    prismaMock.broadcastEventLog.findMany.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns zero when there are no finalized logs", async () => {
    prismaMock.broadcastEventLog.findMany.mockResolvedValue([]);
    await expect(
      countBroadcastRecipientsFinalizedToday("user-1")
    ).resolves.toBe(0);
  });

  it("sums finite counts and ignores malformed metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:34:56.000Z"));
    prismaMock.broadcastEventLog.findMany.mockResolvedValue([
      { metadataJson: { count: 2 } },
      { metadataJson: { count: "3" } },
      { metadataJson: { count: "nope" } },
      { metadataJson: { count: null } },
      { metadataJson: { count: Number.POSITIVE_INFINITY } },
      { metadataJson: null },
      { metadataJson: "text" },
      { metadataJson: { other: 1 } },
      { metadataJson: [] },
    ]);

    await expect(
      countBroadcastRecipientsFinalizedToday("user-1")
    ).resolves.toBe(5);
    expect(prismaMock.broadcastEventLog.findMany).toHaveBeenCalledWith({
      where: {
        eventType: "finalized",
        createdAt: { gte: new Date("2026-03-15T00:00:00.000Z") },
        campaign: { userId: "user-1" },
      },
      select: { metadataJson: true },
    });
  });
});

describe("emptyGraphAudienceMessage", () => {
  it("describes each audience and falls back for custom lists", () => {
    expect(emptyGraphAudienceMessage("FOLLOWING")).toBe(
      "No accounts found in your follow list (kind 3)."
    );
    expect(emptyGraphAudienceMessage("FOLLOWERS")).toBe(
      "No followers were found for your account in the Nostr cache."
    );
    expect(emptyGraphAudienceMessage("MUTUALS")).toBe(
      "No mutual follows found for this audience."
    );
    expect(emptyGraphAudienceMessage("CUSTOM")).toBe(
      "No recipients in this audience."
    );
  });
});

describe("getPlanContext", () => {
  beforeEach(() => {
    entitlements.getEffectiveBroadcastPlanLimits.mockReset();
    subscriptions.getSubscriptionData.mockReset();
  });

  it("returns the plan type, effective limits, and subscription", async () => {
    const currentSubscription = {
      planId: "pro",
      status: "ACTIVE",
      currentPeriodEnd: new Date("2027-01-01T00:00:00.000Z"),
      Plan: { name: "Pro", id: "pro" },
    };
    const limits = {
      maxRecipientsPerCampaign: 500,
      maxConcurrentActiveCampaigns: 5,
      maxDailyBroadcastRecipients: 2000,
      allowedAudienceTypes: ["CUSTOM", "MUTUALS"],
      allowAdvancedDelivery: true,
      allowSchedule: true,
      allowStaggered: true,
    };
    subscriptions.getSubscriptionData.mockResolvedValue({
      user: { id: "user-1", isEnabled: true },
      currentSubscription,
    });
    entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue(limits);

    await expect(getPlanContext("user-1")).resolves.toEqual({
      planType: "pro",
      limits,
      currentSubscription,
    });
    expect(subscriptions.getSubscriptionData).toHaveBeenCalledWith("user-1");
    expect(entitlements.getEffectiveBroadcastPlanLimits).toHaveBeenCalledWith(
      "pro"
    );
  });
});

describe("toSignedEventShape", () => {
  it("rejects values that are not signed events", () => {
    expect(toSignedEventShape(null)).toBe(false);
    expect(toSignedEventShape("event")).toBe(false);
    expect(toSignedEventShape({})).toBe(false);
    expect(toSignedEventShape({ ...validEvent, id: 1 })).toBe(false);
    expect(toSignedEventShape({ ...validEvent, pubkey: 1 })).toBe(false);
    expect(toSignedEventShape({ ...validEvent, created_at: "1" })).toBe(false);
    expect(toSignedEventShape({ ...validEvent, kind: "4" })).toBe(false);
    expect(toSignedEventShape({ ...validEvent, tags: "p" })).toBe(false);
    expect(toSignedEventShape({ ...validEvent, content: 1 })).toBe(false);
    expect(toSignedEventShape({ ...validEvent, sig: 1 })).toBe(false);
  });

  it("accepts a complete signed event", () => {
    expect(toSignedEventShape(validEvent)).toBe(true);
  });
});
