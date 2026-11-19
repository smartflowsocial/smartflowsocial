import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  productSession: {
    findMany: vi.fn(),
  },
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));

import { getProductUsageBundle } from "~/features/admin/repositories/admin-product-usage-bundle.server";

const NOW = new Date("2026-06-15T12:00:00.000Z");

describe("getProductUsageBundle", () => {
  beforeEach(() => {
    prismaMock.productSession.findMany.mockReset();
  });

  it("returns zeros when no sessions exist", async () => {
    prismaMock.productSession.findMany.mockResolvedValue([]);

    const bundle = await getProductUsageBundle(
      { from: new Date("2026-01-01T00:00:00.000Z"), to: NOW },
      NOW
    );

    expect(bundle).toEqual({
      activeSessionUsersInRange: 0,
      dauRolling: 0,
      wauRolling: 0,
      mauRolling: 0,
      activeUsersConfidence: "insufficient_sample",
    });
    expect(prismaMock.productSession.findMany).toHaveBeenCalledTimes(4);
    expect(prismaMock.productSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { userId: true },
        distinct: ["userId"],
      })
    );
  });

  it("counts distinct users across the selected range and rolling windows", async () => {
    prismaMock.productSession.findMany.mockImplementation(
      (args: { where: { lastActivityAt: { gte: Date; lt: Date } } }) => {
        const span =
          args.where.lastActivityAt.lt.getTime() -
          args.where.lastActivityAt.gte.getTime();
        const days = span / 86_400_000;
        const count = days <= 2 ? 1 : days <= 8 ? 3 : days <= 31 ? 6 : 10;
        return Promise.resolve(
          Array.from({ length: count }, (_, index) => ({
            userId: `user-${index}`,
          }))
        );
      }
    );

    const bundle = await getProductUsageBundle(
      { from: new Date(NOW.getTime() - 90 * 86_400_000), to: NOW },
      NOW
    );

    expect(bundle).toEqual({
      activeSessionUsersInRange: 10,
      dauRolling: 1,
      wauRolling: 3,
      mauRolling: 6,
      activeUsersConfidence: "confident",
    });
  });

  it("marks a handful of session users as directional", async () => {
    prismaMock.productSession.findMany.mockResolvedValue([
      { userId: "a" },
      { userId: "b" },
      { userId: "c" },
      { userId: "d" },
    ]);

    const bundle = await getProductUsageBundle(
      { from: new Date(NOW.getTime() - 86_400_000), to: NOW },
      NOW
    );

    expect(bundle.activeSessionUsersInRange).toBe(4);
    expect(bundle.dauRolling).toBe(4);
    expect(bundle.wauRolling).toBe(4);
    expect(bundle.mauRolling).toBe(4);
    expect(bundle.activeUsersConfidence).toBe("directional");
  });
});
