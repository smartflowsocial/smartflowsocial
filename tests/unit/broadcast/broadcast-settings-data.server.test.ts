import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));

import {
  findUserBroadcastSettings,
  updateUserBroadcastSettings,
} from "~/features/broadcast/repositories/broadcast-settings-data.server";

describe("broadcast settings repository", () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.update.mockReset();
  });

  it("returns null when the user or settings are missing", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    await expect(findUserBroadcastSettings("user-1")).resolves.toBeNull();

    prismaMock.user.findUnique.mockResolvedValueOnce({
      broadcastSettings: null,
    });
    await expect(findUserBroadcastSettings("user-1")).resolves.toBeNull();
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { broadcastSettings: true },
    });
  });

  it("returns stored settings and writes a replacement document", async () => {
    const settings = { quietHours: true };
    prismaMock.user.findUnique.mockResolvedValue({
      broadcastSettings: settings,
    });
    prismaMock.user.update.mockResolvedValue({ id: "user-1" });

    await expect(findUserBroadcastSettings("user-1")).resolves.toBe(settings);
    await updateUserBroadcastSettings("user-1", settings);

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { broadcastSettings: settings },
    });
  });
});
