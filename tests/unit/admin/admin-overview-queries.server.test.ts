import {
  PublishRelayAckStatus,
  ReferralEarningStatus,
  SubscriptionStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  deadLetterJob: { count: vi.fn() },
  longFormPost: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
  post: {
    count: vi.fn(async (_args?: { where?: { currentState?: string } }) => 0),
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  publishRelayAck: { groupBy: vi.fn() },
  referral: { count: vi.fn() },
  referralEarning: { aggregate: vi.fn() },
  subscription: { count: vi.fn() },
  user: { count: vi.fn() },
}));

const bundles = vi.hoisted(() => ({
  getAdminQueueHealthSnapshot: vi.fn(),
  getMonetizationBundle: vi.fn(),
  getProductUsageBundle: vi.fn(),
  getReferrersEligibleForPayout: vi.fn(),
  getSignerConnectHealthBundle: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: prismaMock,
}));
vi.mock("~/features/referral/referral-payout.server", () => ({
  getReferrersEligibleForPayout: bundles.getReferrersEligibleForPayout,
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
vi.mock("~/features/admin/repositories/admin-system-health.server", () => ({
  getAdminQueueHealthSnapshot: bundles.getAdminQueueHealthSnapshot,
}));

import { getBoundsForPreset } from "~/features/admin/metrics/date-range";
import type { RangePreset } from "~/features/admin/metrics/date-range";
import { PUBLISHING_STUCK_MINUTES } from "~/features/admin/metrics/definitions";
import { getAdminOverviewPageData } from "~/features/admin/repositories/admin-overview-queries.server";
import { FREE_PLAN_ID } from "~/features/payments/plan-ids";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const HEALTH = [
  {
    id: "db",
    label: "Database",
    status: "healthy" as const,
    detail: "Connected",
  },
];

interface DateWindow {
  gte: Date;
  lt: Date;
}

interface StateRow {
  currentState: string;
  _count: { _all: number };
}

interface RelayRow {
  status: PublishRelayAckStatus;
  _count: { _all: number };
}

interface OverviewScenario {
  activeAll: number;
  activePaid: number;
  dailyShort: number;
  deadLetter24h: number;
  eligible: Array<{ referrerNpub: string; pendingSats: number }>;
  failLong: number;
  failShort: number;
  failed24hLong: number;
  failed24hShort: number;
  latencyRows: Array<{
    publishedAt: Date | null;
    publishingStartedAt: Date | null;
  }>;
  longStates: StateRow[];
  newUsers: number;
  paidSats: number | null;
  pendingSats: number | null;
  postStates: StateRow[];
  prevFailLong: number;
  prevFailShort: number;
  prevNewUsers: number;
  prevPubLong: number;
  prevPubShort: number;
  pubLong: number;
  pubShort: number;
  publishersLong: Array<{ userId: string }>;
  publishersShort: Array<{ userId: string }>;
  referralLinks: number;
  relay: RelayRow[];
  stuck: number;
}

function zeroScenario(): OverviewScenario {
  return {
    activeAll: 0,
    activePaid: 0,
    dailyShort: 0,
    deadLetter24h: 0,
    eligible: [],
    failLong: 0,
    failShort: 0,
    failed24hLong: 0,
    failed24hShort: 0,
    latencyRows: [],
    longStates: [],
    newUsers: 0,
    paidSats: null,
    pendingSats: null,
    postStates: [],
    prevFailLong: 0,
    prevFailShort: 0,
    prevNewUsers: 0,
    prevPubLong: 0,
    prevPubShort: 0,
    pubLong: 0,
    pubShort: 0,
    publishersLong: [],
    publishersShort: [],
    referralLinks: 0,
    relay: [],
    stuck: 0,
  };
}

function quietMoney() {
  return {
    activePaidSubscribers: 0,
    arppuSatsInRange: null,
    arrRunRateSats: "0",
    mrrSats: "0",
    netSubscriptionFlowInRange: 0,
    planMix: [],
    referredRevenueSatsInRange: 0,
    revenueConfidence: "insufficient_sample",
    subscriptionsCanceledInRange: 0,
    subscriptionsStartedInRange: 0,
    totalPaymentSatsInRange: 0,
  };
}

function quietSigner() {
  return {
    distinctUsersWithFailureInRange: 0,
    enabledUsers: 0,
    failuresByBucket: [],
    reconnectAttemptsInRange: 0,
    reconnectConfidence: { confidence: "insufficient_sample" },
    reconnectFailureRatePct: null,
    reconnectFailuresInRange: 0,
    usersExtensionOrUnset: 0,
    usersWithNip46Profile: 0,
  };
}

function quietUsage() {
  return {
    activeSessionUsersInRange: 0,
    activeUsersConfidence: "insufficient_sample",
    dauRolling: 0,
    mauRolling: 0,
    wauRolling: 0,
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

function spanDays(window: DateWindow | undefined): number | null {
  if (!window) return null;
  return (window.lt.getTime() - window.gte.getTime()) / 86_400_000;
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

function installZeros(): void {
  prismaMock.deadLetterJob.count.mockResolvedValue(0);
  prismaMock.longFormPost.count.mockResolvedValue(0);
  prismaMock.longFormPost.findMany.mockResolvedValue([]);
  prismaMock.longFormPost.groupBy.mockResolvedValue([]);
  prismaMock.post.count.mockResolvedValue(0);
  prismaMock.post.findMany.mockResolvedValue([]);
  prismaMock.post.groupBy.mockResolvedValue([]);
  prismaMock.publishRelayAck.groupBy.mockResolvedValue([]);
  prismaMock.referral.count.mockResolvedValue(0);
  prismaMock.referralEarning.aggregate.mockResolvedValue({
    _sum: { commissionSats: null },
  });
  prismaMock.subscription.count.mockResolvedValue(0);
  prismaMock.user.count.mockResolvedValue(0);
  bundles.getAdminQueueHealthSnapshot.mockResolvedValue(HEALTH);
  bundles.getMonetizationBundle.mockResolvedValue(quietMoney());
  bundles.getProductUsageBundle.mockResolvedValue(quietUsage());
  bundles.getReferrersEligibleForPayout.mockResolvedValue([]);
  bundles.getSignerConnectHealthBundle.mockResolvedValue(quietSigner());
}

function installScenario(
  preset: RangePreset,
  scenario: OverviewScenario
): void {
  const prevBounds = getBoundsForPreset(preset, NOW);
  const previous =
    prevBounds.from.getTime() === 0
      ? null
      : {
          from: new Date(
            prevBounds.from.getTime() -
              (prevBounds.to.getTime() - prevBounds.from.getTime())
          ),
          to: prevBounds.from,
        };

  prismaMock.user.count.mockImplementation(
    (args?: { where?: { createdAt?: DateWindow } }) => {
      if (sameWindow(args?.where?.createdAt, previous)) {
        return Promise.resolve(scenario.prevNewUsers);
      }
      return Promise.resolve(scenario.newUsers);
    }
  );
  prismaMock.subscription.count.mockImplementation(
    (args?: { where?: { NOT?: { planId?: string } } }) =>
      Promise.resolve(
        args?.where?.NOT?.planId === FREE_PLAN_ID
          ? scenario.activePaid
          : scenario.activeAll
      )
  );
  prismaMock.post.count.mockImplementation(
    (args?: {
      where?: {
        currentState?: string;
        publishedAt?: DateWindow;
        updatedAt?: DateWindow;
      };
    }) => {
      const where = args?.where;
      if (where?.currentState === "PUBLISHING") {
        return Promise.resolve(scenario.stuck);
      }
      if (where?.currentState === "PUBLISHED") {
        const span = spanDays(where.publishedAt);
        if (span !== null && span < 1.5) {
          return Promise.resolve(scenario.dailyShort);
        }
        if (sameWindow(where.publishedAt, previous)) {
          return Promise.resolve(scenario.prevPubShort);
        }
        return Promise.resolve(scenario.pubShort);
      }
      if (where?.currentState === "FAILED") {
        const span = spanDays(where.updatedAt);
        if (span !== null && span < 1.5) {
          return Promise.resolve(scenario.failed24hShort);
        }
        if (sameWindow(where.updatedAt, previous)) {
          return Promise.resolve(scenario.prevFailShort);
        }
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
        updatedAt?: DateWindow;
      };
    }) => {
      const where = args?.where;
      if (where?.currentState === "PUBLISHED") {
        if (sameWindow(where.publishedAt, previous)) {
          return Promise.resolve(scenario.prevPubLong);
        }
        return Promise.resolve(scenario.pubLong);
      }
      if (where?.currentState === "FAILED") {
        const span = spanDays(where.updatedAt);
        if (span !== null && span < 1.5) {
          return Promise.resolve(scenario.failed24hLong);
        }
        if (sameWindow(where.updatedAt, previous)) {
          return Promise.resolve(scenario.prevFailLong);
        }
        return Promise.resolve(scenario.failLong);
      }
      return Promise.resolve(0);
    }
  );
  prismaMock.post.findMany.mockImplementation(
    (args?: { distinct?: string[] }) =>
      Promise.resolve(
        args?.distinct ? scenario.publishersShort : scenario.latencyRows
      )
  );
  prismaMock.longFormPost.findMany.mockResolvedValue(scenario.publishersLong);
  prismaMock.post.groupBy.mockResolvedValue(scenario.postStates);
  prismaMock.longFormPost.groupBy.mockResolvedValue(scenario.longStates);
  prismaMock.publishRelayAck.groupBy.mockResolvedValue(scenario.relay);
  prismaMock.deadLetterJob.count.mockResolvedValue(scenario.deadLetter24h);
  prismaMock.referral.count.mockResolvedValue(scenario.referralLinks);
  prismaMock.referralEarning.aggregate.mockImplementation(
    (args?: { where?: { status?: ReferralEarningStatus } }) =>
      Promise.resolve({
        _sum: {
          commissionSats:
            args?.where?.status === ReferralEarningStatus.PENDING
              ? scenario.pendingSats
              : scenario.paidSats,
        },
      })
  );
  bundles.getReferrersEligibleForPayout.mockResolvedValue(scenario.eligible);
}

describe("getAdminOverviewPageData", () => {
  beforeEach(() => {
    resetTree(prismaMock);
    resetTree(bundles);
    installZeros();
  });

  it("returns an empty all-time overview with no prior period", async () => {
    const data = await getAdminOverviewPageData("all", NOW);

    expect(data.rangePreset).toBe("all");
    expect(data.generatedAt).toBe(NOW.toISOString());
    expect(data.alerts).toEqual([]);
    expect(data.kpis.actionRequiredCount).toBe(0);
    expect(data.kpis.newUsers).toEqual({
      current: 0,
      previous: null,
      deltaPct: null,
    });
    expect(data.kpis.postsPublished).toMatchObject({
      current: 0,
      short: 0,
      long: 0,
      previous: null,
      deltaPct: null,
    });
    expect(data.kpis.publishSuccessRate).toBe(100);
    expect(data.kpis.publishSuccessPrev).toBeNull();
    expect(data.kpis.pendingPayoutSats).toBe(0);
    expect(data.publishing.avgPublishLatencyMs).toBeNull();
    expect(data.publishing.scheduledQueueDepth).toBe(0);
    expect(data.publishing.dailyPublishesShort).toHaveLength(7);
    expect(data.publishing.dailyPublishesShort[0]).toEqual({
      day: "2026-06-09",
      count: 0,
    });
    expect(data.publishing.dailyPublishesShort[6]).toEqual({
      day: "2026-06-15",
      count: 0,
    });
    expect(data.users.avgPostsPerActiveUser).toBeNull();
    expect(data.referrals.batchReadyCount).toBe(0);
    expect(data.insights.relay.ratePct).toBeNull();
    expect(data.insights.kpi.newUsers).toContain("No prior period");
    expect(data.insights.kpi.postsPublished).toContain("No prior period");
    expect(data.insights.kpi.pendingPayout).toContain("Nothing queued");
    expect(data.insights.kpi.actionRequired).toContain("No open alerts");
    expect(data.insights.publishingNarrative).toContain("Nothing waiting");
    expect(data.systemHealth).toEqual(HEALTH);
    expect(prismaMock.user.count).toHaveBeenCalledWith({
      where: { createdAt: { gte: new Date(0), lt: NOW } },
    });
    expect(prismaMock.subscription.count).toHaveBeenCalledWith({
      where: {
        status: SubscriptionStatus.ACTIVE,
        NOT: { planId: FREE_PLAN_ID },
      },
    });
    expect(prismaMock.post.groupBy).toHaveBeenCalled();
    expect(bundles.getReferrersEligibleForPayout).toHaveBeenCalledTimes(1);
    expect(bundles.getMonetizationBundle).toHaveBeenCalledWith("all", NOW);
    expect(bundles.getAdminQueueHealthSnapshot).toHaveBeenCalledTimes(1);
  });

  it("describes a low-volume 24h range against the previous window", async () => {
    const data = await getAdminOverviewPageData("24h", NOW);

    expect(data.kpis.newUsers).toEqual({
      current: 0,
      previous: 0,
      deltaPct: 0,
    });
    expect(data.kpis.publishSuccessPrev).toBe(100);
    expect(data.alerts).toEqual([]);
    expect(data.insights.kpi.newUsers).toContain("Low signup volume");
    expect(data.insights.kpi.postsPublished).toContain("Low publish volume");
    expect(data.insights.kpi.publishSuccess).toContain("improved or held");
    expect(data.insights.relay.note).toContain("not meaningful");
    expect(data.insights.kpi.postsPublished).toContain("0 short · 0 long");
    expect(prismaMock.post.count).toHaveBeenCalled();
    expect(prismaMock.longFormPost.count).toHaveBeenCalled();
  });

  it("raises publishing, signer, and monetization alerts for a busy range", async () => {
    installScenario("7d", {
      ...zeroScenario(),
      activeAll: 14,
      activePaid: 9,
      dailyShort: 3,
      deadLetter24h: 2,
      eligible: [
        { referrerNpub: "npub-a", pendingSats: 2000 },
        { referrerNpub: "npub-b", pendingSats: 3000 },
      ],
      failLong: 8,
      failShort: 8,
      failed24hLong: 1,
      failed24hShort: 4,
      latencyRows: [
        {
          publishedAt: new Date("2026-06-15T00:00:10.000Z"),
          publishingStartedAt: new Date("2026-06-15T00:00:00.000Z"),
        },
        {
          publishedAt: null,
          publishingStartedAt: new Date("2026-06-15T00:00:00.000Z"),
        },
      ],
      longStates: [
        { currentState: "DRAFT", _count: { _all: 1 } },
        { currentState: "SCHEDULED", _count: { _all: 15 } },
      ],
      newUsers: 12,
      paidSats: 250,
      pendingSats: 5000,
      postStates: [
        { currentState: "PUBLISHED", _count: { _all: 11 } },
        { currentState: "CANCELLED", _count: { _all: 2 } },
        { currentState: "SCHEDULED", _count: { _all: 40 } },
        { currentState: "FAILED", _count: { _all: 5 } },
      ],
      prevFailLong: 0,
      prevFailShort: 1,
      prevNewUsers: 0,
      prevPubLong: 7,
      prevPubShort: 9,
      pubLong: 6,
      pubShort: 2,
      publishersLong: [{ userId: "u2" }, { userId: "u3" }],
      publishersShort: [{ userId: "u1" }, { userId: "u2" }],
      referralLinks: 6,
      relay: [
        { status: PublishRelayAckStatus.ACCEPTED, _count: { _all: 2 } },
        { status: PublishRelayAckStatus.FAILED, _count: { _all: 30 } },
        { status: PublishRelayAckStatus.TIMEOUT, _count: { _all: 8 } },
      ],
      stuck: 4,
    });
    bundles.getMonetizationBundle.mockResolvedValue({
      ...quietMoney(),
      netSubscriptionFlowInRange: -3,
      subscriptionsCanceledInRange: 4,
      subscriptionsStartedInRange: 1,
    });
    bundles.getSignerConnectHealthBundle.mockResolvedValue({
      ...quietSigner(),
      distinctUsersWithFailureInRange: 2,
      reconnectAttemptsInRange: 5,
      reconnectFailuresInRange: 3,
    });

    const data = await getAdminOverviewPageData("7d", NOW);

    expect(data.alerts.map((alert) => alert.id)).toEqual([
      "failed-publish-24h",
      "dead-letter",
      "stuck-publishing",
      "relay-severe",
      "signer-reconnect-failures",
      "net-subs-down",
    ]);
    expect(data.alerts[0]).toMatchObject({
      severity: "danger",
      category: "publishing",
    });
    expect(data.alerts[0]?.message).toContain("5 failed publish");
    expect(data.alerts[1]?.message).toContain("queue entries");
    expect(data.alerts[2]?.message).toContain(
      `${PUBLISHING_STUCK_MINUTES}+ min`
    );
    expect(data.alerts[3]?.message).toContain("5%");
    expect(data.kpis.actionRequiredCount).toBe(6);
    expect(data.kpis.activePaidUsers.current).toBe(9);
    expect(data.kpis.newUsers).toEqual({
      current: 12,
      previous: 0,
      deltaPct: null,
    });
    expect(data.kpis.postsPublished).toMatchObject({
      current: 8,
      short: 2,
      long: 6,
      previous: 16,
      deltaPct: -50,
    });
    expect(data.kpis.publishSuccessRate).toBe(33.3);
    expect(data.kpis.publishSuccessPrev).toBe(94.1);
    expect(data.kpis.pendingPayoutSats).toBe(5000);
    expect(data.publishing.stateMixShort).toEqual([
      { state: "SCHEDULED", count: 40 },
      { state: "PUBLISHED", count: 11 },
      { state: "FAILED", count: 5 },
      { state: "CANCELLED", count: 2 },
    ]);
    expect(data.publishing.stateMixLong[0]).toEqual({
      state: "SCHEDULED",
      count: 15,
    });
    expect(data.publishing.scheduledQueueDepth).toBe(55);
    expect(data.publishing.failedShort).toBe(5);
    expect(data.publishing.cancelledShort).toBe(2);
    expect(data.publishing.avgPublishLatencyMs).toBe(10_000);
    expect(data.publishing.dailyPublishesShort[0]?.count).toBe(3);
    expect(data.users).toEqual({
      activeUsersProxy: 3,
      signupsInRange: 12,
      avgPostsPerActiveUser: 8 / 3,
    });
    expect(data.referrals).toEqual({
      activeSubscriptions: 14,
      referralLinks: 6,
      pendingSats: 5000,
      paidInRangeSats: 250,
      batchReadyCount: 2,
    });
    expect(data.insights.relay).toMatchObject({
      accepted: 2,
      failed: 38,
      ratePct: 5,
    });
    expect(data.insights.kpi.newUsers).toContain("accelerated");
    expect(data.insights.kpi.postsPublished).toContain("down");
    expect(data.insights.kpi.postsPublished).toContain("2 short · 6 long");
    expect(data.insights.kpi.publishSuccess).toContain("slipped");
    expect(data.insights.kpi.pendingPayout).toContain("waiting");
    expect(data.insights.publishingNarrative).toContain("elevated (55");
    expect(data.insights.publishingNarrative).toContain(
      "Long-form is carrying"
    );
    expect(prismaMock.deadLetterJob.count).toHaveBeenCalled();
    expect(prismaMock.publishRelayAck.groupBy).toHaveBeenCalled();
    const states = prismaMock.post.count.mock.calls.map(
      (call) => call[0]?.where?.currentState
    );
    expect(states).toContain("PUBLISHING");
  });

  it("describes a calm range with short-form output and a normal queue", async () => {
    installScenario("7d", {
      ...zeroScenario(),
      dailyShort: 1,
      latencyRows: [{ publishedAt: null, publishingStartedAt: null }],
      longStates: [{ currentState: "SCHEDULED", _count: { _all: 4 } }],
      newUsers: 4,
      postStates: [
        { currentState: "SCHEDULED", _count: { _all: 6 } },
        { currentState: "PUBLISHED", _count: { _all: 3 } },
      ],
      prevFailShort: 4,
      prevNewUsers: 10,
      prevPubShort: 4,
      pubShort: 10,
      publishersShort: [{ userId: "u1" }],
      referralLinks: 1,
      relay: [
        { status: PublishRelayAckStatus.ACCEPTED, _count: { _all: 18 } },
        { status: PublishRelayAckStatus.FAILED, _count: { _all: 1 } },
        { status: PublishRelayAckStatus.TIMEOUT, _count: { _all: 1 } },
      ],
    });
    bundles.getMonetizationBundle.mockResolvedValue({
      ...quietMoney(),
      netSubscriptionFlowInRange: -1,
      subscriptionsCanceledInRange: 1,
      subscriptionsStartedInRange: 0,
    });
    bundles.getSignerConnectHealthBundle.mockResolvedValue({
      ...quietSigner(),
      reconnectAttemptsInRange: 2,
      reconnectFailuresInRange: 1,
    });

    const data = await getAdminOverviewPageData("7d", NOW);

    expect(data.alerts).toEqual([]);
    expect(data.kpis.newUsers.deltaPct).toBe(-60);
    expect(data.kpis.postsPublished.deltaPct).toBe(150);
    expect(data.kpis.publishSuccessRate).toBe(100);
    expect(data.kpis.publishSuccessPrev).toBe(50);
    expect(data.publishing.avgPublishLatencyMs).toBeNull();
    expect(data.publishing.scheduledQueueDepth).toBe(10);
    expect(data.users.avgPostsPerActiveUser).toBe(10);
    expect(data.insights.relay.ratePct).toBe(90);
    expect(data.insights.kpi.newUsers).toContain("cooled");
    expect(data.insights.kpi.postsPublished).toContain("up");
    expect(data.insights.kpi.publishSuccess).toContain("improved or held");
    expect(data.insights.publishingNarrative).toContain("looks normal (10");
    expect(data.insights.publishingNarrative).toContain(
      "All published output is short-form"
    );
    expect(data.insights.kpi.pendingPayout).toContain("Nothing queued");
  });

  it("describes flat signups and a mixed short-form lead", async () => {
    installScenario("7d", {
      ...zeroScenario(),
      newUsers: 6,
      prevNewUsers: 6,
      pubShort: 4,
      pubLong: 2,
      prevPubShort: 4,
      prevPubLong: 2,
    });

    const data = await getAdminOverviewPageData("7d", NOW);

    expect(data.alerts).toEqual([]);
    expect(data.kpis.newUsers.deltaPct).toBe(0);
    expect(data.kpis.postsPublished.deltaPct).toBe(0);
    expect(data.insights.kpi.newUsers).toContain("flat");
    expect(data.insights.kpi.postsPublished).toContain("steady");
    expect(data.insights.publishingNarrative).toContain("long-form adds depth");
    expect(data.insights.publishingNarrative).toContain("Nothing waiting");
    expect(bundles.getProductUsageBundle).toHaveBeenCalledWith(
      getBoundsForPreset("7d", NOW),
      NOW
    );
    expect(bundles.getSignerConnectHealthBundle).toHaveBeenCalledWith(
      getBoundsForPreset("7d", NOW)
    );
  });

  it("uses the singular dead-letter alert when only one row exists", async () => {
    installScenario("7d", { ...zeroScenario(), deadLetter24h: 1 });

    const data = await getAdminOverviewPageData("7d", NOW);

    expect(data.alerts).toEqual([
      {
        id: "dead-letter",
        severity: "danger",
        message: "1 dead-letter queue entry in the last 24 hours",
        href: "/dashboard/admin/operations?focus=deadletter",
        category: "infra",
      },
    ]);
    expect(data.kpis.actionRequiredCount).toBe(1);
    expect(data.insights.kpi.actionRequired).toContain("1 alert");
    expect(prismaMock.deadLetterJob.count).toHaveBeenCalled();
  });
});
