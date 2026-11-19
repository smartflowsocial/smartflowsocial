import { PaymentStatus, SubscriptionStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  payment: {
    aggregate: vi.fn(),
    count: vi.fn(
      async (_args?: {
        where?: { paidAt?: { gte?: Date; lt?: Date }; status?: string };
      }) => 0
    ),
  },
  referralEarning: {
    aggregate: vi.fn(),
  },
  subscription: {
    aggregate: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));

import { getMonetizationBundle } from "~/features/admin/repositories/admin-monetization-bundle.server";
import { FREE_PLAN_ID } from "~/features/payments/plan-ids";

const NOW = new Date("2026-06-15T12:00:00.000Z");

const PAID_WHERE = {
  status: SubscriptionStatus.ACTIVE,
  NOT: { planId: FREE_PLAN_ID },
};

describe("getMonetizationBundle", () => {
  beforeEach(() => {
    prismaMock.payment.aggregate.mockReset();
    prismaMock.payment.count.mockReset();
    prismaMock.referralEarning.aggregate.mockReset();
    prismaMock.subscription.aggregate.mockReset();
    prismaMock.subscription.count.mockReset();
    prismaMock.subscription.groupBy.mockReset();
  });

  it("returns zeros when money aggregates are null", async () => {
    prismaMock.subscription.aggregate.mockResolvedValue({
      _sum: { amountSats: null },
    });
    prismaMock.subscription.count.mockResolvedValue(0);
    prismaMock.subscription.groupBy.mockResolvedValue([]);
    prismaMock.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prismaMock.payment.count.mockResolvedValue(0);
    prismaMock.referralEarning.aggregate.mockResolvedValue({
      _sum: { commissionSats: null },
    });

    const bundle = await getMonetizationBundle("all", NOW);

    expect(bundle).toEqual({
      mrrSats: "0",
      arrRunRateSats: "0",
      activePaidSubscribers: 0,
      subscriptionsStartedInRange: 0,
      subscriptionsCanceledInRange: 0,
      netSubscriptionFlowInRange: 0,
      planMix: [],
      arppuSatsInRange: null,
      referredRevenueSatsInRange: 0,
      totalPaymentSatsInRange: 0,
      revenueConfidence: "insufficient_sample",
    });
    expect(prismaMock.subscription.aggregate).toHaveBeenCalledWith({
      where: PAID_WHERE,
      _sum: { amountSats: true },
    });
    const paidAt = prismaMock.payment.count.mock.calls[0]?.[0]?.where?.paidAt;
    expect(prismaMock.payment.count.mock.calls[0]?.[0]?.where?.status).toBe(
      PaymentStatus.COMPLETED
    );
    expect(paidAt?.lt).toEqual(NOW);
    expect(paidAt?.gte).toBeInstanceOf(Date);
  });

  it("computes MRR, sorted plan mix, and ARPPU from paid activity", async () => {
    prismaMock.subscription.aggregate.mockResolvedValue({
      _sum: { amountSats: BigInt(1000) },
    });
    prismaMock.subscription.count.mockImplementation(
      (args?: { where?: { status?: string; createdAt?: unknown } }) => {
        if (args?.where?.status === SubscriptionStatus.CANCELED) {
          return Promise.resolve(5);
        }
        if (args?.where?.createdAt) return Promise.resolve(2);
        return Promise.resolve(4);
      }
    );
    prismaMock.subscription.groupBy.mockResolvedValue([
      { planId: "starter", _count: { _all: 1 } },
      { planId: null, _count: { _all: 5 } },
      { planId: "pro", _count: { _all: 3 } },
    ]);
    prismaMock.payment.aggregate.mockResolvedValue({ _sum: { amount: 10 } });
    prismaMock.payment.count.mockResolvedValue(9);
    prismaMock.referralEarning.aggregate.mockResolvedValue({
      _sum: { commissionSats: 80 },
    });

    const bundle = await getMonetizationBundle("7d", NOW);

    expect(bundle.mrrSats).toBe("1000");
    expect(bundle.arrRunRateSats).toBe("12000");
    expect(bundle.activePaidSubscribers).toBe(4);
    expect(bundle.subscriptionsStartedInRange).toBe(2);
    expect(bundle.subscriptionsCanceledInRange).toBe(5);
    expect(bundle.netSubscriptionFlowInRange).toBe(-3);
    expect(bundle.planMix).toEqual([
      { planId: null, count: 5 },
      { planId: "pro", count: 3 },
      { planId: "starter", count: 1 },
    ]);
    expect(bundle.arppuSatsInRange).toBe(3);
    expect(bundle.referredRevenueSatsInRange).toBe(80);
    expect(bundle.totalPaymentSatsInRange).toBe(10);
    expect(bundle.revenueConfidence).toBe("confident");
    expect(prismaMock.subscription.count).toHaveBeenCalledWith({
      where: PAID_WHERE,
    });
    expect(prismaMock.referralEarning.aggregate).toHaveBeenCalled();
  });

  it("marks a small payment sample as directional and skips ARPPU without subscribers", async () => {
    prismaMock.subscription.aggregate.mockResolvedValue({
      _sum: { amountSats: BigInt(0) },
    });
    prismaMock.subscription.count.mockResolvedValue(0);
    prismaMock.subscription.groupBy.mockResolvedValue([]);
    prismaMock.payment.aggregate.mockResolvedValue({ _sum: { amount: 50 } });
    prismaMock.payment.count.mockResolvedValue(4);
    prismaMock.referralEarning.aggregate.mockResolvedValue({
      _sum: { commissionSats: 0 },
    });

    const bundle = await getMonetizationBundle("30d", NOW);

    expect(bundle.arppuSatsInRange).toBeNull();
    expect(bundle.totalPaymentSatsInRange).toBe(50);
    expect(bundle.revenueConfidence).toBe("directional");
    expect(prismaMock.payment.aggregate).toHaveBeenCalled();
  });
});
