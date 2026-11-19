import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const query = () => vi.fn<(...args: unknown[]) => Promise<unknown>>();
  return {
    contestPreset: {
      create: query(),
      deleteMany: query(),
      findMany: query(),
      findFirst: query(),
      update: query(),
    },
  };
});

vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));

import { asReturn, buildPreset } from "../contest-test-doubles";

import type { Prisma } from "~/features/contest/data/contest-prisma-types.server";
import {
  createContestPresetRow,
  deleteContestPresetRow,
  getContestPresetByIdForUser,
  getContestPresetsByUser,
  updateContestPresetRow,
} from "~/features/contest/repositories/contest-presets-data.server";

describe("contest presets data repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("creates and lists presets, including an empty list", async () => {
    const preset = buildPreset();
    const data = asReturn<Prisma.ContestPresetCreateInput>({ name: "Preset" });
    prismaMock.contestPreset.create.mockResolvedValueOnce(preset);
    prismaMock.contestPreset.findMany.mockResolvedValueOnce([]);

    await expect(createContestPresetRow(data)).resolves.toBe(preset);
    await expect(getContestPresetsByUser("user-1")).resolves.toEqual([]);

    expect(prismaMock.contestPreset.create).toHaveBeenCalledWith({ data });
    expect(prismaMock.contestPreset.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { updatedAt: "desc" },
    });
  });

  it("deletes by id and user and returns null when a preset is missing", async () => {
    prismaMock.contestPreset.findFirst.mockResolvedValueOnce(null);
    await deleteContestPresetRow("user-1", "preset-1");
    await expect(
      getContestPresetByIdForUser("user-1", "preset-1")
    ).resolves.toBeNull();

    expect(prismaMock.contestPreset.deleteMany).toHaveBeenCalledWith({
      where: { id: "preset-1", userId: "user-1" },
    });
    expect(prismaMock.contestPreset.findFirst).toHaveBeenCalledWith({
      where: { id: "preset-1", userId: "user-1" },
    });
  });

  it("throws when the preset to update is not owned by the user", async () => {
    prismaMock.contestPreset.findFirst.mockResolvedValueOnce(null);
    await expect(
      updateContestPresetRow("preset-1", "user-1", { name: "Next" })
    ).rejects.toThrow("Contest preset not found");
    expect(prismaMock.contestPreset.update).not.toHaveBeenCalled();
  });

  it("updates a preset after confirming ownership", async () => {
    const preset = buildPreset({ name: "Next" });
    prismaMock.contestPreset.findFirst.mockResolvedValueOnce(preset);
    prismaMock.contestPreset.update.mockResolvedValueOnce(preset);

    await expect(
      updateContestPresetRow("preset-1", "user-1", { name: "Next" })
    ).resolves.toBe(preset);
    expect(prismaMock.contestPreset.update).toHaveBeenCalledWith({
      where: { id: "preset-1" },
      data: { name: "Next" },
    });
  });
});
