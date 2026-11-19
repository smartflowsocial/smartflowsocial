import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  giveaway: { count: vi.fn() },
  longFormPost: { count: vi.fn() },
  post: { count: vi.fn(), findMany: vi.fn() },
  referral: { count: vi.fn() },
  referralEarning: { aggregate: vi.fn(), count: vi.fn() },
  subscription: { count: vi.fn() },
  user: { count: vi.fn() },
}));

const bundles = vi.hoisted(() => ({
  getMonetizationBundle: vi.fn(),
  getProductUsageBundle: vi.fn(),
  getSignerConnectHealthBundle: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));
vi.mock(
  "~/features/admin/repositories/admin-monetization-bundle.server",
  () => ({
    getMonetizationBundle: bundles.getMonetizationBundle,
  })
);
vi.mock(
  "~/features/admin/repositories/admin-product-usage-bundle.server",
  () => ({
    getProductUsageBundle: bundles.getProductUsageBundle,
  })
);
vi.mock(
  "~/features/admin/repositories/admin-signer-connect-bundle.server",
  () => ({
    getSignerConnectHealthBundle: bundles.getSignerConnectHealthBundle,
  })
);

import {
  getBoundsForPreset,
  getPreviousPeriodBounds,
} from "~/features/admin/metrics/date-range";
import { getAdminAnalyticsPageData } from "~/features/admin/repositories/admin-analytics-queries.server";

const NOW = new Date("2026-06-15T12:00:00.000Z");

interface DateWindow {
  gte: Date;
  lt: Date;
}

interface AnalyticsScenario {
  activeSubs: number;
  fail30: number;
  failLong: number;
  failShort: number;
  failedPayouts30d: number;
  giveaways: number;
  longForm: number;
  media: number;
  multiDay: bigint;
  newUsers: number;
  postDays: Array<{ d: Date; c: bigint }>;
  postsPublished: number;
  prevLong: number;
  prevNewUsers: number;
  prevPosts: number;
  prevReferred: number;
  prevSubs: number;
  pub30: number;
  publisherRows: number;
  publishersInRange: bigint;
  quotes: number;
  refDays: Array<{ d: Date; c: bigint }>;
  referralSats: number | null;
  referred: number;
  reposts: number;
  secondPublish: bigint;
  subDays: Array<{ d: Date; c: bigint }>;
  threads: number;
  totalLong: number;
  totalPublished: number;
  totalScheduled: number;
  userDays: Array<{ d: Date; c: bigint }>;
}

interface MockReset {
  mockReset: () => void;
}

function isMockReset(value: unknown): value is MockReset {
  if (typeof value !== "function" || !("mockReset" in value)) return false;
  return typeof value.mockReset === "function";
}

function resetTree(tree: Record<string, unknown>): void {
  for (const value of Object.values(tree)) {
    if (isMockReset(value)) {
      value.mockReset();
      continue;
    }
    if (value && typeof value === "object") {
      resetTree(value as Record<string, unknown>);
    }
  }
}

function quietMoney(mrrSats = "0") {
  return {
    activePaidSubscribers: 0,
    arppuSatsInRange: null,
    arrRunRateSats: "0",
    mrrSats,
    netSubscriptionFlowInRange: 0,
    planMix: [],
    referredRevenueSatsInRange: 0,
    revenueConfidence: "insufficient_sample",
    subscriptionsCanceledInRange: 0,
    subscriptionsStartedInRange: 0,
    totalPaymentSatsInRange: 0,
  };
}

function quietSigner(attempts = 0, failures = 0) {
  return {
    distinctUsersWithFailureInRange: 0,
    enabledUsers: 0,
    failuresByBucket: [],
    reconnectAttemptsInRange: attempts,
    reconnectConfidence: {
      confidence: attempts >= 20 ? "confident" : "directional",
    },
    reconnectFailureRatePct: null,
    reconnectFailuresInRange: failures,
    usersExtensionOrUnset: 0,
    usersWithNip46Profile: 0,
  };
}

function quietUsage(active = 0) {
  return {
    activeSessionUsersInRange: active,
    activeUsersConfidence: "insufficient_sample",
    dauRolling: 1,
    mauRolling: 3,
    wauRolling: 2,
  };
}

function sameWindow(
  window: DateWindow | undefined,
  bounds: { from: Date; to: Date } | null
): boolean {
  if (!window || !bounds) return false;
  return (
    window.gte.getTime() === bounds.from.getTime() &&
    window.lt.getTime() === bounds.to.getTime()
  );
}

function isRolling30(window: DateWindow | undefined): boolean {
  if (!window) return false;
  return (
    window.gte.getTime() === NOW.getTime() - 30 * 86_400_000 &&
    window.lt.getTime() === NOW.getTime()
  );
}

function installZeros(): void {
  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.giveaway.count.mockResolvedValue(0);
  prismaMock.longFormPost.count.mockResolvedValue(0);
  prismaMock.post.count.mockResolvedValue(0);
  prismaMock.post.findMany.mockResolvedValue([]);
  prismaMock.referral.count.mockResolvedValue(0);
  prismaMock.referralEarning.aggregate.mockResolvedValue({
    _sum: { commissionSats: null },
  });
  prismaMock.referralEarning.count.mockResolvedValue(0);
  prismaMock.subscription.count.mockResolvedValue(0);
  prismaMock.user.count.mockResolvedValue(0);
  bundles.getMonetizationBundle.mockResolvedValue(quietMoney());
  bundles.getProductUsageBundle.mockResolvedValue(quietUsage());
  bundles.getSignerConnectHealthBundle.mockResolvedValue(quietSigner());
}

function installScenario(scenario: AnalyticsScenario): void {
  const bounds = getBoundsForPreset("7d", NOW);
  const previous = getPreviousPeriodBounds(bounds, NOW);

  prismaMock.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const sql = Array.isArray(strings) ? strings.join(" ") : "";
    if (sql.includes('COUNT(DISTINCT ("publishedAt"::date))')) {
      return Promise.resolve([{ c: scenario.multiDay }]);
    }
    if (sql.includes("HAVING COUNT(*) >= 2")) {
      return Promise.resolve([{ c: scenario.secondPublish }]);
    }
    if (sql.includes("UNION")) {
      return Promise.resolve([{ c: scenario.publishersInRange }]);
    }
    if (sql.includes('FROM "User"')) return Promise.resolve(scenario.userDays);
    if (sql.includes('FROM "Post"')) return Promise.resolve(scenario.postDays);
    if (sql.includes('FROM "Subscription"')) {
      return Promise.resolve(scenario.subDays);
    }
    if (sql.includes('FROM "Referral"'))
      return Promise.resolve(scenario.refDays);
    return Promise.resolve([]);
  });
  prismaMock.user.count.mockImplementation(
    (args?: { where?: { createdAt?: DateWindow } }) =>
      Promise.resolve(
        sameWindow(args?.where?.createdAt, previous)
          ? scenario.prevNewUsers
          : scenario.newUsers
      )
  );
  prismaMock.post.count.mockImplementation(
    (args?: {
      where?: {
        currentState?: string;
        fileUrl?: unknown;
        isQuotedPost?: boolean;
        NOT?: { threadGroupId?: null };
        publishedAt?: DateWindow;
        repost?: boolean;
        updatedAt?: DateWindow;
      };
    }) => {
      const where = args?.where ?? {};
      if (where.repost === true) return Promise.resolve(scenario.reposts);
      if (where.isQuotedPost === true) return Promise.resolve(scenario.quotes);
      if (where.NOT && "threadGroupId" in where.NOT) {
        return Promise.resolve(scenario.threads);
      }
      if (where.fileUrl) return Promise.resolve(scenario.media);
      if (where.currentState === "SCHEDULED") {
        return Promise.resolve(scenario.totalScheduled);
      }
      if (where.currentState === "PUBLISHED") {
        if (!where.publishedAt) {
          return Promise.resolve(scenario.totalPublished);
        }
        if (isRolling30(where.publishedAt))
          return Promise.resolve(scenario.pub30);
        if (sameWindow(where.publishedAt, previous)) {
          return Promise.resolve(scenario.prevPosts);
        }
        return Promise.resolve(scenario.postsPublished);
      }
      if (where.currentState === "FAILED") {
        if (isRolling30(where.updatedAt))
          return Promise.resolve(scenario.fail30);
        return Promise.resolve(scenario.failShort);
      }
      return Promise.resolve(0);
    }
  );
  prismaMock.longFormPost.count.mockImplementation(
    (args?: {
      where?: {
        currentState?: string;
        publishedAt?: DateWindow;
      };
    }) => {
      const where = args?.where;
      if (where?.currentState === "FAILED") {
        return Promise.resolve(scenario.failLong);
      }
      if (where?.currentState === "PUBLISHED") {
        if (!where.publishedAt) return Promise.resolve(scenario.totalLong);
        if (sameWindow(where.publishedAt, previous)) {
          return Promise.resolve(scenario.prevLong);
        }
        return Promise.resolve(scenario.longForm);
      }
      return Promise.resolve(0);
    }
  );
  prismaMock.subscription.count.mockImplementation(
    (args?: { where?: { createdAt?: DateWindow; status?: string } }) => {
      if (args?.where?.createdAt) {
        return Promise.resolve(
          sameWindow(args.where.createdAt, previous) ? scenario.prevSubs : 0
        );
      }
      return Promise.resolve(scenario.activeSubs);
    }
  );
  prismaMock.referral.count.mockImplementation(
    (args?: { where?: { createdAt?: DateWindow } }) =>
      Promise.resolve(
        sameWindow(args?.where?.createdAt, previous)
          ? scenario.prevReferred
          : scenario.referred
      )
  );
  prismaMock.giveaway.count.mockResolvedValue(scenario.giveaways);
  prismaMock.post.findMany.mockResolvedValue(
    Array.from({ length: scenario.publisherRows }, (_, index) => ({
      userId: `publisher-${index}`,
    }))
  );
  prismaMock.referralEarning.aggregate.mockResolvedValue({
    _sum: { commissionSats: scenario.referralSats },
  });
  prismaMock.referralEarning.count.mockResolvedValue(scenario.failedPayouts30d);
}

const RICH: AnalyticsScenario = {
  activeSubs: 6,
  fail30: 1,
  failLong: 3,
  failShort: 2,
  failedPayouts30d: 2,
  giveaways: 3,
  longForm: 2,
  media: 5,
  multiDay: 3n,
  newUsers: 10,
  postDays: [
    { d: new Date("2026-06-01T00:00:00.000Z"), c: 1n },
    { d: new Date("2026-06-02T00:00:00.000Z"), c: 2n },
    { d: new Date("2026-06-03T00:00:00.000Z"), c: 20n },
  ],
  postsPublished: 8,
  prevLong: 0,
  prevNewUsers: 5,
  prevPosts: 4,
  prevReferred: 0,
  prevSubs: 3,
  pub30: 9,
  publisherRows: 4,
  publishersInRange: 5n,
  quotes: 1,
  refDays: [{ d: new Date("2026-06-11T00:00:00.000Z"), c: 3n }],
  referralSats: 1234,
  referred: 3,
  reposts: 2,
  secondPublish: 4n,
  subDays: [
    { d: new Date("2026-06-01T00:00:00.000Z"), c: 1n },
    { d: new Date("2026-06-02T00:00:00.000Z"), c: 2n },
    { d: new Date("2026-06-03T00:00:00.000Z"), c: 3n },
  ],
  threads: 11,
  totalLong: 9,
  totalPublished: 100,
  totalScheduled: 7,
  userDays: [{ d: new Date("2026-06-10T00:00:00.000Z"), c: 10n }],
};

describe("getAdminAnalyticsPageData", () => {
  beforeEach(() => {
    resetTree(prismaMock);
    resetTree(bundles);
    installZeros();
  });

  it("returns empty series for every preset, including an unknown label", async () => {
    const cases = [
      ["24h", "Last 24 hours", false],
      ["7d", "Last 7 days", false],
      ["30d", "Last 30 days", false],
      ["90d", "Last 90 days", false],
      ["all", "All time", true],
      ["custom" as "24h", "custom", true],
    ] as const;

    for (const [preset, label, noDelta] of cases) {
      const data = await getAdminAnalyticsPageData(preset, NOW);
      expect(data.proofCard.rangeLabel).toBe(label);
      expect(data.totals).toEqual({
        newUsers: 0,
        postsPublished: 0,
        longFormPublished: 0,
        activeSubscriptions: 0,
        referredSignups: 0,
      });
      expect(data.series.newUsersPerDay).toEqual([]);
      expect(data.proofOfWork.publishSuccessRate30d).toBe(100);
      expect(data.publishingReliability.publishSuccessRateInRange).toBe(100);
      if (noDelta) {
        expect(data.deltas).toBeNull();
        expect(data.totalsPrevious).toBeNull();
        expect(data.takeaways).toEqual([
          "Collect more activity to unlock richer insights; ranges with low volume stay intentionally conservative.",
        ]);
      } else {
        expect(data.deltas?.newUsersPct).toBe(0);
        expect(data.takeaways[0]).toContain("Low signup volume");
      }
    }
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
    expect(prismaMock.user.count).toHaveBeenCalled();
    expect(bundles.getMonetizationBundle).toHaveBeenCalled();
  });

  it("keeps other takeaways when MRR cannot be parsed", async () => {
    prismaMock.user.count.mockResolvedValue(4);
    prismaMock.post.count.mockResolvedValue(4);
    bundles.getMonetizationBundle.mockResolvedValue(quietMoney("nope"));

    const data = await getAdminAnalyticsPageData("7d", NOW);

    expect(data.publishingReliability.publishSuccessRateInRange).toBe(50);
    expect(data.proofOfWork.publishSuccessRate30d).toBe(50);
    expect(data.takeaways).toEqual([
      "Publishing: 4 short posts in window vs 4 new accounts.",
      "Media usage represents a solid share of posts in range.",
    ]);
    expect(data.takeaways.join(" ")).not.toContain("MRR");
    expect(prismaMock.post.count).toHaveBeenCalled();
  });

  it("builds series, deltas, proof data, and activity takeaways", async () => {
    installScenario(RICH);
    bundles.getMonetizationBundle.mockResolvedValue({
      ...quietMoney("4200"),
      activePaidSubscribers: 3,
    });
    bundles.getSignerConnectHealthBundle.mockResolvedValue(quietSigner(5, 2));
    bundles.getProductUsageBundle.mockResolvedValue(quietUsage(8));

    const data = await getAdminAnalyticsPageData("7d", NOW);

    expect(data.series.postsPublishedPerDay).toEqual([
      { day: "2026-06-01", count: 1 },
      { day: "2026-06-02", count: 2 },
      { day: "2026-06-03", count: 20 },
    ]);
    expect(data.series.newUsersPerDay).toEqual([
      { day: "2026-06-10", count: 10 },
    ]);
    expect(data.series.subscriptionsStartedPerDay).toHaveLength(3);
    expect(data.series.referredSignupsPerDay).toEqual([
      { day: "2026-06-11", count: 3 },
    ]);
    expect(data.totals).toEqual({
      newUsers: 10,
      postsPublished: 8,
      longFormPublished: 2,
      activeSubscriptions: 6,
      referredSignups: 3,
    });
    expect(data.featureAdoption).toEqual({
      scheduledReposts: 2,
      scheduledQuotes: 1,
      threadSegments: 11,
      postsWithMedia: 5,
      giveawaysLockedOrPaid: 3,
    });
    expect(data.retention).toEqual({
      publishersMultiDay: 3,
      secondPublishUsers: 4,
    });
    expect(data.proofOfWork).toEqual({
      totalPostsPublished: 100,
      totalPostsScheduled: 7,
      totalLongFormPublished: 9,
      totalPublishers: 4,
      totalReferralSatsPaid: 1234,
      publishSuccessRate30d: 90,
    });
    expect(data.totalsPrevious).toEqual({
      newUsers: 5,
      postsPublished: 4,
      longFormPublished: 0,
      referredSignups: 0,
      subscriptionsStarted: 3,
    });
    expect(data.deltas).toEqual({
      newUsersPct: 100,
      postsPublishedPct: 100,
      longFormPublishedPct: null,
      referredSignupsPct: null,
      subscriptionsStartedPct: 100,
    });
    expect(data.publishingReliability).toEqual({
      publishSuccessRateInRange: 66.7,
      failedShortInRange: 2,
      failedLongInRange: 3,
    });
    expect(data.proofCard.allTime.referralSatsPaid).toBe(1234);
    expect(data.proofCard.inRange.publishersInRange).toBe(5);
    expect(data.proofCard.last30d).toEqual({
      publishSuccessRate: 90,
      successfulShortPublishes: 9,
      failedShortPublishes: 1,
    });
    expect(data.proofCard.reliability30d.failedReferralPayouts).toBe(2);
    expect(data.takeaways).toHaveLength(7);
    expect(data.takeaways.join("\n")).toContain("max 20 vs median 2");
    expect(data.takeaways.join("\n")).toContain("MRR (sats) is 4200");
    expect(data.takeaways.join("\n")).toContain("2 failures of 5 attempts");
    expect(data.takeaways.join("\n")).toContain("Session-active users");
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(7);
    expect(prismaMock.giveaway.count).toHaveBeenCalled();
    expect(prismaMock.referralEarning.aggregate).toHaveBeenCalled();

    const allTime = await getAdminAnalyticsPageData("all", NOW);
    expect(allTime.deltas).toBeNull();
    expect(allTime.totalsPrevious).toBeNull();
    expect(allTime.totals.postsPublished).toBe(8);
    expect(allTime.proofCard.rangeLabel).toBe("All time");
    expect(allTime.proofOfWork.totalPostsPublished).toBe(100);
  });
});
