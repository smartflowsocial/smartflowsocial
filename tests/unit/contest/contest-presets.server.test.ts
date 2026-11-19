import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const paymentsData = vi.hoisted(() => ({
  getUserSubscription: vi.fn(),
}));

const limitsApi = vi.hoisted(() => ({
  getEffectiveGiveawayPlanLimits: vi.fn(),
}));

const planApi = vi.hoisted(() => ({
  getUserPlanType: vi.fn(),
}));

const presetsData = vi.hoisted(() => ({
  createContestPresetRow: vi.fn(),
  deleteContestPresetRow: vi.fn(),
  getContestPresetByIdForUser: vi.fn(),
  getContestPresetsByUser: vi.fn(),
  updateContestPresetRow: vi.fn(),
}));

vi.mock("~/features/payments/data", () => paymentsData);
vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => limitsApi
);
vi.mock("~/features/payments/types", () => planApi);
vi.mock(
  "~/features/contest/repositories/contest-presets-data.server",
  () => presetsData
);

import { anyDate, buildPreset } from "./contest-test-doubles";

import {
  createContestPreset,
  deleteContestPreset,
  getContestPresetById,
  getContestPresetsForUser,
  touchContestPresetLastUsed,
} from "~/features/contest/contest-presets.server";
import {
  createContestPresetRow,
  deleteContestPresetRow,
  getContestPresetByIdForUser,
  getContestPresetsByUser,
  updateContestPresetRow,
} from "~/features/contest/repositories/contest-presets-data.server";
import { getUserSubscription } from "~/features/payments/data";
import { getEffectiveGiveawayPlanLimits } from "~/features/payments/entitlements/deployment-mode.server";
import { getUserPlanType } from "~/features/payments/types";

describe("contest presets", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getUserSubscription).mockResolvedValue(null);
    vi.mocked(getUserPlanType).mockReturnValue("free");
    vi.mocked(getEffectiveGiveawayPlanLimits).mockReturnValue({
      maxWinnerCount: 3,
      canUseQueueScope: false,
      canUsePresets: true,
    });
    vi.mocked(createContestPresetRow).mockResolvedValue(buildPreset());
  });

  it("refuses to save a preset when the plan cannot use presets", async () => {
    vi.mocked(getEffectiveGiveawayPlanLimits).mockReturnValue({
      maxWinnerCount: 3,
      canUseQueueScope: false,
      canUsePresets: false,
    });

    await expect(
      createContestPreset("user-1", {
        name: "Weekly",
        rankingMetric: "ZAPS",
        prizeMode: "EQUAL",
        winnerCount: 1,
      })
    ).rejects.toThrow(
      "Presets are available on paid plans. Upgrade to save contest presets."
    );
    expect(createContestPresetRow).not.toHaveBeenCalled();
  });

  it("stores a trimmed equal preset and clamps winners and rewards", async () => {
    await createContestPreset("user-1", {
      name: "  Weekly  ",
      title: "   ",
      rankingMetric: "ZAPS",
      prizeMode: "EQUAL",
      winnerCount: 0,
      equalRewardSats: null,
      fairnessConfig: null,
    });

    const created = vi.mocked(createContestPresetRow).mock.calls[0]?.[0];
    expect(created).toMatchObject({
      name: "Weekly",
      title: null,
      rankingMetric: "ZAPS",
      prizeMode: "EQUAL",
      winnerCount: 1,
      equalRewardSats: 0,
    });
    expect(created?.rankRewards).toBe(Prisma.JsonNull);
    expect(created?.fairnessConfig).toBeUndefined();
    expect(getUserPlanType).toHaveBeenCalledWith(null);
  });

  it("stores ranked rewards and a negative equal reward as zero when equal", async () => {
    await createContestPreset("user-1", {
      name: "Ranked",
      title: "  Title  ",
      rankingMetric: "REACTIONS",
      prizeMode: "RANKED",
      winnerCount: 80,
      equalRewardSats: 40,
      rankRewards: null,
      fairnessConfig: { excludeMuted: true },
    });
    const ranked = vi.mocked(createContestPresetRow).mock.calls[0]?.[0];
    expect(ranked).toMatchObject({
      title: "Title",
      winnerCount: 50,
      equalRewardSats: null,
      rankRewards: [],
      fairnessConfig: { excludeMuted: true },
    });

    await createContestPreset("user-1", {
      name: "Equal",
      title: null,
      rankingMetric: "ZAPS",
      prizeMode: "EQUAL",
      winnerCount: 2,
      equalRewardSats: -5,
    });
    expect(vi.mocked(createContestPresetRow).mock.calls[1]?.[0]).toMatchObject({
      title: null,
      equalRewardSats: 0,
    });
  });

  it("delegates delete, list, lookup, and last-used touches", async () => {
    const preset = buildPreset();
    vi.mocked(getContestPresetsByUser).mockResolvedValueOnce([preset]);
    vi.mocked(getContestPresetByIdForUser).mockResolvedValueOnce(null);

    await deleteContestPreset("user-1", "preset-1");
    await expect(getContestPresetsForUser("user-1")).resolves.toEqual([preset]);
    await expect(getContestPresetById("user-1", "missing")).resolves.toBeNull();
    await touchContestPresetLastUsed("user-1", "preset-1");

    expect(deleteContestPresetRow).toHaveBeenCalledWith("user-1", "preset-1");
    expect(getContestPresetsByUser).toHaveBeenCalledWith("user-1");
    expect(getContestPresetByIdForUser).toHaveBeenCalledWith(
      "user-1",
      "missing"
    );
    expect(updateContestPresetRow).toHaveBeenCalledWith("preset-1", "user-1", {
      lastUsedAt: anyDate(),
    });
  });
});
