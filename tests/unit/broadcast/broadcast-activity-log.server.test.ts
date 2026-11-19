import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  broadcastEventLog: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));

import {
  appendBroadcastEventLog,
  listBroadcastEventLogs,
} from "~/features/broadcast/broadcast-activity-log.server";
import type { AppPrismaTransactionClient } from "~/lib/prisma.server";

describe("broadcast activity log", () => {
  beforeEach(() => {
    prismaMock.broadcastEventLog.create.mockReset();
    prismaMock.broadcastEventLog.findMany.mockReset();
    prismaMock.broadcastEventLog.create.mockResolvedValue({ id: "log-1" });
  });

  it("writes an info log through prisma when no transaction is given", async () => {
    await appendBroadcastEventLog({
      campaignId: "camp-1",
      eventType: "draft_created",
      message: "Draft created",
    });

    expect(prismaMock.broadcastEventLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: "camp-1",
        level: "INFO",
        eventType: "draft_created",
        message: "Draft created",
        metadataJson: undefined,
      },
    });
  });

  it("writes level and metadata through the transaction client", async () => {
    const txClient = {
      broadcastEventLog: {
        create: vi.fn().mockResolvedValue({ id: "log-2" }),
      },
    };

    await appendBroadcastEventLog(
      {
        campaignId: "camp-1",
        level: "ERROR",
        eventType: "publish_failed",
        message: "relay down",
        metadataJson: { recipientId: "rec-1" },
      },
      { tx: txClient as unknown as AppPrismaTransactionClient }
    );

    expect(txClient.broadcastEventLog.create).toHaveBeenCalledWith({
      data: {
        campaignId: "camp-1",
        level: "ERROR",
        eventType: "publish_failed",
        message: "relay down",
        metadataJson: { recipientId: "rec-1" },
      },
    });
    expect(prismaMock.broadcastEventLog.create).not.toHaveBeenCalled();
  });

  it("lists logs with the default take and a caller-supplied take", async () => {
    prismaMock.broadcastEventLog.findMany.mockResolvedValueOnce([]);
    await expect(listBroadcastEventLogs("camp-1")).resolves.toEqual([]);
    expect(prismaMock.broadcastEventLog.findMany).toHaveBeenCalledWith({
      where: { campaignId: "camp-1" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const rows = [{ id: "log-1" }];
    prismaMock.broadcastEventLog.findMany.mockResolvedValueOnce(rows);
    await expect(listBroadcastEventLogs("camp-1", 5)).resolves.toBe(rows);
    expect(prismaMock.broadcastEventLog.findMany).toHaveBeenLastCalledWith({
      where: { campaignId: "camp-1" },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
  });
});
