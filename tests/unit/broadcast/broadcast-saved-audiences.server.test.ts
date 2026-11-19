import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  broadcastSavedAudience: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
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

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));
vi.mock("~/features/nostr/social-graph.server", () => graph);
vi.mock("~/features/user", () => users);
vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => entitlements
);
vi.mock("~/features/payments/subscriptions.server", () => subscriptions);

import { captureBroadcastActionError } from "./action-error";

import {
  createBroadcastSavedAudience,
  deleteBroadcastSavedAudience,
  duplicateBroadcastSavedAudience,
  listBroadcastSavedAudiences,
  refreshSavedAudienceEstimate,
  updateBroadcastSavedAudience,
} from "~/features/broadcast/broadcast-saved-audiences.server";

const HEX_A = "a".repeat(64);
const HEX_SELF = "d".repeat(64);

describe("saved broadcast audiences", () => {
  beforeEach(() => {
    prismaMock.broadcastSavedAudience.findMany.mockReset();
    prismaMock.broadcastSavedAudience.findFirst.mockReset();
    prismaMock.broadcastSavedAudience.create.mockReset();
    prismaMock.broadcastSavedAudience.update.mockReset();
    prismaMock.broadcastSavedAudience.delete.mockReset();
    users.getUserById.mockReset();
    graph.getFollowedPubkeysGraph.mockReset();
    graph.getFollowerPubkeysGraph.mockReset();
    graph.getMutualPubkeysGraph.mockReset();
    prismaMock.broadcastSavedAudience.create.mockResolvedValue({
      id: "aud-new",
    });
    prismaMock.broadcastSavedAudience.update.mockResolvedValue({ id: "aud-1" });
    prismaMock.broadcastSavedAudience.delete.mockResolvedValue({ id: "aud-1" });
  });

  it("lists audiences for the user", async () => {
    prismaMock.broadcastSavedAudience.findMany.mockResolvedValueOnce([]);
    await expect(listBroadcastSavedAudiences("user-1")).resolves.toEqual([]);

    const rows = [{ id: "aud-1" }];
    prismaMock.broadcastSavedAudience.findMany.mockResolvedValueOnce(rows);
    await expect(listBroadcastSavedAudiences("user-1")).resolves.toBe(rows);
    expect(prismaMock.broadcastSavedAudience.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { updatedAt: "desc" },
    });
  });

  it("rejects removed audience types and creates a custom audience", async () => {
    const following = await captureBroadcastActionError(
      createBroadcastSavedAudience("user-1", {
        name: "Old",
        audienceType: "FOLLOWING",
        customNpubLines: [],
      })
    );
    expect(following.code).toBe("AUDIENCE");
    expect(following.message).toContain("Following");

    const followers = await captureBroadcastActionError(
      createBroadcastSavedAudience("user-1", {
        name: "Old",
        audienceType: "FOLLOWERS",
        customNpubLines: [],
      })
    );
    expect(followers.code).toBe("AUDIENCE");
    expect(followers.message).toContain("followers");
    expect(prismaMock.broadcastSavedAudience.create).not.toHaveBeenCalled();

    await expect(
      createBroadcastSavedAudience("user-1", {
        name: "Mutuals",
        audienceType: "MUTUALS",
        customNpubLines: [],
      })
    ).resolves.toEqual({ id: "aud-new" });
    expect(prismaMock.broadcastSavedAudience.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        name: "Mutuals",
        audienceType: "MUTUALS",
        customNpubLines: [],
        ruleSummary: null,
      },
    });

    await createBroadcastSavedAudience("user-1", {
      name: "Custom",
      audienceType: "CUSTOM",
      customNpubLines: [HEX_A],
      ruleSummary: "people nearby",
    });
    expect(prismaMock.broadcastSavedAudience.create).toHaveBeenLastCalledWith({
      data: {
        userId: "user-1",
        name: "Custom",
        audienceType: "CUSTOM",
        customNpubLines: [HEX_A],
        ruleSummary: "people nearby",
      },
    });
  });

  it("deletes an owned audience and rejects a missing one", async () => {
    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValueOnce(null);
    const missing = await captureBroadcastActionError(
      deleteBroadcastSavedAudience("user-1", "aud-1")
    );
    expect(missing.code).toBe("NOT_FOUND");
    expect(missing.message).toBe("Saved audience not found");
    expect(prismaMock.broadcastSavedAudience.delete).not.toHaveBeenCalled();

    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValueOnce({
      id: "aud-1",
    });
    await deleteBroadcastSavedAudience("user-1", "aud-1");
    expect(prismaMock.broadcastSavedAudience.findFirst).toHaveBeenCalledWith({
      where: { id: "aud-1", userId: "user-1" },
    });
    expect(prismaMock.broadcastSavedAudience.delete).toHaveBeenCalledWith({
      where: { id: "aud-1" },
    });
  });

  it("updates an audience and rejects missing or removed types", async () => {
    const following = await captureBroadcastActionError(
      updateBroadcastSavedAudience("user-1", "aud-1", {
        name: "Old",
        audienceType: "FOLLOWING",
        customNpubLines: [],
      })
    );
    expect(following.code).toBe("AUDIENCE");

    const followers = await captureBroadcastActionError(
      updateBroadcastSavedAudience("user-1", "aud-1", {
        name: "Old",
        audienceType: "FOLLOWERS",
        customNpubLines: [],
      })
    );
    expect(followers.code).toBe("AUDIENCE");
    expect(prismaMock.broadcastSavedAudience.findFirst).not.toHaveBeenCalled();

    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValueOnce(null);
    const missing = await captureBroadcastActionError(
      updateBroadcastSavedAudience("user-1", "aud-1", {
        name: "Next",
        audienceType: "CUSTOM",
        customNpubLines: [],
        ruleSummary: null,
      })
    );
    expect(missing.code).toBe("NOT_FOUND");

    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValueOnce({
      id: "aud-1",
    });
    await expect(
      updateBroadcastSavedAudience("user-1", "aud-1", {
        name: "Next",
        audienceType: "CUSTOM",
        customNpubLines: [HEX_A],
        ruleSummary: "updated",
      })
    ).resolves.toEqual({ id: "aud-1" });
    expect(prismaMock.broadcastSavedAudience.update).toHaveBeenCalledWith({
      where: { id: "aud-1" },
      data: {
        name: "Next",
        audienceType: "CUSTOM",
        customNpubLines: [HEX_A],
        ruleSummary: "updated",
      },
    });
  });

  it("duplicates an audience and rejects missing or removed types", async () => {
    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValueOnce(null);
    const missing = await captureBroadcastActionError(
      duplicateBroadcastSavedAudience("user-1", "aud-1")
    );
    expect(missing.code).toBe("NOT_FOUND");

    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValueOnce({
      id: "aud-1",
      name: "Mutuals",
      audienceType: "FOLLOWING",
      customNpubLines: [],
      ruleSummary: null,
    });
    const following = await captureBroadcastActionError(
      duplicateBroadcastSavedAudience("user-1", "aud-1")
    );
    expect(following.code).toBe("AUDIENCE");

    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValueOnce({
      id: "aud-1",
      name: "Everyone",
      audienceType: "FOLLOWERS",
      customNpubLines: [],
      ruleSummary: null,
    });
    const followers = await captureBroadcastActionError(
      duplicateBroadcastSavedAudience("user-1", "aud-1")
    );
    expect(followers.code).toBe("AUDIENCE");
    expect(prismaMock.broadcastSavedAudience.create).not.toHaveBeenCalled();

    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValueOnce({
      id: "aud-1",
      name: "Mutuals",
      audienceType: "MUTUALS",
      customNpubLines: [],
      ruleSummary: null,
    });
    await expect(
      duplicateBroadcastSavedAudience("user-1", "aud-1")
    ).resolves.toEqual({ id: "aud-new" });
    expect(prismaMock.broadcastSavedAudience.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        name: "Mutuals (copy)",
        audienceType: "MUTUALS",
        customNpubLines: [],
        ruleSummary: null,
      },
    });
  });

  it("refreshes a custom estimate and a mutual estimate", async () => {
    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValueOnce(null);
    const missing = await captureBroadcastActionError(
      refreshSavedAudienceEstimate("user-1", "aud-1")
    );
    expect(missing.code).toBe("NOT_FOUND");
    expect(users.getUserById).not.toHaveBeenCalled();

    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValue({
      id: "aud-1",
      audienceType: "CUSTOM",
      customNpubLines: [HEX_A],
    });
    users.getUserById.mockResolvedValueOnce(null);
    const noNpub = await captureBroadcastActionError(
      refreshSavedAudienceEstimate("user-1", "aud-1")
    );
    expect(noNpub.code).toBe("USER");
    expect(noNpub.message).toBe("User npub missing");

    users.getUserById.mockResolvedValueOnce({
      id: "user-1",
      npub: "not-a-pubkey",
    });
    const badKey = await captureBroadcastActionError(
      refreshSavedAudienceEstimate("user-1", "aud-1")
    );
    expect(badKey.code).toBe("USER");
    expect(badKey.message).toBe("Invalid account pubkey");

    users.getUserById.mockResolvedValue({ id: "user-1", npub: HEX_SELF });
    graph.getFollowerPubkeysGraph.mockResolvedValueOnce({
      pubkeys: [],
      fetchFailed: true,
    });
    const graphDown = await captureBroadcastActionError(
      refreshSavedAudienceEstimate("user-1", "aud-1")
    );
    expect(graphDown.code).toBe("GRAPH_CACHE");
    expect(prismaMock.broadcastSavedAudience.update).not.toHaveBeenCalled();

    graph.getFollowerPubkeysGraph.mockResolvedValueOnce({
      pubkeys: [HEX_A],
      fetchFailed: false,
    });
    await expect(
      refreshSavedAudienceEstimate("user-1", "aud-1")
    ).resolves.toEqual({ size: 1 });
    expect(graph.getFollowerPubkeysGraph).toHaveBeenCalledWith(HEX_SELF);
    expect(prismaMock.broadcastSavedAudience.update).toHaveBeenCalledWith({
      where: { id: "aud-1" },
      data: { lastResolvedSize: 1 },
    });

    prismaMock.broadcastSavedAudience.findFirst.mockResolvedValue({
      id: "aud-1",
      audienceType: "MUTUALS",
      customNpubLines: [],
    });
    graph.getMutualPubkeysGraph.mockResolvedValue({
      pubkeys: [HEX_A, HEX_SELF],
      fetchFailed: false,
    });
    await expect(
      refreshSavedAudienceEstimate("user-1", "aud-1")
    ).resolves.toEqual({ size: 2 });
    expect(graph.getMutualPubkeysGraph).toHaveBeenCalledWith(HEX_SELF);
    expect(prismaMock.broadcastSavedAudience.update).toHaveBeenLastCalledWith({
      where: { id: "aud-1" },
      data: { lastResolvedSize: 2 },
    });
  });
});
