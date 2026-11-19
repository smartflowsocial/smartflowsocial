import {
  ProductSessionDeviceCoarse,
  SignerReconnectFailureBucket,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  productSession: {
    findUnique: vi.fn(),
    update: vi.fn(async (_args: { data: { lastActivityAt: Date } }) => ({
      id: "session-1",
    })),
    updateMany: vi.fn(async (_args: { data: { endedAt: Date } }) => ({
      count: 1,
    })),
    upsert: vi.fn(
      async (_args: {
        create: {
          clientSessionId: string;
          deviceCoarse?: string;
          userId: string;
        };
        update: { deviceCoarse?: string; endedAt: null };
        where: {
          userId_clientSessionId: { clientSessionId: string; userId: string };
        };
      }) => ({ id: "session-1" })
    ),
  },
  signerReconnectEvent: {
    count: vi.fn(
      async (_args?: { where?: { createdAt?: { gte?: Date } } }) => 0
    ),
    create: vi.fn(),
  },
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));

import {
  endProductSession,
  insertSignerReconnectEvent,
  signerReconnectRecentCount,
  touchProductSessionHeartbeat,
  upsertProductSessionStart,
} from "~/features/admin/repositories/admin-telemetry.server";

describe("admin product telemetry", () => {
  beforeEach(() => {
    prismaMock.productSession.findUnique.mockReset();
    prismaMock.productSession.update.mockReset();
    prismaMock.productSession.updateMany.mockReset();
    prismaMock.productSession.upsert.mockReset();
    prismaMock.signerReconnectEvent.count.mockReset();
    prismaMock.signerReconnectEvent.create.mockReset();
    prismaMock.productSession.upsert.mockResolvedValue({ id: "session-1" });
    prismaMock.productSession.update.mockResolvedValue({ id: "session-1" });
    prismaMock.productSession.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.signerReconnectEvent.create.mockResolvedValue({ id: "event-1" });
  });

  it("starts a session without a device and with a coarse device", async () => {
    await upsertProductSessionStart({
      userId: "user-1",
      clientSessionId: "sess-1",
      deviceCoarse: null,
    });
    await upsertProductSessionStart({
      userId: "user-1",
      clientSessionId: "sess-2",
      deviceCoarse: ProductSessionDeviceCoarse.desktop,
    });

    const first = prismaMock.productSession.upsert.mock.calls[0]?.[0];
    expect(first?.where.userId_clientSessionId).toEqual({
      userId: "user-1",
      clientSessionId: "sess-1",
    });
    expect(first?.create.userId).toBe("user-1");
    expect(first?.create.clientSessionId).toBe("sess-1");
    expect(first?.create.deviceCoarse).toBeUndefined();
    expect(first?.update.endedAt).toBeNull();
    expect(first?.update).not.toHaveProperty("deviceCoarse");

    const second = prismaMock.productSession.upsert.mock.calls[1]?.[0];
    expect(second?.create.deviceCoarse).toBe(
      ProductSessionDeviceCoarse.desktop
    );
    expect(second?.update.deviceCoarse).toBe(
      ProductSessionDeviceCoarse.desktop
    );
    expect(second?.update.endedAt).toBeNull();
  });

  it("restarts a heartbeat when the session is missing or already ended", async () => {
    prismaMock.productSession.findUnique.mockResolvedValueOnce(null);
    await expect(
      touchProductSessionHeartbeat({
        userId: "user-1",
        clientSessionId: "missing",
      })
    ).resolves.toEqual({ ok: true });

    prismaMock.productSession.findUnique.mockResolvedValueOnce({
      lastActivityAt: new Date(),
      endedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await expect(
      touchProductSessionHeartbeat({
        userId: "user-1",
        clientSessionId: "ended",
      })
    ).resolves.toEqual({ ok: true });

    expect(prismaMock.productSession.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.productSession.update).not.toHaveBeenCalled();
  });

  it("throttles a recent heartbeat and accepts an old one", async () => {
    prismaMock.productSession.findUnique.mockResolvedValueOnce({
      lastActivityAt: new Date(),
      endedAt: null,
    });
    await expect(
      touchProductSessionHeartbeat({
        userId: "user-1",
        clientSessionId: "sess-1",
      })
    ).resolves.toEqual({ ok: false, reason: "throttled" });
    expect(prismaMock.productSession.update).not.toHaveBeenCalled();

    prismaMock.productSession.findUnique.mockResolvedValueOnce({
      lastActivityAt: new Date(Date.now() - 60_000),
      endedAt: null,
    });
    await expect(
      touchProductSessionHeartbeat({
        userId: "user-1",
        clientSessionId: "sess-1",
      })
    ).resolves.toEqual({ ok: true });
    expect(
      prismaMock.productSession.update.mock.calls[0]?.[0]?.data.lastActivityAt
    ).toBeInstanceOf(Date);
  });

  it("ends an open session", async () => {
    await endProductSession({ userId: "user-1", clientSessionId: "sess-1" });
    expect(
      prismaMock.productSession.updateMany.mock.calls[0]?.[0]?.data.endedAt
    ).toBeInstanceOf(Date);
  });

  it("counts recent signer reconnects", async () => {
    const since = new Date("2026-01-01T00:00:00.000Z");
    prismaMock.signerReconnectEvent.count.mockResolvedValue(4);

    await expect(signerReconnectRecentCount("user-1", since)).resolves.toBe(4);
    expect(prismaMock.signerReconnectEvent.count).toHaveBeenCalledWith({
      where: { userId: "user-1", createdAt: { gte: since } },
    });
  });

  it("rate limits reconnect inserts at 120 per hour", async () => {
    prismaMock.signerReconnectEvent.count.mockResolvedValue(120);

    await expect(
      insertSignerReconnectEvent({ userId: "user-1", success: false })
    ).resolves.toEqual({ ok: false, reason: "rate_limited" });
    expect(prismaMock.signerReconnectEvent.create).not.toHaveBeenCalled();
    expect(
      prismaMock.signerReconnectEvent.count.mock.calls[0]?.[0]?.where?.createdAt
        ?.gte
    ).toBeInstanceOf(Date);
  });

  it("stores a success with a null bucket and failures with a bucket or UNKNOWN", async () => {
    prismaMock.signerReconnectEvent.count.mockResolvedValue(119);

    await expect(
      insertSignerReconnectEvent({
        userId: "user-1",
        success: true,
        failureBucket: SignerReconnectFailureBucket.TIMEOUT,
      })
    ).resolves.toEqual({ ok: true });
    expect(prismaMock.signerReconnectEvent.create).toHaveBeenLastCalledWith({
      data: {
        userId: "user-1",
        success: true,
        failureBucket: null,
      },
    });

    await insertSignerReconnectEvent({
      userId: "user-2",
      success: false,
      failureBucket: SignerReconnectFailureBucket.NETWORK,
    });
    expect(prismaMock.signerReconnectEvent.create).toHaveBeenLastCalledWith({
      data: {
        userId: "user-2",
        success: false,
        failureBucket: SignerReconnectFailureBucket.NETWORK,
      },
    });

    await insertSignerReconnectEvent({
      userId: "user-3",
      success: false,
      failureBucket: null,
    });
    expect(prismaMock.signerReconnectEvent.create).toHaveBeenLastCalledWith({
      data: {
        userId: "user-3",
        success: false,
        failureBucket: SignerReconnectFailureBucket.UNKNOWN,
      },
    });
  });
});
