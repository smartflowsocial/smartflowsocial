import { Prisma, type Giveaway } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const payments = vi.hoisted(() => ({
  getUserSubscription: vi.fn(
    async (
      _userId: string
    ): Promise<{
      planId: string;
      status: string;
      currentPeriodEnd?: Date | null;
      Plan?: { name: string; id: string; enableLifetimeAccess?: boolean };
    } | null> => null
  ),
}));

const entitlements = vi.hoisted(() => ({
  getEffectiveGiveawayPlanLimits: vi.fn(
    (
      planType: string
    ): {
      maxWinnerCount: number;
      canUseQueueScope: boolean;
      canUsePresets: boolean;
    } => ({
      maxWinnerCount: planType === "free" ? 10 : 50,
      canUseQueueScope: planType !== "free",
      canUsePresets: planType !== "free",
    })
  ),
}));

const repo = vi.hoisted(() => ({
  createGiveaway: vi.fn(
    async (
      _userId: string,
      _data: Prisma.GiveawayCreateInput
    ): Promise<Giveaway> => {
      throw new Error("createGiveaway mock was not armed");
    }
  ),
  deleteGiveawayById: vi.fn(async (_giveawayId: string): Promise<Giveaway> => {
    throw new Error("deleteGiveawayById mock was not armed");
  }),
  findGiveawayByIdAndUser: vi.fn(
    async (_id: string, _userId: string): Promise<Giveaway | null> => null
  ),
  listGiveawaysByUser: vi.fn(
    async (
      _userId: string,
      _options?: { status?: Giveaway["status"] }
    ): Promise<Giveaway[]> => []
  ),
  updateGiveaway: vi.fn(
    async (
      _giveawayId: string,
      _data: Prisma.GiveawayUpdateInput
    ): Promise<Giveaway> => {
      throw new Error("updateGiveaway mock was not armed");
    }
  ),
}));

vi.mock("~/features/payments/data", () => ({
  getUserSubscription: payments.getUserSubscription,
}));
vi.mock("~/features/payments/entitlements/deployment-mode.server", () => ({
  getEffectiveGiveawayPlanLimits: entitlements.getEffectiveGiveawayPlanLimits,
}));
vi.mock(
  "~/features/giveaway/repositories/giveaway-actions-data.server",
  () => ({
    createGiveaway: repo.createGiveaway,
    deleteGiveawayById: repo.deleteGiveawayById,
    findGiveawayByIdAndUser: repo.findGiveawayByIdAndUser,
    listGiveawaysByUser: repo.listGiveawaysByUser,
    updateGiveaway: repo.updateGiveaway,
  })
);

import type {
  CreateGiveawayInput,
  UpdateGiveawayInput,
} from "~/features/giveaway/giveaway-actions-crud.server";
import {
  createGiveaway,
  deleteGiveaway,
  duplicateGiveaway,
  getGiveawayById,
  listGiveawaysByUser,
  updateGiveaway,
} from "~/features/giveaway/giveaway-actions-crud.server";
import { DEFAULT_ENGAGEMENT_TYPES } from "~/features/giveaway/giveaway-actions-shared.server";

const FUTURE = new Date("2099-01-01T00:00:00.000Z");

function giveaway(overrides: Partial<Giveaway> = {}): Giveaway {
  const row: Giveaway = {
    id: "giveaway-1",
    userId: "user-1",
    name: "Spring",
    scopeType: "PERIOD",
    scopeReference: { days: 7 },
    eligibilityFrom: null,
    eligibilityTo: null,
    engagementTypes: ["REACTION"],
    winnerCount: 2,
    engagementConfig: null,
    selectionMode: "UNIQUE_USER",
    engagementWeights: null,
    filters: null,
    status: "DRAFT",
    lockedAt: null,
    lockedByUserId: null,
    plannedPayoutSats: null,
    finalizationFeeRateBps: null,
    finalizationFeeSats: null,
    finalizationFeeStatus: null,
    planAtFinalization: null,
    lockConfigHash: null,
    winnerSnapshot: null,
    payoutState: null,
    payoutWalletMode: "manual",
    payoutAutoRunEnabled: false,
    payoutAutoRunSpendCapSats: null,
    lastPreviewMeta: null,
    rerollCount: 0,
    activityLog: null,
    excludedPubkeys: null,
    createdAt: new Date("2099-01-01T00:00:00.000Z"),
    updatedAt: new Date("2099-01-02T00:00:00.000Z"),
    ...overrides,
  };
  return row;
}

function isCreateInput(value: object): value is CreateGiveawayInput {
  return (
    "scopeType" in value && "winnerCount" in value && "engagementTypes" in value
  );
}

function createInput(value: object): CreateGiveawayInput {
  if (!isCreateInput(value)) throw new Error("bad create fixture");
  return value;
}

function isUpdateInput(value: object): value is UpdateGiveawayInput {
  return (
    "engagementTypes" in value ||
    "name" in value ||
    "winnerCount" in value ||
    "engagementConfig" in value ||
    "selectionMode" in value
  );
}

function updateInput(value: object): UpdateGiveawayInput {
  if (!isUpdateInput(value)) throw new Error("bad update fixture");
  return value;
}

function createdInput(): Prisma.GiveawayCreateInput {
  const data = repo.createGiveaway.mock.calls[0]?.[1];
  if (!data) throw new Error("createGiveaway was not called");
  return data;
}

function updatedInput(): Prisma.GiveawayUpdateInput {
  const data = repo.updateGiveaway.mock.calls[0]?.[1];
  if (!data) throw new Error("updateGiveaway was not called");
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function activityTypes(value: unknown): string[] {
  if (!isUnknownArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const type = entry["type"];
    return typeof type === "string" ? [type] : [];
  });
}

function paidCreator(): void {
  payments.getUserSubscription.mockResolvedValue({
    planId: "creator",
    status: "ACTIVE",
    currentPeriodEnd: FUTURE,
    Plan: { name: "Creator", id: "creator" },
  });
}

describe("giveaway crud", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    entitlements.getEffectiveGiveawayPlanLimits.mockImplementation(
      (planType: string) => ({
        maxWinnerCount: planType === "free" ? 10 : 50,
        canUseQueueScope: planType !== "free",
        canUsePresets: planType !== "free",
      })
    );
    payments.getUserSubscription.mockResolvedValue(null);
    repo.createGiveaway.mockResolvedValue(giveaway({ id: "created-1" }));
    repo.findGiveawayByIdAndUser.mockResolvedValue(null);
    repo.updateGiveaway.mockResolvedValue(giveaway());
    repo.deleteGiveawayById.mockResolvedValue(giveaway());
    repo.listGiveawaysByUser.mockResolvedValue([]);
  });

  it("reads and lists giveaways for the user", async () => {
    const row = giveaway();
    repo.findGiveawayByIdAndUser.mockResolvedValueOnce(row);
    await expect(getGiveawayById("giveaway-1", "user-1")).resolves.toBe(row);
    repo.findGiveawayByIdAndUser.mockResolvedValueOnce(null);
    await expect(getGiveawayById("missing", "user-1")).resolves.toBeNull();
    expect(repo.findGiveawayByIdAndUser).toHaveBeenCalledWith(
      "missing",
      "user-1"
    );

    const rows = [giveaway({ id: "a" }), giveaway({ id: "b" })];
    repo.listGiveawaysByUser.mockResolvedValueOnce(rows);
    await expect(
      listGiveawaysByUser("user-1", { status: "PREVIEWED" })
    ).resolves.toBe(rows);
    expect(repo.listGiveawaysByUser).toHaveBeenCalledWith("user-1", {
      status: "PREVIEWED",
    });
    await expect(listGiveawaysByUser("user-1")).resolves.toEqual([]);
    expect(repo.listGiveawaysByUser).toHaveBeenCalledWith("user-1", undefined);
  });

  it("rejects queue scope on the free plan, including a period queue filter", async () => {
    await expect(
      createGiveaway("user-1", {
        scopeType: "QUEUE",
        scopeReference: { queueId: "q1" },
        engagementTypes: ["REACTION"],
        winnerCount: 1,
      })
    ).rejects.toThrow(
      "Queue filter is available on paid plans. Upgrade to limit giveaway to a specific queue."
    );
    await expect(
      createGiveaway("user-1", {
        scopeType: "PERIOD",
        scopeReference: { queueId: " q1 " },
        engagementTypes: ["REACTION"],
        winnerCount: 1,
      })
    ).rejects.toThrow("Queue filter is available on paid plans");
    payments.getUserSubscription.mockResolvedValue({
      planId: "creator",
      status: "CANCELED",
      currentPeriodEnd: FUTURE,
      Plan: { name: "Creator", id: "creator" },
    });
    await expect(
      createGiveaway("user-1", {
        scopeType: "QUEUE",
        scopeReference: { queueId: "q1" },
        engagementTypes: ["REACTION"],
        winnerCount: 1,
      })
    ).rejects.toThrow("Queue filter is available on paid plans");
    payments.getUserSubscription.mockResolvedValue({
      planId: "legacy",
      status: "ACTIVE",
      currentPeriodEnd: FUTURE,
      Plan: { name: "Legacy", id: "legacy" },
    });
    await expect(
      createGiveaway("user-1", {
        scopeType: "QUEUE",
        scopeReference: { queueId: "q1" },
        engagementTypes: ["REACTION"],
        winnerCount: 1,
      })
    ).rejects.toThrow("Queue filter is available on paid plans");
    expect(repo.createGiveaway).not.toHaveBeenCalled();
  });

  it("ignores a blank or non-string queue id on a free period giveaway", async () => {
    await createGiveaway("user-1", {
      name: "  ",
      scopeType: "PERIOD",
      scopeReference: { days: 3, queueId: "   " },
      engagementTypes: ["COMMENT"],
      winnerCount: 4.2,
      eligibilityFrom: null,
      eligibilityTo: null,
      engagementConfig: null,
      engagementWeights: null,
      filters: null,
    });
    const data = createdInput();
    expect(data.name).toBeUndefined();
    expect(data.winnerCount).toBe(4.2);
    expect(data.engagementTypes).toEqual(["COMMENT"]);
    expect(data.selectionMode).toBe("UNIQUE_USER");
    expect(data.plannedPayoutSats).toBeUndefined();
    expect(data.status).toBe("DRAFT");
    expect(data.eligibilityFrom).toBeUndefined();
    expect(data.filters).toBeUndefined();
    expect(activityTypes(data.activityLog)).toEqual(["giveaway_created"]);
    expect(entitlements.getEffectiveGiveawayPlanLimits).toHaveBeenCalledWith(
      "free"
    );
  });

  it("caps winners and stores a paid queue giveaway with every engagement type", async () => {
    paidCreator();
    const from = new Date("2099-02-01T00:00:00.000Z");
    await createGiveaway("user-1", {
      name: "  Queue drop  ",
      scopeType: "QUEUE",
      scopeReference: { queueId: "q1" },
      engagementTypes: ["REACTION"],
      winnerCount: 80,
      selectionMode: "WEIGHTED_BY_ENGAGEMENT",
      engagementWeights: { REPOST: 2 },
      filters: { excludeMuted: true },
      eligibilityFrom: from,
      eligibilityTo: FUTURE,
    });
    const data = createdInput();
    expect(data).toMatchObject({
      user: { connect: { id: "user-1" } },
      name: "Queue drop",
      scopeType: "QUEUE",
      scopeReference: { queueId: "q1" },
      eligibilityFrom: from,
      eligibilityTo: FUTURE,
      engagementTypes: [...DEFAULT_ENGAGEMENT_TYPES],
      winnerCount: 50,
      selectionMode: "WEIGHTED_BY_ENGAGEMENT",
      engagementWeights: { REPOST: 2 },
      filters: { excludeMuted: true },
      plannedPayoutSats: undefined,
      status: "DRAFT",
    });
    expect(entitlements.getEffectiveGiveawayPlanLimits).toHaveBeenCalledWith(
      "creator"
    );
  });

  it("sums per-type winners and treats a missing winner count as zero", async () => {
    await createGiveaway(
      "user-1",
      createInput({
        scopeType: "PERIOD",
        scopeReference: { days: 7 },
        engagementTypes: ["REACTION", "REPOST"],
        winnerCount: 99,
        engagementConfig: {
          REACTION: { satsPerWinner: 5 },
          REPOST: { winnerCount: 4, satsPerWinner: 1 },
        },
      })
    );
    expect(createdInput().winnerCount).toBe(4);
    expect(createdInput().engagementConfig).toEqual({
      REACTION: { satsPerWinner: 5 },
      REPOST: { winnerCount: 4, satsPerWinner: 1 },
    });

    paidCreator();
    await createGiveaway("user-1", {
      scopeType: "SINGLE_POST",
      scopeReference: { postId: "post-1" },
      engagementTypes: ["ZAP"],
      winnerCount: 1,
      engagementConfig: {
        REACTION: { winnerCount: 40, satsPerWinner: 1 },
        COMMENT: { winnerCount: 40, satsPerWinner: 1 },
      },
    });
    expect(repo.createGiveaway.mock.calls[1]?.[1].winnerCount).toBe(50);
  });

  it("stores a follower pool payout and leaves a non-pool simple config without one", async () => {
    await createGiveaway("user-1", {
      name: null,
      scopeType: "FOLLOWERS",
      scopeReference: {},
      engagementTypes: ["REACTION"],
      winnerCount: 3,
      selectionMode: "WEIGHTED_BY_ENGAGEMENT",
      engagementWeights: { COMMENT: 2 },
      engagementConfig: { _simpleUnified: { satsPerWinner: 10.9 } },
    });
    expect(createdInput()).toMatchObject({
      name: undefined,
      engagementTypes: [],
      winnerCount: 3,
      selectionMode: "UNIQUE_USER",
      engagementWeights: undefined,
      engagementConfig: { _simpleUnified: { satsPerWinner: 10.9 } },
      plannedPayoutSats: 30,
    });

    await createGiveaway("user-1", {
      scopeType: "FOLLOWING",
      scopeReference: {},
      engagementTypes: [],
      winnerCount: 0,
      engagementConfig: { _simpleUnified: { satsPerWinner: 8 } },
    });
    expect(repo.createGiveaway.mock.calls[1]?.[1].plannedPayoutSats).toBe(0);

    await createGiveaway("user-1", {
      scopeType: "FOLLOWERS",
      scopeReference: {},
      engagementTypes: [],
      winnerCount: -4,
      engagementConfig: { _simpleUnified: { satsPerWinner: 0 } },
    });
    expect(repo.createGiveaway.mock.calls[2]?.[1]).toMatchObject({
      winnerCount: -4,
      plannedPayoutSats: 0,
    });

    await createGiveaway("user-1", {
      scopeType: "PERIOD",
      scopeReference: { days: 7 },
      engagementTypes: ["ZAP"],
      winnerCount: 2,
      engagementConfig: { _simpleUnified: { satsPerWinner: 15 } },
    });
    expect(
      repo.createGiveaway.mock.calls[3]?.[1].plannedPayoutSats
    ).toBeUndefined();

    await createGiveaway("user-1", {
      scopeType: "FOLLOWERS",
      scopeReference: {},
      engagementTypes: ["REACTION"],
      winnerCount: 2,
      engagementConfig: { REACTION: { winnerCount: 9, satsPerWinner: 3 } },
    });
    expect(repo.createGiveaway.mock.calls[4]?.[1]).toMatchObject({
      winnerCount: 2,
      engagementTypes: [],
      plannedPayoutSats: undefined,
      engagementConfig: { REACTION: { winnerCount: 9, satsPerWinner: 3 } },
    });
  });

  it("propagates repository failures as Error and string", async () => {
    repo.createGiveaway.mockRejectedValueOnce(new Error("db down"));
    await expect(
      createGiveaway("user-1", {
        scopeType: "PERIOD",
        scopeReference: {},
        engagementTypes: ["REACTION"],
        winnerCount: 1,
      })
    ).rejects.toThrow("db down");
    repo.createGiveaway.mockRejectedValueOnce("db string");
    await expect(
      createGiveaway("user-1", {
        scopeType: "PERIOD",
        scopeReference: {},
        engagementTypes: ["REACTION"],
        winnerCount: 1,
      })
    ).rejects.toBe("db string");
    repo.findGiveawayByIdAndUser.mockRejectedValueOnce(
      new Error("missing row")
    );
    await expect(getGiveawayById("giveaway-1", "user-1")).rejects.toThrow(
      "missing row"
    );
  });

  it("edits only drafts and leaves an empty period edit unsaved", async () => {
    repo.findGiveawayByIdAndUser.mockResolvedValueOnce(null);
    await expect(
      updateGiveaway("user-1", "missing", { name: "A" })
    ).resolves.toEqual({ success: false, error: "Giveaway not found" });
    repo.findGiveawayByIdAndUser.mockResolvedValueOnce(
      giveaway({ status: "PREVIEWED" })
    );
    await expect(
      updateGiveaway("user-1", "giveaway-1", { name: "A" })
    ).resolves.toEqual({
      success: false,
      error: "Only draft giveaways can be edited",
    });
    repo.findGiveawayByIdAndUser.mockResolvedValueOnce(
      giveaway({ status: "DRAFT", scopeType: "PERIOD" })
    );
    await expect(updateGiveaway("user-1", "giveaway-1", {})).resolves.toEqual({
      success: true,
    });
    expect(repo.updateGiveaway).not.toHaveBeenCalled();
  });

  it("trims the name, floors the winner count, and requires an engagement type", async () => {
    repo.findGiveawayByIdAndUser.mockResolvedValue(
      giveaway({ status: "DRAFT", scopeType: "SINGLE_POST" })
    );
    await expect(
      updateGiveaway("user-1", "giveaway-1", {
        name: "  Edited  ",
        winnerCount: 4.2,
        engagementTypes: ["ZAP", "COMMENT"],
        selectionMode: "WEIGHTED_BY_ENGAGEMENT",
      })
    ).resolves.toEqual({ success: true });
    expect(updatedInput()).toMatchObject({
      name: "Edited",
      winnerCount: 4,
      engagementTypes: ["ZAP", "COMMENT"],
      selectionMode: "WEIGHTED_BY_ENGAGEMENT",
    });
    expect(activityTypes(updatedInput().activityLog)).toEqual([
      "configuration_updated",
    ]);

    await expect(
      updateGiveaway("user-1", "giveaway-1", { name: null, winnerCount: 0.2 })
    ).resolves.toEqual({ success: true });
    expect(repo.updateGiveaway.mock.calls[1]?.[1]).toMatchObject({
      name: null,
      winnerCount: 1,
    });
    await updateGiveaway("user-1", "giveaway-1", { winnerCount: 80, name: "" });
    expect(repo.updateGiveaway.mock.calls[2]?.[1]).toMatchObject({
      name: "",
      winnerCount: 10,
    });
    await expect(
      updateGiveaway("user-1", "giveaway-1", { engagementTypes: [] })
    ).resolves.toEqual({
      success: false,
      error: "At least one engagement type required",
    });
    await expect(
      updateGiveaway(
        "user-1",
        "giveaway-1",
        updateInput({ engagementTypes: "REACTION" })
      )
    ).resolves.toEqual({
      success: false,
      error: "At least one engagement type required",
    });
    expect(repo.updateGiveaway).toHaveBeenCalledTimes(3);
  });

  it("replaces per-type winners, clears an empty config, and keeps simple mode", async () => {
    repo.findGiveawayByIdAndUser.mockResolvedValue(
      giveaway({ status: "DRAFT", scopeType: "PERIOD" })
    );
    await updateGiveaway("user-1", "giveaway-1", {
      winnerCount: 9,
      engagementConfig: {
        REACTION: { winnerCount: 3, satsPerWinner: 10 },
        COMMENT: { winnerCount: 4, satsPerWinner: 2 },
      },
    });
    expect(updatedInput().winnerCount).toBe(7);
    expect(updatedInput().engagementConfig).toEqual({
      REACTION: { winnerCount: 3, satsPerWinner: 10 },
      COMMENT: { winnerCount: 4, satsPerWinner: 2 },
    });

    await updateGiveaway(
      "user-1",
      "giveaway-1",
      updateInput({
        engagementConfig: {
          REACTION: { satsPerWinner: 1 },
          REPOST: { winnerCount: 0, satsPerWinner: 1 },
        },
      })
    );
    expect(repo.updateGiveaway.mock.calls[1]?.[1].winnerCount).toBe(1);

    await updateGiveaway("user-1", "giveaway-1", { engagementConfig: {} });
    expect(repo.updateGiveaway.mock.calls[2]?.[1].engagementConfig).toBe(
      Prisma.JsonNull
    );
    await updateGiveaway("user-1", "giveaway-1", {
      engagementConfig: { _simpleUnified: { satsPerWinner: 12 } },
      winnerCount: 6,
    });
    expect(repo.updateGiveaway.mock.calls[3]?.[1]).toMatchObject({
      winnerCount: 6,
      engagementConfig: { _simpleUnified: { satsPerWinner: 12 } },
    });
  });

  it("resets follower drafts and forces every type for queue drafts", async () => {
    repo.findGiveawayByIdAndUser.mockResolvedValueOnce(
      giveaway({ status: "DRAFT", scopeType: "FOLLOWERS" })
    );
    await expect(
      updateGiveaway("user-1", "giveaway-1", {
        engagementTypes: ["ZAP"],
        engagementConfig: { REACTION: { winnerCount: 2, satsPerWinner: 5 } },
        selectionMode: "WEIGHTED_BY_ENGAGEMENT",
        winnerCount: 3.9,
      })
    ).resolves.toEqual({ success: true });
    expect(updatedInput()).toMatchObject({
      winnerCount: 3,
      engagementTypes: [],
      engagementConfig: Prisma.JsonNull,
      selectionMode: "UNIQUE_USER",
      engagementWeights: Prisma.JsonNull,
    });

    repo.findGiveawayByIdAndUser.mockResolvedValueOnce(
      giveaway({ status: "DRAFT", scopeType: "QUEUE" })
    );
    await expect(updateGiveaway("user-1", "giveaway-1", {})).resolves.toEqual({
      success: true,
    });
    expect(repo.updateGiveaway.mock.calls[1]?.[1].engagementTypes).toEqual([
      ...DEFAULT_ENGAGEMENT_TYPES,
    ]);
  });

  it("deletes draft, previewed, and cancelled giveaways only", async () => {
    repo.findGiveawayByIdAndUser.mockResolvedValueOnce(null);
    await expect(deleteGiveaway("user-1", "missing")).resolves.toEqual({
      success: false,
      error: "Giveaway not found",
    });
    for (const status of ["LOCKED", "PAID_OUT"] as const) {
      repo.findGiveawayByIdAndUser.mockResolvedValueOnce(giveaway({ status }));
      await expect(deleteGiveaway("user-1", "giveaway-1")).resolves.toEqual({
        success: false,
        error: "Cannot delete locked or paid-out giveaway",
      });
    }
    for (const status of ["DRAFT", "PREVIEWED", "CANCELLED"] as const) {
      repo.findGiveawayByIdAndUser.mockResolvedValueOnce(giveaway({ status }));
      await expect(deleteGiveaway("user-1", "giveaway-1")).resolves.toEqual({
        success: true,
      });
    }
    expect(repo.deleteGiveawayById).toHaveBeenCalledTimes(3);
    expect(repo.deleteGiveawayById).toHaveBeenCalledWith("giveaway-1");
  });

  it("duplicates a named giveaway and a blank one through create", async () => {
    repo.findGiveawayByIdAndUser.mockResolvedValueOnce(null);
    await expect(duplicateGiveaway("user-1", "missing")).resolves.toEqual({
      id: null,
      error: "Giveaway not found",
    });

    const from = new Date("2099-03-01T00:00:00.000Z");
    repo.findGiveawayByIdAndUser.mockResolvedValueOnce(
      giveaway({
        id: "gw_123456",
        name: "Spring",
        scopeType: "PERIOD",
        scopeReference: { days: 9 },
        eligibilityFrom: from,
        eligibilityTo: null,
        engagementTypes: ["ZAP"],
        winnerCount: 4,
        engagementConfig: { _simpleUnified: { satsPerWinner: 5 } },
        selectionMode: "WEIGHTED_BY_ENGAGEMENT",
        engagementWeights: { ZAP: 2 },
        filters: { excludeBlocked: true },
      })
    );
    await expect(duplicateGiveaway("user-1", "gw_123456")).resolves.toEqual({
      id: "created-1",
    });
    expect(createdInput()).toMatchObject({
      name: "Spring (copy)",
      scopeType: "PERIOD",
      scopeReference: { days: 9 },
      eligibilityFrom: from,
      eligibilityTo: undefined,
      engagementTypes: ["ZAP"],
      winnerCount: 4,
      selectionMode: "WEIGHTED_BY_ENGAGEMENT",
      engagementWeights: { ZAP: 2 },
      filters: { excludeBlocked: true },
    });

    repo.findGiveawayByIdAndUser.mockResolvedValueOnce(
      giveaway({ id: "abcdef", name: "" })
    );
    await duplicateGiveaway("user-1", "abcdef");
    expect(repo.createGiveaway.mock.calls[1]?.[1].name).toBe(
      "Giveaway copy abcdef"
    );
    repo.findGiveawayByIdAndUser.mockResolvedValueOnce(
      giveaway({ id: "blank-name", name: "  " })
    );
    await duplicateGiveaway("user-1", "blank-name");
    expect(repo.createGiveaway.mock.calls[2]?.[1].name).toBe("(copy)");

    repo.findGiveawayByIdAndUser.mockResolvedValueOnce(
      giveaway({ scopeType: "QUEUE", name: "Queued" })
    );
    await expect(duplicateGiveaway("user-1", "giveaway-1")).rejects.toThrow(
      "Queue filter is available on paid plans"
    );
  });
});
