import { ReferralEarningStatus, SubscriptionStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  longFormPost: { groupBy: vi.fn() },
  post: { groupBy: vi.fn() },
  referral: { count: vi.fn() },
  referralEarning: { aggregate: vi.fn(), groupBy: vi.fn() },
  subscription: { count: vi.fn() },
  user: { count: vi.fn() },
}));

const payoutApi = vi.hoisted(() => ({
  getReferrersEligibleForPayout: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));
vi.mock("~/features/referral/referral-payout.server", () => ({
  getReferrersEligibleForPayout: payoutApi.getReferrersEligibleForPayout,
}));

import { getAdminOverviewStats } from "~/features/admin/repositories/admin-overview-stats-data.server";
import { FREE_PLAN_ID } from "~/features/payments/plan-ids";

describe("getAdminOverviewStats", () => {
  beforeEach(() => {
    prismaMock.longFormPost.groupBy.mockReset();
    prismaMock.post.groupBy.mockReset();
    prismaMock.referral.count.mockReset();
    prismaMock.referralEarning.aggregate.mockReset();
    prismaMock.referralEarning.groupBy.mockReset();
    prismaMock.subscription.count.mockReset();
    prismaMock.user.count.mockReset();
    payoutApi.getReferrersEligibleForPayout.mockReset();
  });

  it("aggregates users, states, earnings, and a capped payout preview", async () => {
    prismaMock.user.count.mockImplementation(
      (args?: { where?: { isEnabled?: boolean } }) =>
        Promise.resolve(args?.where?.isEnabled ? 7 : 11)
    );
    prismaMock.subscription.count.mockImplementation(
      (args?: { where?: { NOT?: { planId?: string } } }) =>
        Promise.resolve(args?.where?.NOT?.planId === FREE_PLAN_ID ? 2 : 5)
    );
    prismaMock.post.groupBy.mockResolvedValue([
      { currentState: "SCHEDULED", _count: { _all: 5 } },
      { currentState: "PUBLISHED", _count: { _all: 12 } },
    ]);
    prismaMock.longFormPost.groupBy.mockResolvedValue([
      { currentState: "DRAFT", _count: { _all: 2 } },
      { currentState: "PUBLISHED", _count: { _all: 9 } },
    ]);
    prismaMock.referral.count.mockResolvedValue(4);
    prismaMock.referralEarning.groupBy.mockResolvedValue([
      { status: ReferralEarningStatus.PENDING, _count: { _all: 2 } },
      { status: ReferralEarningStatus.PAID, _count: { _all: 8 } },
      { status: ReferralEarningStatus.FAILED, _count: { _all: 1 } },
      { status: "LEGACY", _count: { _all: 9 } },
    ]);
    prismaMock.referralEarning.aggregate.mockResolvedValue({
      _sum: { commissionSats: 1500 },
    });
    payoutApi.getReferrersEligibleForPayout.mockResolvedValue(
      Array.from({ length: 21 }, (_, index) => ({
        referrerNpub: `npub_${index}`,
        pendingSats: 1000 + index,
      }))
    );

    const stats = await getAdminOverviewStats();

    expect(stats.usersTotal).toBe(11);
    expect(stats.usersEnabled).toBe(7);
    expect(stats.subscriptionsActivePaid).toBe(2);
    expect(stats.subscriptionsActiveAll).toBe(5);
    expect(stats.postsByCurrentState).toEqual([
      { currentState: "PUBLISHED", count: 12 },
      { currentState: "SCHEDULED", count: 5 },
    ]);
    expect(stats.longFormByCurrentState[0]).toEqual({
      currentState: "PUBLISHED",
      count: 9,
    });
    expect(stats.referralLinkCount).toBe(4);
    expect(stats.referralEarningsByStatus).toEqual({
      pending: 2,
      paid: 8,
      failed: 1,
    });
    expect(stats.referralPendingCommissionSats).toBe(1500);
    expect(stats.referralPayoutEligibleCount).toBe(21);
    expect(stats.referralPayoutEligiblePreviewNpubs).toHaveLength(20);
    expect(stats.referralPayoutEligiblePreviewNpubs[0]).toBe("npub_0");
    expect(stats.referralPayoutEligiblePreviewNpubs[19]).toBe("npub_19");
    expect(prismaMock.user.count).toHaveBeenCalledWith();
    expect(prismaMock.user.count).toHaveBeenCalledWith({
      where: { isEnabled: true },
    });
    expect(prismaMock.subscription.count).toHaveBeenCalledWith({
      where: {
        status: SubscriptionStatus.ACTIVE,
        NOT: { planId: FREE_PLAN_ID },
      },
    });
    expect(payoutApi.getReferrersEligibleForPayout).toHaveBeenCalledTimes(1);
    expect(prismaMock.referralEarning.aggregate).toHaveBeenCalledWith({
      where: { status: ReferralEarningStatus.PENDING },
      _sum: { commissionSats: true },
    });
  });

  it("returns zeros when every aggregate is empty", async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.subscription.count.mockResolvedValue(0);
    prismaMock.post.groupBy.mockResolvedValue([]);
    prismaMock.longFormPost.groupBy.mockResolvedValue([]);
    prismaMock.referral.count.mockResolvedValue(0);
    prismaMock.referralEarning.groupBy.mockResolvedValue([]);
    prismaMock.referralEarning.aggregate.mockResolvedValue({
      _sum: { commissionSats: null },
    });
    payoutApi.getReferrersEligibleForPayout.mockResolvedValue([]);

    const stats = await getAdminOverviewStats();

    expect(stats.usersTotal).toBe(0);
    expect(stats.postsByCurrentState).toEqual([]);
    expect(stats.longFormByCurrentState).toEqual([]);
    expect(stats.referralEarningsByStatus).toEqual({
      pending: 0,
      paid: 0,
      failed: 0,
    });
    expect(stats.referralPendingCommissionSats).toBe(0);
    expect(stats.referralPayoutEligibleCount).toBe(0);
    expect(stats.referralPayoutEligiblePreviewNpubs).toEqual([]);
    expect(prismaMock.post.groupBy).toHaveBeenCalled();
    expect(prismaMock.referral.count).toHaveBeenCalled();
  });
});
