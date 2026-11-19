import { BroadcastSuppressionReasonCode } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => {
  const tx = {
    broadcastUnsubscribeToken: { upsert: vi.fn() },
  };
  const prismaMock = {
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) =>
      work(tx)
    ),
    broadcastCampaign: { findFirst: vi.fn() },
    broadcastUnsubscribeToken: { findFirst: vi.fn(), update: vi.fn() },
    broadcastSuppression: { upsert: vi.fn() },
  };
  return { tx, prismaMock };
});

const queue = vi.hoisted(() => ({
  enqueueBroadcastRecipientJob: vi.fn(),
  cancelBroadcastRecipientJob: vi.fn(),
}));

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

const logs = vi.hoisted(() => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: boundary.prismaMock }));
vi.mock("~/infra/queue", () => queue);
vi.mock("~/features/nostr/social-graph.server", () => graph);
vi.mock("~/features/user", () => users);
vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => entitlements
);
vi.mock("~/features/payments/subscriptions.server", () => subscriptions);
vi.mock("~/lib/error-logger.server", () => logs);

import { anyDate, objectContaining } from "./action-error";

import {
  buildBroadcastUnsubscribeUrl,
  deriveBroadcastUnsubscribeRawToken as deriveWithSecret,
  hashBroadcastUnsubscribeToken,
} from "~/features/broadcast/broadcast-unsubscribe-crypto";
import {
  applyUnsubscribeFromRawToken,
  deriveBroadcastUnsubscribeRawToken,
  ensureUnsubscribeTokensForCampaign,
  getBroadcastUnsubscribeBaseUrl,
} from "~/features/broadcast/broadcast-unsubscribe.server";
import { env } from "~/lib/env.server";

const { prismaMock, tx } = boundary;
const HEX_A = "a".repeat(64);
const originalAppUrl = env.APP_URL;

describe("broadcast unsubscribe", () => {
  beforeEach(() => {
    tx.broadcastUnsubscribeToken.upsert.mockReset();
    prismaMock.broadcastCampaign.findFirst.mockReset();
    prismaMock.broadcastUnsubscribeToken.findFirst.mockReset();
    prismaMock.broadcastUnsubscribeToken.update.mockReset();
    prismaMock.broadcastSuppression.upsert.mockReset();
    logs.logInfo.mockReset();
    tx.broadcastUnsubscribeToken.upsert.mockResolvedValue({ id: "token-1" });
    prismaMock.broadcastUnsubscribeToken.update.mockResolvedValue({
      id: "token-row-1",
    });
    prismaMock.broadcastSuppression.upsert.mockResolvedValue({ id: "sup-1" });
    env.APP_URL = originalAppUrl;
  });

  afterEach(() => {
    env.APP_URL = originalAppUrl;
  });

  it("derives the raw token with the session secret", () => {
    expect(deriveBroadcastUnsubscribeRawToken("rec-1")).toBe(
      deriveWithSecret("rec-1", env.SESSION_SECRET)
    );
  });

  it("prefers APP_URL and otherwise uses the request origin", () => {
    const request = new Request("https://edge.example/broadcast/unsubscribe");
    env.APP_URL = "https://app.example/";
    expect(getBroadcastUnsubscribeBaseUrl(request)).toBe("https://app.example");

    env.APP_URL = "   ";
    expect(getBroadcastUnsubscribeBaseUrl(request)).toBe(
      "https://edge.example"
    );

    env.APP_URL = undefined;
    expect(getBroadcastUnsubscribeBaseUrl(request)).toBe(
      "https://edge.example"
    );
  });

  it("returns no tokens when the campaign is not awaiting a signature", async () => {
    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(null);
    await expect(
      ensureUnsubscribeTokensForCampaign(
        "user-1",
        "camp-1",
        "https://app.example/"
      )
    ).resolves.toEqual([]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.broadcastCampaign.findFirst).toHaveBeenCalledWith(
      objectContaining({
        where: objectContaining({ id: "camp-1", userId: "user-1" }),
      })
    );
  });

  it("upserts a token for each pending recipient", async () => {
    prismaMock.broadcastCampaign.findFirst.mockResolvedValue({
      id: "camp-1",
      recipients: [
        { id: "rec-1", recipientPubkey: HEX_A },
        { id: "rec-2", recipientPubkey: "b".repeat(64) },
      ],
    });

    const rows = await ensureUnsubscribeTokensForCampaign(
      "user-1",
      "camp-1",
      "https://app.example/"
    );
    const firstToken = deriveBroadcastUnsubscribeRawToken("rec-1");
    const secondToken = deriveBroadcastUnsubscribeRawToken("rec-2");

    expect(rows).toEqual([
      {
        id: "rec-1",
        recipientPubkey: HEX_A,
        unsubscribeUrl: buildBroadcastUnsubscribeUrl(
          firstToken,
          "https://app.example"
        ),
      },
      {
        id: "rec-2",
        recipientPubkey: "b".repeat(64),
        unsubscribeUrl: buildBroadcastUnsubscribeUrl(
          secondToken,
          "https://app.example"
        ),
      },
    ]);
    expect(tx.broadcastUnsubscribeToken.upsert).toHaveBeenNthCalledWith(1, {
      where: { recipientId: "rec-1" },
      create: {
        recipientId: "rec-1",
        tokenHash: hashBroadcastUnsubscribeToken(firstToken),
      },
      update: {},
    });
    expect(tx.broadcastUnsubscribeToken.upsert).toHaveBeenCalledTimes(2);
  });

  it("returns an empty list when a draft has no pending recipients", async () => {
    prismaMock.broadcastCampaign.findFirst.mockResolvedValue({
      id: "camp-1",
      recipients: [],
    });
    await expect(
      ensureUnsubscribeTokensForCampaign(
        "user-1",
        "camp-1",
        "https://app.example"
      )
    ).resolves.toEqual([]);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.broadcastUnsubscribeToken.upsert).not.toHaveBeenCalled();
  });

  it("ignores blank, malformed, unknown, and expired tokens", async () => {
    await expect(applyUnsubscribeFromRawToken(null)).resolves.toBe(false);
    await expect(applyUnsubscribeFromRawToken(undefined)).resolves.toBe(false);
    await expect(applyUnsubscribeFromRawToken("   ")).resolves.toBe(false);
    await expect(applyUnsubscribeFromRawToken("zz")).resolves.toBe(false);
    expect(
      prismaMock.broadcastUnsubscribeToken.findFirst
    ).not.toHaveBeenCalled();

    const raw = deriveBroadcastUnsubscribeRawToken("rec-1");
    prismaMock.broadcastUnsubscribeToken.findFirst.mockResolvedValueOnce(null);
    await expect(applyUnsubscribeFromRawToken(raw.toUpperCase())).resolves.toBe(
      false
    );
    expect(prismaMock.broadcastUnsubscribeToken.findFirst).toHaveBeenCalledWith(
      {
        where: { tokenHash: hashBroadcastUnsubscribeToken(raw) },
        include: { recipient: { include: { campaign: true } } },
      }
    );

    prismaMock.broadcastUnsubscribeToken.findFirst.mockResolvedValueOnce({
      id: "token-row-1",
      expiresAt: new Date(Date.now() - 60_000),
      usedAt: null,
      recipient: {
        recipientPubkey: HEX_A,
        campaign: { id: "camp-1", userId: "user-1" },
      },
    });
    await expect(applyUnsubscribeFromRawToken(`  ${raw}  `)).resolves.toBe(
      false
    );
    expect(prismaMock.broadcastSuppression.upsert).not.toHaveBeenCalled();
  });

  it("suppresses the recipient and marks a fresh token used", async () => {
    const raw = deriveBroadcastUnsubscribeRawToken("rec-9");
    prismaMock.broadcastUnsubscribeToken.findFirst.mockResolvedValue({
      id: "token-row-1",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      recipient: {
        recipientPubkey: HEX_A.toUpperCase(),
        campaign: { id: "campaign-1", userId: "user-1" },
      },
    });

    await expect(applyUnsubscribeFromRawToken(raw)).resolves.toBe(true);
    expect(prismaMock.broadcastSuppression.upsert).toHaveBeenCalledWith(
      objectContaining({
        where: {
          userId_recipientPubkey: {
            userId: "user-1",
            recipientPubkey: HEX_A,
          },
        },
        create: objectContaining({
          reasonCode: BroadcastSuppressionReasonCode.MANUAL_OPT_OUT,
          createdFromCampaignId: "campaign-1",
          recipientPubkey: HEX_A,
        }),
      })
    );
    expect(prismaMock.broadcastUnsubscribeToken.update).toHaveBeenCalledWith({
      where: { id: "token-row-1" },
      data: { usedAt: anyDate() },
    });
    expect(logs.logInfo).toHaveBeenCalledWith("broadcast_unsubscribe_applied", {
      tokenRowIdPrefix: "token-ro",
      campaignIdPrefix: "campaign",
    });
  });

  it("does not rewrite usedAt when the token was already used", async () => {
    const raw = deriveBroadcastUnsubscribeRawToken("rec-9");
    prismaMock.broadcastUnsubscribeToken.findFirst.mockResolvedValue({
      id: "token-row-1",
      expiresAt: null,
      usedAt: new Date("2026-01-01T00:00:00.000Z"),
      recipient: {
        recipientPubkey: HEX_A,
        campaign: { id: "campaign-1", userId: "user-1" },
      },
    });

    await expect(applyUnsubscribeFromRawToken(raw)).resolves.toBe(true);
    expect(prismaMock.broadcastSuppression.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.broadcastUnsubscribeToken.update).not.toHaveBeenCalled();
  });
});
