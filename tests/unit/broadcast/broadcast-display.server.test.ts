import {
  BroadcastAudienceType,
  BroadcastCampaignStatus,
  BroadcastDeliveryMode,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  broadcastCampaign: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    groupBy: vi.fn(),
    count: vi.fn(),
  },
  broadcastRecipient: {
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    aggregate: vi.fn(),
  },
  broadcastSuppression: {
    findMany: vi.fn(),
  },
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));

import { anyDate } from "./action-error";

import {
  countActiveBroadcastCampaignsForUser,
  countRecentBroadcastRecipientsForUser,
  getBroadcastCampaignForUser,
  getBroadcastCampaignForUserWithRecipientSlice,
  getBroadcastDashboardSummary,
  getLatestBroadcastMessageSnippetForUser,
  getSuppressionFlagsForPubkeys,
  listBroadcastCampaignsByUser,
  listBroadcastCampaignsForIndex,
  listSuppressionsByUser,
} from "~/features/broadcast/broadcast-display.server";

const campaignListArgs = {
  orderBy: { updatedAt: "desc" },
  include: { _count: { select: { recipients: true } } },
};

describe("broadcast display", () => {
  beforeEach(() => {
    prismaMock.broadcastCampaign.findMany.mockReset();
    prismaMock.broadcastCampaign.findFirst.mockReset();
    prismaMock.broadcastCampaign.groupBy.mockReset();
    prismaMock.broadcastCampaign.count.mockReset();
    prismaMock.broadcastRecipient.findMany.mockReset();
    prismaMock.broadcastRecipient.count.mockReset();
    prismaMock.broadcastRecipient.groupBy.mockReset();
    prismaMock.broadcastRecipient.aggregate.mockReset();
    prismaMock.broadcastSuppression.findMany.mockReset();
  });

  it("lists campaigns with and without a status filter", async () => {
    const rows = [{ id: "camp-1" }];
    prismaMock.broadcastCampaign.findMany.mockResolvedValueOnce(rows);
    await expect(listBroadcastCampaignsByUser("user-1")).resolves.toBe(rows);
    expect(prismaMock.broadcastCampaign.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", archivedAt: null },
      ...campaignListArgs,
    });

    prismaMock.broadcastCampaign.findMany.mockResolvedValueOnce([]);
    await expect(
      listBroadcastCampaignsByUser("user-1", {
        status: BroadcastCampaignStatus.DRAFT,
      })
    ).resolves.toEqual([]);
    expect(prismaMock.broadcastCampaign.findMany).toHaveBeenLastCalledWith({
      where: {
        userId: "user-1",
        archivedAt: null,
        status: BroadcastCampaignStatus.DRAFT,
      },
      ...campaignListArgs,
    });
  });

  it("builds index filters for search, dates, audience, and delivery", async () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-02-01T00:00:00.000Z");
    prismaMock.broadcastCampaign.findMany.mockResolvedValue([{ id: "camp-1" }]);

    await expect(
      listBroadcastCampaignsForIndex("user-1", {
        search: "  Launch  ",
        draftsBucket: true,
        status: "IN_FLIGHT",
        audienceType: BroadcastAudienceType.CUSTOM,
        deliveryMode: BroadcastDeliveryMode.NIP04_ONLY,
        dateFrom: from,
        dateTo: to,
      })
    ).resolves.toEqual([{ id: "camp-1" }]);

    expect(prismaMock.broadcastCampaign.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        archivedAt: null,
        OR: [
          { name: { contains: "Launch", mode: "insensitive" } },
          { messageBody: { contains: "Launch", mode: "insensitive" } },
        ],
        status: "DRAFT",
        audienceType: BroadcastAudienceType.CUSTOM,
        deliveryMode: BroadcastDeliveryMode.NIP04_ONLY,
        updatedAt: { gte: from, lte: to },
      },
      ...campaignListArgs,
    });
  });

  it("selects in-flight, needs-attention, and exact statuses", async () => {
    prismaMock.broadcastCampaign.findMany.mockResolvedValue([]);

    await listBroadcastCampaignsForIndex("user-1", { status: "IN_FLIGHT" });
    expect(prismaMock.broadcastCampaign.findMany).toHaveBeenLastCalledWith({
      where: {
        userId: "user-1",
        archivedAt: null,
        status: { in: ["AWAITING_SIGNATURE", "QUEUED", "SENDING", "PAUSED"] },
      },
      ...campaignListArgs,
    });

    await listBroadcastCampaignsForIndex("user-1", {
      status: "NEEDS_ATTENTION",
      includeArchived: true,
      search: "   ",
    });
    expect(prismaMock.broadcastCampaign.findMany).toHaveBeenLastCalledWith({
      where: {
        userId: "user-1",
        status: { in: ["FAILED", "COMPLETED_WITH_FAILURES", "CANCELLED"] },
      },
      ...campaignListArgs,
    });

    await listBroadcastCampaignsForIndex("user-1", {
      status: BroadcastCampaignStatus.SCHEDULED,
      dateFrom: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(prismaMock.broadcastCampaign.findMany).toHaveBeenLastCalledWith({
      where: {
        userId: "user-1",
        archivedAt: null,
        status: BroadcastCampaignStatus.SCHEDULED,
        updatedAt: { gte: new Date("2026-03-01T00:00:00.000Z") },
      },
      ...campaignListArgs,
    });

    await listBroadcastCampaignsForIndex("user-1", {
      dateTo: new Date("2026-04-01T00:00:00.000Z"),
    });
    expect(prismaMock.broadcastCampaign.findMany).toHaveBeenLastCalledWith({
      where: {
        userId: "user-1",
        archivedAt: null,
        updatedAt: { lte: new Date("2026-04-01T00:00:00.000Z") },
      },
      ...campaignListArgs,
    });
  });

  it("summarizes dashboard buckets and treats missing statuses as zero", async () => {
    prismaMock.broadcastCampaign.groupBy.mockResolvedValueOnce([
      { status: "DRAFT", _count: { _all: 2 } },
      { status: "SCHEDULED", _count: { _all: 1 } },
      { status: "AWAITING_SIGNATURE", _count: { _all: 1 } },
      { status: "QUEUED", _count: { _all: 1 } },
      { status: "SENDING", _count: { _all: 1 } },
      { status: "PAUSED", _count: { _all: 1 } },
      { status: "COMPLETED", _count: { _all: 3 } },
      { status: "FAILED", _count: { _all: 1 } },
      { status: "COMPLETED_WITH_FAILURES", _count: { _all: 1 } },
      { status: "CANCELLED", _count: { _all: 1 } },
    ]);

    await expect(getBroadcastDashboardSummary("user-1")).resolves.toEqual({
      drafts: 2,
      scheduled: 1,
      inProgress: 4,
      completed: 3,
      attention: 3,
    });
    expect(prismaMock.broadcastCampaign.groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { userId: "user-1", archivedAt: null },
      _count: { _all: true },
    });

    prismaMock.broadcastCampaign.groupBy.mockResolvedValueOnce([]);
    await expect(getBroadcastDashboardSummary("user-1")).resolves.toEqual({
      drafts: 0,
      scheduled: 0,
      inProgress: 0,
      completed: 0,
      attention: 0,
    });
  });

  it("loads a campaign for the user or returns null", async () => {
    const campaign = { id: "camp-1", recipients: [], eventLogs: [] };
    prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce(campaign);
    await expect(getBroadcastCampaignForUser("camp-1", "user-1")).resolves.toBe(
      campaign
    );
    expect(prismaMock.broadcastCampaign.findFirst).toHaveBeenCalledWith({
      where: { id: "camp-1", userId: "user-1" },
      include: {
        recipients: { orderBy: { createdAt: "asc" } },
        eventLogs: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });

    prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce(null);
    await expect(
      getBroadcastCampaignForUser("missing", "user-1")
    ).resolves.toBeNull();
  });

  it("returns null before querying recipients when the campaign is missing", async () => {
    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(null);
    await expect(
      getBroadcastCampaignForUserWithRecipientSlice("camp-1", "user-1", {})
    ).resolves.toBeNull();
    expect(prismaMock.broadcastRecipient.findMany).not.toHaveBeenCalled();
  });

  it("returns a recipient slice and clamps take and skip", async () => {
    const campaign = { id: "camp-1" };
    prismaMock.broadcastCampaign.findFirst.mockResolvedValue(campaign);
    prismaMock.broadcastRecipient.findMany.mockResolvedValue([{ id: "rec-1" }]);
    prismaMock.broadcastRecipient.count.mockResolvedValue(1);
    prismaMock.broadcastRecipient.groupBy
      .mockResolvedValueOnce([{ failureCode: "PUBLISH", _count: { _all: 2 } }])
      .mockResolvedValueOnce([
        { deliveryMethodUsed: "NIP04", _count: { _all: 1 } },
      ]);
    prismaMock.broadcastRecipient.aggregate.mockResolvedValue({
      _sum: { attemptCount: 4 },
    });

    await expect(
      getBroadcastCampaignForUserWithRecipientSlice("camp-1", "user-1", {
        status: "FAILED",
        search: " AbC ",
        take: 900,
        skip: -3,
      })
    ).resolves.toEqual({
      campaign,
      recipients: [{ id: "rec-1" }],
      recipientTotal: 1,
      failureByCode: [{ failureCode: "PUBLISH", _count: { _all: 2 } }],
      deliverySplit: [{ deliveryMethodUsed: "NIP04", _count: { _all: 1 } }],
      retrySum: 4,
    });

    expect(prismaMock.broadcastCampaign.findFirst).toHaveBeenCalledWith({
      where: { id: "camp-1", userId: "user-1" },
      include: { eventLogs: { orderBy: { createdAt: "desc" }, take: 50 } },
    });
    expect(prismaMock.broadcastRecipient.findMany).toHaveBeenCalledWith({
      where: {
        campaignId: "camp-1",
        status: "FAILED",
        recipientPubkey: { contains: "abc" },
      },
      orderBy: { createdAt: "asc" },
      take: 500,
      skip: 0,
    });
    expect(prismaMock.broadcastRecipient.groupBy).toHaveBeenNthCalledWith(1, {
      by: ["failureCode"],
      where: {
        campaignId: "camp-1",
        status: "FAILED",
        failureCode: { not: null },
      },
      _count: { _all: true },
    });
    expect(prismaMock.broadcastRecipient.aggregate).toHaveBeenCalledWith({
      where: { campaignId: "camp-1" },
      _sum: { attemptCount: true },
    });
  });

  it("ignores ALL and blank statuses and defaults an empty retry sum", async () => {
    prismaMock.broadcastCampaign.findFirst.mockResolvedValue({ id: "camp-1" });
    prismaMock.broadcastRecipient.findMany.mockResolvedValue([]);
    prismaMock.broadcastRecipient.count.mockResolvedValue(0);
    prismaMock.broadcastRecipient.groupBy.mockResolvedValue([]);
    prismaMock.broadcastRecipient.aggregate.mockResolvedValue({
      _sum: { attemptCount: null },
    });

    await expect(
      getBroadcastCampaignForUserWithRecipientSlice("camp-1", "user-1", {
        status: "ALL",
        search: "   ",
        take: 0,
        skip: 5,
      })
    ).resolves.toMatchObject({
      recipients: [],
      recipientTotal: 0,
      retrySum: 0,
    });
    expect(prismaMock.broadcastRecipient.findMany).toHaveBeenLastCalledWith({
      where: { campaignId: "camp-1" },
      orderBy: { createdAt: "asc" },
      take: 1,
      skip: 5,
    });

    await getBroadcastCampaignForUserWithRecipientSlice("camp-1", "user-1", {
      status: "",
    });
    expect(prismaMock.broadcastRecipient.findMany).toHaveBeenLastCalledWith({
      where: { campaignId: "camp-1" },
      orderBy: { createdAt: "asc" },
      take: 100,
      skip: 0,
    });
  });

  it("lists suppressions and flags pubkeys, including an empty input", async () => {
    prismaMock.broadcastSuppression.findMany.mockResolvedValueOnce([]);
    await expect(listSuppressionsByUser("user-1")).resolves.toEqual([]);
    expect(prismaMock.broadcastSuppression.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "desc" },
    });

    await expect(getSuppressionFlagsForPubkeys("user-1", [])).resolves.toEqual(
      {}
    );

    const hex = "ab".repeat(32);
    prismaMock.broadcastSuppression.findMany.mockResolvedValueOnce([
      { recipientPubkey: hex.toUpperCase() },
    ]);
    await expect(
      getSuppressionFlagsForPubkeys("user-1", [hex])
    ).resolves.toEqual({ [hex]: true });
    expect(prismaMock.broadcastSuppression.findMany).toHaveBeenLastCalledWith({
      where: {
        userId: "user-1",
        recipientPubkey: { in: [hex] },
        OR: [
          { permanent: true },
          { expiresAt: null },
          { expiresAt: { gt: anyDate() } },
        ],
      },
      select: { recipientPubkey: true },
    });
  });

  it("counts recent recipients and active campaigns", async () => {
    const since = new Date("2026-05-01T00:00:00.000Z");
    prismaMock.broadcastRecipient.count.mockResolvedValue(4);
    prismaMock.broadcastCampaign.count.mockResolvedValue(0);

    await expect(
      countRecentBroadcastRecipientsForUser("user-1", since)
    ).resolves.toBe(4);
    expect(prismaMock.broadcastRecipient.count).toHaveBeenCalledWith({
      where: { sentAt: { gte: since }, campaign: { userId: "user-1" } },
    });
    await expect(countActiveBroadcastCampaignsForUser("user-1")).resolves.toBe(
      0
    );
    expect(prismaMock.broadcastCampaign.count).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        archivedAt: null,
        status: { in: ["SCHEDULED", "QUEUED", "SENDING", "PAUSED"] },
      },
    });
  });

  it("returns a trimmed snippet, a truncation, or null", async () => {
    prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce(null);
    await expect(
      getLatestBroadcastMessageSnippetForUser("user-1")
    ).resolves.toBeNull();

    prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce({
      messageBody: "   ",
    });
    await expect(
      getLatestBroadcastMessageSnippetForUser("user-1")
    ).resolves.toBeNull();

    prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce({
      messageBody: "  hello friends  ",
    });
    await expect(
      getLatestBroadcastMessageSnippetForUser("user-1")
    ).resolves.toBe("hello friends");

    const long = "m".repeat(501);
    prismaMock.broadcastCampaign.findFirst.mockResolvedValueOnce({
      messageBody: long,
    });
    await expect(
      getLatestBroadcastMessageSnippetForUser("user-1")
    ).resolves.toBe("m".repeat(500));
    expect(prismaMock.broadcastCampaign.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", messageBody: { not: "" } },
      orderBy: { updatedAt: "desc" },
      select: { messageBody: true },
    });
  });
});
