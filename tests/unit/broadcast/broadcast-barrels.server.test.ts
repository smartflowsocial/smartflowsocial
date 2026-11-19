import { beforeEach, describe, expect, it, vi } from "vitest";

const queue = vi.hoisted(() => ({
  enqueueBroadcastRecipientJob: vi.fn(),
  cancelBroadcastRecipientJob: vi.fn(),
  broadcastRecipientJobId: (campaignId: string, recipientId: string) =>
    `broadcast:${campaignId}:${recipientId}`,
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

const prismaMock = vi.hoisted(() => ({
  broadcastCampaign: { findFirst: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));
vi.mock("~/infra/queue", () => queue);
vi.mock("~/features/nostr/social-graph.server", () => graph);
vi.mock("~/features/user", () => users);
vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => entitlements
);
vi.mock("~/features/payments/subscriptions.server", () => subscriptions);

import { emptyGraphAudienceMessage as emptyGraphDirect } from "~/features/broadcast/broadcast-actions-shared.server";
import {
  emptyGraphAudienceMessage,
  toSignedEventShape,
} from "~/features/broadcast/broadcast-actions.server";
import { normalizePubkeyInput } from "~/features/broadcast/broadcast-audience.server";
import {
  broadcastRecipientJobId,
  cancelBroadcastRecipientJob,
  enqueueBroadcastRecipientJob,
} from "~/features/broadcast/broadcast-queue.server";
import { normalizePubkeyInput as normalizeDirect } from "~/features/broadcast/broadcast-resolve.server";

describe("broadcast server barrels", () => {
  beforeEach(() => {
    queue.enqueueBroadcastRecipientJob.mockReset();
    queue.cancelBroadcastRecipientJob.mockReset();
    queue.enqueueBroadcastRecipientJob.mockResolvedValue(undefined);
    queue.cancelBroadcastRecipientJob.mockResolvedValue(true);
  });

  it("re-exports audience normalization and shared action helpers", () => {
    expect(normalizePubkeyInput).toBe(normalizeDirect);
    expect(normalizePubkeyInput("")).toBeNull();
    expect(emptyGraphAudienceMessage("CUSTOM")).toBe(
      emptyGraphDirect("CUSTOM")
    );
    expect(emptyGraphAudienceMessage("CUSTOM")).toBe(
      "No recipients in this audience."
    );
    expect(toSignedEventShape(null)).toBe(false);
  });

  it("re-exports queue helpers from the queue boundary", async () => {
    expect(broadcastRecipientJobId("camp-1", "rec-1")).toBe(
      "broadcast:camp-1:rec-1"
    );
    await enqueueBroadcastRecipientJob({
      campaignId: "camp-1",
      recipientId: "rec-1",
      userId: "user-1",
      scheduledForUnix: 0,
    });
    expect(queue.enqueueBroadcastRecipientJob).toHaveBeenCalledWith({
      campaignId: "camp-1",
      recipientId: "rec-1",
      userId: "user-1",
      scheduledForUnix: 0,
    });
    await expect(cancelBroadcastRecipientJob("camp-1", "rec-1")).resolves.toBe(
      true
    );
    expect(queue.cancelBroadcastRecipientJob).toHaveBeenCalledWith(
      "camp-1",
      "rec-1"
    );
  });
});
