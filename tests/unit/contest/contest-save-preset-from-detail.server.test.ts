import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  getContestById: vi.fn(),
}));

const presets = vi.hoisted(() => ({
  createContestPreset: vi.fn(),
}));

vi.mock("~/features/contest/contest-actions.server", () => actions);
vi.mock("~/features/contest/contest-presets.server", () => presets);

import { buildContest } from "./contest-test-doubles";

import { getContestById } from "~/features/contest/contest-actions.server";
import { createContestPreset } from "~/features/contest/contest-presets.server";
import { saveContestPresetFromDetailForm } from "~/features/contest/contest-save-preset-from-detail.server";

function form(name?: unknown): FormData {
  const data = new FormData();
  if (typeof name === "string") {
    data.set("presetName", name);
  }
  return data;
}

describe("saveContestPresetFromDetailForm", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("requires a preset name", async () => {
    await expect(
      saveContestPresetFromDetailForm("user-1", "contest-1", form())
    ).resolves.toEqual({
      success: false,
      error: "Preset name required",
      status: 400,
    });

    const fileForm = new FormData();
    fileForm.set("presetName", new File(["x"], "name.txt"));
    await expect(
      saveContestPresetFromDetailForm("user-1", "contest-1", fileForm)
    ).resolves.toEqual({
      success: false,
      error: "Preset name required",
      status: 400,
    });

    await expect(
      saveContestPresetFromDetailForm("user-1", "contest-1", form("   "))
    ).resolves.toEqual({
      success: false,
      error: "Preset name required",
      status: 400,
    });
    expect(getContestById).not.toHaveBeenCalled();
  });

  it("returns not found when the contest is missing", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(null);
    await expect(
      saveContestPresetFromDetailForm("user-1", "missing", form("Weekly"))
    ).resolves.toEqual({
      success: false,
      error: "Contest not found",
      status: 404,
    });
  });

  it("saves the contest prize settings under the trimmed name", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({
        title: "Summer",
        rankingMetric: "ZAPS",
        prizeMode: "RANKED",
        winnerCount: 2,
        equalRewardSats: null,
        rankRewards: [{ rank: 1, sats: 10 }],
        fairnessConfig: { excludeMuted: true },
      })
    );

    await expect(
      saveContestPresetFromDetailForm("user-1", "contest-1", form("  Weekly  "))
    ).resolves.toEqual({ success: true });
    expect(createContestPreset).toHaveBeenCalledWith("user-1", {
      name: "Weekly",
      title: "Summer",
      rankingMetric: "ZAPS",
      prizeMode: "RANKED",
      winnerCount: 2,
      equalRewardSats: null,
      rankRewards: [{ rank: 1, sats: 10 }],
      fairnessConfig: { excludeMuted: true },
    });
  });

  it("returns the error message or a fallback when saving throws", async () => {
    vi.mocked(getContestById).mockResolvedValue(buildContest());
    vi.mocked(createContestPreset).mockRejectedValueOnce(
      new Error("plan blocked")
    );
    await expect(
      saveContestPresetFromDetailForm("user-1", "contest-1", form("Weekly"))
    ).resolves.toEqual({
      success: false,
      error: "plan blocked",
      status: 400,
    });

    vi.mocked(createContestPreset).mockRejectedValueOnce("nope");
    await expect(
      saveContestPresetFromDetailForm("user-1", "contest-1", form("Weekly"))
    ).resolves.toEqual({
      success: false,
      error: "Failed to save preset",
      status: 400,
    });
  });
});
