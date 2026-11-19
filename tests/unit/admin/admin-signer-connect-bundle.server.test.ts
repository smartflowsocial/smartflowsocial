import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  signerReconnectEvent: {
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  user: {
    count: vi.fn(),
  },
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));

import { getSignerConnectHealthBundle } from "~/features/admin/repositories/admin-signer-connect-bundle.server";

const BOUNDS = {
  from: new Date("2026-06-01T00:00:00.000Z"),
  to: new Date("2026-06-15T00:00:00.000Z"),
};

describe("getSignerConnectHealthBundle", () => {
  beforeEach(() => {
    prismaMock.$queryRaw.mockReset();
    prismaMock.signerReconnectEvent.findMany.mockReset();
    prismaMock.signerReconnectEvent.groupBy.mockReset();
    prismaMock.user.count.mockReset();
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.signerReconnectEvent.findMany.mockResolvedValue([]);
    prismaMock.signerReconnectEvent.groupBy.mockResolvedValue([]);
    prismaMock.user.count.mockResolvedValue(0);
  });

  it("returns an empty reconnect sample", async () => {
    const bundle = await getSignerConnectHealthBundle(BOUNDS);

    expect(bundle).toEqual({
      enabledUsers: 0,
      usersWithNip46Profile: 0,
      usersExtensionOrUnset: 0,
      reconnectAttemptsInRange: 0,
      reconnectFailuresInRange: 0,
      reconnectFailureRatePct: null,
      distinctUsersWithFailureInRange: 0,
      failuresByBucket: [],
      reconnectConfidence: {
        confidence: "insufficient_sample",
        note: "No samples in this range.",
      },
    });
    expect(prismaMock.user.count).toHaveBeenCalledWith({
      where: { isEnabled: true },
    });
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
    expect(prismaMock.signerReconnectEvent.groupBy).toHaveBeenCalledTimes(2);
    expect(prismaMock.signerReconnectEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        distinct: ["userId"],
        select: { userId: true },
      })
    );
  });

  it("rolls up a confident sample and clamps nip46 counts above enabled users", async () => {
    prismaMock.user.count.mockResolvedValue(2);
    prismaMock.$queryRaw.mockResolvedValue([{ c: 5n }]);
    prismaMock.signerReconnectEvent.groupBy.mockImplementation(
      (args: { by: string[] }) => {
        if (args.by.includes("success")) {
          return Promise.resolve([
            { success: true, _count: { _all: 20 } },
            { success: false, _count: { _all: 5 } },
          ]);
        }
        return Promise.resolve([
          { failureBucket: "NETWORK", _count: { _all: 1 } },
          { failureBucket: null, _count: { _all: 9 } },
          { failureBucket: "TIMEOUT", _count: { _all: 4 } },
        ]);
      }
    );
    prismaMock.signerReconnectEvent.findMany.mockResolvedValue([
      { userId: "user-1" },
      { userId: "user-2" },
    ]);

    const bundle = await getSignerConnectHealthBundle(BOUNDS);

    expect(bundle.usersWithNip46Profile).toBe(5);
    expect(bundle.usersExtensionOrUnset).toBe(0);
    expect(bundle.reconnectAttemptsInRange).toBe(25);
    expect(bundle.reconnectFailuresInRange).toBe(5);
    expect(bundle.reconnectFailureRatePct).toBe(20);
    expect(bundle.distinctUsersWithFailureInRange).toBe(2);
    expect(bundle.failuresByBucket).toEqual([
      { bucket: "TIMEOUT", count: 4 },
      { bucket: "NETWORK", count: 1 },
    ]);
    expect(bundle.reconnectConfidence).toEqual({ confidence: "confident" });
  });

  it("treats a tiny all-failure sample as insufficient and drops null buckets", async () => {
    prismaMock.user.count.mockResolvedValue(10);
    prismaMock.signerReconnectEvent.groupBy.mockImplementation(
      (args: { by: string[] }) => {
        if (args.by.includes("success")) {
          return Promise.resolve([{ success: false, _count: { _all: 3 } }]);
        }
        return Promise.resolve([{ failureBucket: null, _count: { _all: 3 } }]);
      }
    );

    const bundle = await getSignerConnectHealthBundle(BOUNDS);

    expect(bundle.usersExtensionOrUnset).toBe(10);
    expect(bundle.reconnectAttemptsInRange).toBe(3);
    expect(bundle.reconnectFailuresInRange).toBe(3);
    expect(bundle.reconnectFailureRatePct).toBe(100);
    expect(bundle.failuresByBucket).toEqual([]);
    expect(bundle.reconnectConfidence).toEqual({
      confidence: "insufficient_sample",
      note: "Very few events  -  treat as directional only.",
    });
  });

  it("reports a zero failure rate and directional confidence for a mid-size sample", async () => {
    prismaMock.signerReconnectEvent.groupBy.mockImplementation(
      (args: { by: string[] }) => {
        if (args.by.includes("success")) {
          return Promise.resolve([{ success: true, _count: { _all: 10 } }]);
        }
        return Promise.resolve([]);
      }
    );

    const bundle = await getSignerConnectHealthBundle(BOUNDS);

    expect(bundle.reconnectAttemptsInRange).toBe(10);
    expect(bundle.reconnectFailuresInRange).toBe(0);
    expect(bundle.reconnectFailureRatePct).toBe(0);
    expect(bundle.reconnectConfidence).toEqual({
      confidence: "directional",
      note: "Low sample  -  trend direction only.",
    });
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
  });
});
