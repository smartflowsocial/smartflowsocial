import { BroadcastSuppressionReasonCode } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  broadcastSuppression: {
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

const graph = vi.hoisted(() => ({
  getFollowedPubkeysGraph: vi.fn(),
  getFollowerPubkeysGraph: vi.fn(),
  getMutualPubkeysGraph: vi.fn(),
}));

const entitlements = vi.hoisted(() => ({
  getEffectiveBroadcastPlanLimits: vi.fn(),
  getEffectivePlanEntitlements: vi.fn(),
}));

const subscriptions = vi.hoisted(() => ({
  getSubscriptionData: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));
vi.mock("~/features/nostr/social-graph.server", () => graph);
vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => entitlements
);
vi.mock("~/features/payments/subscriptions.server", () => subscriptions);

import { captureBroadcastActionError } from "./action-error";

import {
  addBroadcastSuppression,
  removeBroadcastSuppression,
} from "~/features/broadcast/broadcast-suppression.server";

const HEX_A = "a".repeat(64);

describe("addBroadcastSuppression", () => {
  beforeEach(() => {
    prismaMock.broadcastSuppression.upsert.mockReset();
    prismaMock.broadcastSuppression.upsert.mockResolvedValue({ id: "sup-1" });
  });

  it("rejects a pubkey that cannot be normalized", async () => {
    const error = await captureBroadcastActionError(
      addBroadcastSuppression("user-1", "not-a-pubkey")
    );
    expect(error.code).toBe("VALIDATION");
    expect(error.message).toBe("Invalid npub or hex pubkey");
    expect(prismaMock.broadcastSuppression.upsert).not.toHaveBeenCalled();
  });

  it("upserts a permanent other-reason row when options are omitted", async () => {
    await addBroadcastSuppression("user-1", HEX_A.toUpperCase());

    expect(prismaMock.broadcastSuppression.upsert).toHaveBeenCalledWith({
      where: {
        userId_recipientPubkey: { userId: "user-1", recipientPubkey: HEX_A },
      },
      create: {
        userId: "user-1",
        recipientPubkey: HEX_A,
        reason: null,
        reasonCode: BroadcastSuppressionReasonCode.OTHER,
        permanent: true,
        expiresAt: null,
        createdFromCampaignId: null,
      },
      update: {
        reason: null,
        reasonCode: BroadcastSuppressionReasonCode.OTHER,
      },
    });
  });

  it("persists explicit reason, expiry, and campaign fields", async () => {
    const expiresAt = new Date("2026-12-01T00:00:00.000Z");
    await addBroadcastSuppression("user-1", HEX_A, {
      reason: "asked to stop",
      reasonCode: BroadcastSuppressionReasonCode.MANUAL_OPT_OUT,
      permanent: false,
      expiresAt,
      createdFromCampaignId: "camp-1",
    });

    expect(prismaMock.broadcastSuppression.upsert).toHaveBeenCalledWith({
      where: {
        userId_recipientPubkey: { userId: "user-1", recipientPubkey: HEX_A },
      },
      create: {
        userId: "user-1",
        recipientPubkey: HEX_A,
        reason: "asked to stop",
        reasonCode: BroadcastSuppressionReasonCode.MANUAL_OPT_OUT,
        permanent: false,
        expiresAt,
        createdFromCampaignId: "camp-1",
      },
      update: {
        reason: "asked to stop",
        reasonCode: BroadcastSuppressionReasonCode.MANUAL_OPT_OUT,
        permanent: false,
        expiresAt,
      },
    });
  });
});

describe("removeBroadcastSuppression", () => {
  beforeEach(() => {
    prismaMock.broadcastSuppression.deleteMany.mockReset();
    prismaMock.broadcastSuppression.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("deletes a normalized hex pubkey", async () => {
    await removeBroadcastSuppression("user-1", HEX_A.toUpperCase());
    expect(prismaMock.broadcastSuppression.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", recipientPubkey: HEX_A },
    });
  });

  it("lowercases input that is not a pubkey", async () => {
    await removeBroadcastSuppression("user-1", "Not-A-Key");
    expect(prismaMock.broadcastSuppression.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", recipientPubkey: "not-a-key" },
    });
  });
});
