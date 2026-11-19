import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  plan: { findMany: vi.fn() },
  planPrice: { findMany: vi.fn() },
  subscription: { count: vi.fn(), findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
}));

const paymentsData = vi.hoisted(() => ({
  PlanBillingModel: {
    free: "free",
    recurring: "recurring",
    lifetime: "lifetime",
    disabled: "disabled",
  },
  countActiveSubscriptionsForPlan: vi.fn(),
  getAllPlans: vi.fn(),
  getUserSubscription: vi.fn(),
  listActivePlanPricesForPlans: vi.fn(),
}));

const session = vi.hoisted(() => ({
  requireUser: vi.fn(),
}));

const userApi = vi.hoisted(() => ({
  getUserNWC: vi.fn(),
}));

const flags = vi.hoisted(() => ({
  featureFlags: {
    subscriptionCheckoutV2Enabled: true,
  },
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));
vi.mock("~/features/payments/data", () => paymentsData);
vi.mock("~/features/auth/session.server", () => session);
vi.mock("~/features/user", () => userApi);
vi.mock("~/lib/feature-flags.server", () => flags);

import { loadPlansData } from "~/features/payments/services/plans-loader.server";

const FREE_CALLOUTS = [
  "Full product access with strict hard caps",
  "Bulk scheduling, up to 10 scheduled items",
  "1 queue",
  "Browse broadcasts (no sending)",
  "Paid plans unlock full send volume",
];
const STARTER_CALLOUTS = [
  "1 serious account",
  "2 queues",
  "5 GB storage / 20 GB uploads",
  "50 MB max file size",
  "Up to 50 scheduled items",
];
const CREATOR_CALLOUTS = [
  "Up to 2 accounts",
  "More scheduling and queue headroom",
  "Broadcast sending included",
  "Hosted media included",
];
const PRO_CALLOUTS = [
  "Up to 5 accounts",
  "Highest workflow and queue capacity",
  "Largest hosted media allocation",
  "Blastr fanout distribution included",
];
const FOUNDER_BENEFITS = [
  "Permanent access to the top individual tier",
  "Hosted media and fanout access included",
  "Non-recurring, tied to one account owner",
  "Priority support",
  "Early access to major features",
  "Founder recognition in-product",
  "0% campaign commission",
];

const FLAG_DEFAULTS = {
  enableAdvancedAnalytics: false,
  enableBasicScheduling: false,
  enableBulkScheduling: false,
  enableCommissions: false,
  enableEngagementFeed: false,
  enableGiveaways: false,
  enableLeaderboards: false,
  enableLifetimeAccess: false,
  enableMultiAccountSwitching: false,
  enableMultipleQueues: false,
  enableNativeS3BlossomStorage: false,
  enableRelayBlast: false,
  enableRepostsAndQuotes: false,
  enableVisualPerks: false,
  enableWolfFilteringAndVortex: false,
};

interface PlanFixture {
  description: string | null;
  enableAdvancedAnalytics: boolean;
  enableBasicScheduling: boolean;
  enableBulkScheduling: boolean;
  enableCommissions: boolean;
  enableEngagementFeed: boolean;
  enableGiveaways: boolean;
  enableLeaderboards: boolean;
  enableLifetimeAccess: boolean;
  enableMultiAccountSwitching: boolean;
  enableMultipleQueues: boolean;
  enableNativeS3BlossomStorage: boolean;
  enableRelayBlast: boolean;
  enableRepostsAndQuotes: boolean;
  enableVisualPerks: boolean;
  enableWolfFilteringAndVortex: boolean;
  features: Record<string, boolean | string> | null;
  founderSeatCap: number | null;
  id: string;
  isComingSoon: boolean;
  isSpecialOffering: boolean;
  name: string;
  planBillingModel: string;
  price: number;
  purchasable: boolean;
  visibleOnPricingPage: boolean;
}

function makePlan(
  overrides: Partial<PlanFixture> & { id: string }
): PlanFixture {
  return {
    id: overrides.id,
    name: overrides.id,
    price: 0,
    description: null,
    features: null,
    visibleOnPricingPage: true,
    isSpecialOffering: false,
    planBillingModel: paymentsData.PlanBillingModel.recurring,
    purchasable: true,
    isComingSoon: false,
    founderSeatCap: null,
    ...FLAG_DEFAULTS,
    ...overrides,
  };
}

function priceRow(
  planId: string,
  billingCadence: "monthly" | "yearly",
  accessDurationMonths: number,
  paymentMethod: "nwc_auto_renew" | "lightning_one_time" | "btc_btcpay_onchain",
  priceUsd: number
) {
  return {
    planId,
    billingCadence,
    accessDurationMonths,
    paymentMethod,
    priceUsd,
  };
}

function plansRequest(): Request {
  return new Request("https://smartflow.social/plans");
}

function requirePlan<T extends { id: string }>(
  plans: readonly T[],
  id: string
): T {
  const plan = plans.find((item) => item.id === id);
  if (!plan) {
    throw new Error(`Missing plan ${id}`);
  }
  return plan;
}

function expectCallouts(callouts: string[], base: string[]): void {
  expect(callouts.slice(0, base.length)).toEqual(base);
  const commission = callouts[base.length];
  if (commission === undefined) {
    throw new Error("missing commission callout");
  }
  expect(commission).toMatch(
    /% (fee on Lightning campaign prize pools|campaign commission)$/
  );
  expect(callouts).toHaveLength(base.length + 1);
}

describe("loadPlansData", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    flags.featureFlags.subscriptionCheckoutV2Enabled = true;
    session.requireUser.mockRejectedValue(new Error("Unauthorized"));
    paymentsData.getAllPlans.mockResolvedValue([]);
    paymentsData.getUserSubscription.mockResolvedValue(null);
    paymentsData.listActivePlanPricesForPlans.mockResolvedValue([]);
    paymentsData.countActiveSubscriptionsForPlan.mockResolvedValue(0);
    userApi.getUserNWC.mockResolvedValue(null);
  });

  it("returns an empty public catalog when nobody is signed in", async () => {
    const request = plansRequest();
    const data = await loadPlansData(request);

    expect(data).toEqual({
      mainGridPlans: [],
      comparisonTablePlans: [],
      founderOffering: null,
      user: null,
      linkedChildAccount: false,
      nwc: null,
      subscriptionCheckoutV2Enabled: true,
      btcpayYearlyOnChainEnabled: true,
      billingCadences: ["monthly", "yearly"],
      manualDurationsByCadence: {
        monthly: [1, 3, 6],
        yearly: [12],
      },
      currentSubscription: null,
    });
    expect(session.requireUser).toHaveBeenCalledWith(request);
    expect(paymentsData.getUserSubscription).not.toHaveBeenCalled();
    expect(userApi.getUserNWC).not.toHaveBeenCalled();
    expect(paymentsData.listActivePlanPricesForPlans).toHaveBeenCalledWith([]);
    expect(paymentsData.countActiveSubscriptionsForPlan).not.toHaveBeenCalled();
  });

  it("maps free, starter, creator, and pro rows plus a founder offer", async () => {
    paymentsData.getAllPlans.mockResolvedValue([
      makePlan({
        id: "enterprise",
        name: "Enterprise",
        planBillingModel: paymentsData.PlanBillingModel.recurring,
      }),
      makePlan({
        id: "ghost",
        name: "Ghost",
        visibleOnPricingPage: false,
        planBillingModel: paymentsData.PlanBillingModel.free,
      }),
      makePlan({
        id: "pro",
        name: "Professional",
        description: "db pro",
        price: 40,
        planBillingModel: paymentsData.PlanBillingModel.recurring,
        isComingSoon: true,
        enableRelayBlast: true,
      }),
      makePlan({
        id: "free",
        name: "Community",
        description: "db free",
        price: 0,
        planBillingModel: paymentsData.PlanBillingModel.free,
        purchasable: false,
        enableBasicScheduling: true,
        enableGiveaways: true,
      }),
      makePlan({
        id: "teams",
        name: "Teams",
        price: 99,
        isComingSoon: true,
        planBillingModel: paymentsData.PlanBillingModel.recurring,
      }),
      makePlan({
        id: "starter",
        name: "Starter Plus",
        description: "db starter",
        price: 9,
        planBillingModel: paymentsData.PlanBillingModel.recurring,
        enableMultipleQueues: true,
      }),
      makePlan({
        id: "creator",
        name: "Creator Plus",
        description: "db creator",
        price: 15,
        planBillingModel: paymentsData.PlanBillingModel.recurring,
        enableBasicScheduling: true,
        enableCommissions: true,
        enableLifetimeAccess: true,
        enableMultipleQueues: true,
        features: {
          basicScheduling: false,
          commissions: "Custom",
          lifetimeAccess: false,
          relayBlast: true,
        },
      }),
      makePlan({
        id: "founder",
        name: "Founder",
        description: null,
        price: 499,
        planBillingModel: paymentsData.PlanBillingModel.lifetime,
        isSpecialOffering: true,
        founderSeatCap: 10,
        enableLifetimeAccess: true,
      }),
      makePlan({
        id: "Founder",
        name: "Alpha Founder",
        description: "Custom founder note",
        price: 1,
        planBillingModel: paymentsData.PlanBillingModel.disabled,
      }),
      makePlan({
        id: "Teams",
        name: "Zulu Teams",
        description: "Teams note",
        price: 2,
        planBillingModel: "mystery",
      }),
    ]);
    paymentsData.listActivePlanPricesForPlans.mockResolvedValue([
      priceRow("creator", "monthly", 1, "nwc_auto_renew", 20),
      priceRow("creator", "yearly", 12, "nwc_auto_renew", 160),
      priceRow("creator", "monthly", 1, "lightning_one_time", 18),
      priceRow("creator", "monthly", 3, "lightning_one_time", 54),
      priceRow("creator", "monthly", 6, "lightning_one_time", 100),
      priceRow("creator", "yearly", 12, "lightning_one_time", 150),
      priceRow("creator", "yearly", 12, "btc_btcpay_onchain", 140),
      priceRow("pro", "monthly", 1, "nwc_auto_renew", 30),
      priceRow("pro", "yearly", 12, "nwc_auto_renew", 360),
      priceRow("founder", "monthly", 1, "nwc_auto_renew", 49),
      priceRow("founder", "yearly", 12, "nwc_auto_renew", 399),
    ]);
    paymentsData.countActiveSubscriptionsForPlan.mockResolvedValue(4);

    const data = await loadPlansData(plansRequest());
    const free = requirePlan(data.mainGridPlans, "free");
    const starter = requirePlan(data.mainGridPlans, "starter");
    const creator = requirePlan(data.mainGridPlans, "creator");
    const pro = requirePlan(data.mainGridPlans, "pro");
    const alpha = requirePlan(data.mainGridPlans, "Founder");
    const teamsCard = requirePlan(data.mainGridPlans, "Teams");

    expect(data.mainGridPlans.map((plan) => plan.id)).toEqual([
      "free",
      "starter",
      "creator",
      "pro",
      "Founder",
      "Teams",
    ]);
    expect(data.comparisonTablePlans).toEqual(data.mainGridPlans);
    expect(data.user).toBeNull();
    expect(data.currentSubscription).toBeNull();
    expect(data.nwc).toBeNull();
    expect(data.linkedChildAccount).toBe(false);
    expect(paymentsData.listActivePlanPricesForPlans).toHaveBeenCalledWith([
      "pro",
      "teams",
      "starter",
      "creator",
      "founder",
    ]);
    expect(paymentsData.countActiveSubscriptionsForPlan).toHaveBeenCalledWith(
      "founder"
    );

    expect(free.name).toBe("Community");
    expect(free.description).toBe(
      "Try everything with strict limits before you pay"
    );
    expect(free.monthlyPriceUsd).toBe(0);
    expect(free.yearlyPriceUsd).toBe(0);
    expect(free.yearlySavingsNote).toBeNull();
    expect(free.planBillingModel).toBe("free");
    expect(free.purchasable).toBe(false);
    expect(free.isPopular).toBe(false);
    expect(free.isComingSoon).toBe(false);
    expect(free.isTeamsPlaceholder).toBe(false);
    expect(free.features["basicScheduling"]).toBe(true);
    expect(free.features["giveaways"]).toBe(true);
    expect(free.features["commissions"]).toBe("High");
    expect(free.checkoutPricing).toEqual({
      nwcAutoRenewMonthlyUsd: 0,
      nwcAutoRenewYearlyUsd: 0,
      lightningOneTimeMonthlyUsd: { 1: 0, 3: 0, 6: 0 },
      lightningOneTimeYearlyUsd: 0,
      btcOnchainYearlyUsd: null,
    });
    expectCallouts(free.callouts, FREE_CALLOUTS);

    expect(starter.name).toBe("Starter");
    expect(starter.description).toBe(
      "Cheapest paid tier for one serious account"
    );
    expect(starter.monthlyPriceUsd).toBe(9);
    expect(starter.yearlyPriceUsd).toBe(90);
    expect(starter.yearlySavingsNote).toBe("2 months free");
    expect(starter.planBillingModel).toBe("recurring");
    expect(starter.isPopular).toBe(false);
    expect(starter.features["multipleQueues"]).toBe(true);
    expect(starter.checkoutPricing).toEqual({
      nwcAutoRenewMonthlyUsd: 9,
      nwcAutoRenewYearlyUsd: 90,
      lightningOneTimeMonthlyUsd: { 1: 9, 3: 27, 6: 54 },
      lightningOneTimeYearlyUsd: 90,
      btcOnchainYearlyUsd: null,
    });
    expectCallouts(starter.callouts, STARTER_CALLOUTS);

    expect(creator.name).toBe("Creator");
    expect(creator.description).toBe(
      "Best solo plan with more workflow headroom"
    );
    expect(creator.monthlyPriceUsd).toBe(20);
    expect(creator.yearlyPriceUsd).toBe(160);
    expect(creator.yearlySavingsNote).toBe("4 months free");
    expect(creator.isPopular).toBe(true);
    expect(creator.features["basicScheduling"]).toBe(false);
    expect(creator.features["commissions"]).toBe("Custom");
    expect(creator.features["lifetimeAccess"]).toBe(false);
    expect(creator.features["relayBlast"]).toBe(true);
    expect(creator.features["multipleQueues"]).toBe(true);
    expect(creator.checkoutPricing).toEqual({
      nwcAutoRenewMonthlyUsd: 20,
      nwcAutoRenewYearlyUsd: 160,
      lightningOneTimeMonthlyUsd: { 1: 18, 3: 54, 6: 100 },
      lightningOneTimeYearlyUsd: 150,
      btcOnchainYearlyUsd: 140,
    });
    expectCallouts(creator.callouts, CREATOR_CALLOUTS);

    expect(pro.name).toBe("Pro");
    expect(pro.description).toBe(
      "Multi-account tier with top infra and fanout"
    );
    expect(pro.monthlyPriceUsd).toBe(30);
    expect(pro.yearlyPriceUsd).toBe(360);
    expect(pro.yearlySavingsNote).toBeNull();
    expect(pro.isComingSoon).toBe(true);
    expect(pro.isPopular).toBe(false);
    expect(pro.features["relayBlast"]).toBe(true);
    expect(pro.checkoutPricing).toEqual({
      nwcAutoRenewMonthlyUsd: 30,
      nwcAutoRenewYearlyUsd: 360,
      lightningOneTimeMonthlyUsd: { 1: 30, 3: 90, 6: 180 },
      lightningOneTimeYearlyUsd: 360,
      btcOnchainYearlyUsd: null,
    });
    expectCallouts(pro.callouts, PRO_CALLOUTS);

    expect(alpha.name).toBe("Alpha Founder");
    expect(alpha.description).toBe("Custom founder note");
    expect(alpha.planBillingModel).toBe("disabled");
    expect(alpha.monthlyPriceUsd).toBe(0);
    expect(alpha.yearlySavingsNote).toBeNull();
    expect(alpha.isPopular).toBe(false);
    expectCallouts(alpha.callouts, []);

    expect(teamsCard.name).toBe("Zulu Teams");
    expect(teamsCard.description).toBe("Teams note");
    expect(teamsCard.planBillingModel).toBe("recurring");
    expect(teamsCard.isTeamsPlaceholder).toBe(false);
    expect(teamsCard.monthlyPriceUsd).toBe(0);
    expectCallouts(teamsCard.callouts, []);

    expect(data.founderOffering).toEqual({
      id: "founder",
      name: "Founder",
      description: "",
      oneTimePriceUsd: 499,
      seatCap: 10,
      seatsClaimed: 4,
      seatsRemaining: 6,
      canPurchase: true,
      benefits: FOUNDER_BENEFITS,
      features: {
        advancedAnalytics: false,
        basicScheduling: false,
        bulkScheduling: false,
        commissions: "High",
        engagementFeed: false,
        giveaways: false,
        leaderboards: false,
        lifetimeAccess: true,
        multiAccountSwitching: false,
        multipleQueues: false,
        nativeS3BlossomStorage: false,
        relayBlast: false,
        repostsAndQuotes: false,
        visualPerks: false,
        wolfFilteringAndVortex: false,
      },
      checkoutPricing: {
        nwcAutoRenewMonthlyUsd: 49,
        nwcAutoRenewYearlyUsd: 399,
        lightningOneTimeMonthlyUsd: { 1: 49, 3: 147, 6: 294 },
        lightningOneTimeYearlyUsd: 399,
        btcOnchainYearlyUsd: null,
      },
    });
  });

  it("returns a signed-in user who has no subscription", async () => {
    const nwc = {
      enabled: true,
      maskedString: "nostr+walletconnect://****",
      lastUsed: null,
    };
    session.requireUser.mockResolvedValue({
      id: "user-1",
      isEnabled: true,
      isChild: false,
    });
    userApi.getUserNWC.mockResolvedValue(nwc);

    const data = await loadPlansData(plansRequest());

    expect(data.user).toEqual({ id: "user-1", isEnabled: true });
    expect(data.linkedChildAccount).toBe(false);
    expect(data.nwc).toEqual(nwc);
    expect(data.currentSubscription).toBeNull();
    expect(paymentsData.getUserSubscription).toHaveBeenCalledWith("user-1");
    expect(userApi.getUserNWC).toHaveBeenCalledWith("user-1");
  });

  it("returns a linked child with an active subscription", async () => {
    const periodEnd = new Date("2099-06-01T00:00:00.000Z");
    session.requireUser.mockResolvedValue({
      id: "user-child",
      isEnabled: false,
      isChild: true,
    });
    userApi.getUserNWC.mockResolvedValue({
      enabled: false,
      maskedString: "mask",
      lastUsed: null,
    });
    paymentsData.getUserSubscription.mockResolvedValue({
      planId: "creator",
      status: "ACTIVE",
      currentPeriodEnd: periodEnd,
      Plan: {
        name: "Creator",
        id: "creator",
        enableLifetimeAccess: false,
      },
    });

    const data = await loadPlansData(plansRequest());

    expect(data.user).toEqual({ id: "user-child", isEnabled: false });
    expect(data.linkedChildAccount).toBe(true);
    expect(data.nwc).toEqual({
      enabled: false,
      maskedString: "mask",
      lastUsed: null,
    });
    expect(data.currentSubscription).toEqual({
      planId: "creator",
      status: "ACTIVE",
      plan: "Creator",
      isExpired: false,
    });
  });

  it("marks an elapsed active period expired and keeps lifetime access current", async () => {
    session.requireUser.mockResolvedValue({
      id: "user-1",
      isEnabled: true,
      isChild: false,
    });
    const past = new Date("2000-01-01T00:00:00.000Z");

    paymentsData.getUserSubscription.mockResolvedValueOnce({
      planId: "starter",
      status: "ACTIVE",
      currentPeriodEnd: past,
    });
    const expired = await loadPlansData(plansRequest());
    expect(expired.currentSubscription).toEqual({
      planId: "starter",
      status: "ACTIVE",
      plan: undefined,
      isExpired: true,
    });

    paymentsData.getUserSubscription.mockResolvedValueOnce({
      planId: "founder",
      status: "ACTIVE",
      currentPeriodEnd: past,
      Plan: {
        name: "Founder",
        id: "founder",
        enableLifetimeAccess: true,
      },
    });
    const lifetime = await loadPlansData(plansRequest());
    expect(lifetime.currentSubscription).toEqual({
      planId: "founder",
      status: "ACTIVE",
      plan: "Founder",
      isExpired: false,
    });

    paymentsData.getUserSubscription.mockResolvedValueOnce({
      planId: "pro",
      status: "CANCELED",
      currentPeriodEnd: past,
      Plan: { name: "Pro", id: "pro", enableLifetimeAccess: false },
    });
    const canceled = await loadPlansData(plansRequest());
    expect(canceled.currentSubscription?.isExpired).toBe(false);

    paymentsData.getUserSubscription.mockResolvedValueOnce({
      planId: "pro",
      status: "ACTIVE",
      currentPeriodEnd: null,
      Plan: { name: "Pro", id: "pro" },
    });
    const openEnded = await loadPlansData(plansRequest());
    expect(openEnded.currentSubscription?.isExpired).toBe(false);

    paymentsData.getUserSubscription.mockResolvedValueOnce({
      planId: "pro",
      status: "ACTIVE",
      currentPeriodEnd: "",
      Plan: { name: "Pro", id: "pro", enableLifetimeAccess: false },
    });
    const blankEnd = await loadPlansData(plansRequest());
    expect(blankEnd.currentSubscription?.isExpired).toBe(false);
  });

  it("hides a founder offer without a seat cap and closes a sold-out offer", async () => {
    paymentsData.getAllPlans.mockResolvedValueOnce([
      makePlan({
        id: "founder",
        name: "Founder",
        price: 499,
        planBillingModel: paymentsData.PlanBillingModel.lifetime,
        isSpecialOffering: true,
        founderSeatCap: null,
      }),
    ]);
    const uncapped = await loadPlansData(plansRequest());
    expect(uncapped.founderOffering).toBeNull();
    expect(paymentsData.countActiveSubscriptionsForPlan).not.toHaveBeenCalled();

    paymentsData.getAllPlans.mockResolvedValueOnce([
      makePlan({
        id: "founder",
        name: "Founder",
        description: "Limited seats",
        price: 499,
        planBillingModel: paymentsData.PlanBillingModel.lifetime,
        isSpecialOffering: true,
        founderSeatCap: 3,
        purchasable: true,
      }),
    ]);
    paymentsData.countActiveSubscriptionsForPlan.mockResolvedValueOnce(3);
    const soldOut = await loadPlansData(plansRequest());
    expect(soldOut.founderOffering).toMatchObject({
      description: "Limited seats",
      seatCap: 3,
      seatsClaimed: 3,
      seatsRemaining: 0,
      canPurchase: false,
    });

    paymentsData.getAllPlans.mockResolvedValueOnce([
      makePlan({
        id: "founder",
        name: "Founder",
        price: 499,
        planBillingModel: paymentsData.PlanBillingModel.lifetime,
        isSpecialOffering: true,
        founderSeatCap: 5,
        purchasable: false,
      }),
    ]);
    paymentsData.countActiveSubscriptionsForPlan.mockResolvedValueOnce(1);
    const unpurchasable = await loadPlansData(plansRequest());
    expect(unpurchasable.founderOffering).toMatchObject({
      seatsRemaining: 4,
      canPurchase: false,
    });
  });

  it("keeps the signed-in user when subscription or wallet lookup throws", async () => {
    session.requireUser.mockResolvedValue({
      id: "user-1",
      isEnabled: true,
      isChild: false,
    });
    paymentsData.getUserSubscription.mockRejectedValueOnce(
      new Error("sub down")
    );
    const subscriptionFailed = await loadPlansData(plansRequest());
    expect(subscriptionFailed.user).toEqual({ id: "user-1", isEnabled: true });
    expect(subscriptionFailed.currentSubscription).toBeNull();
    expect(subscriptionFailed.nwc).toBeNull();
    expect(userApi.getUserNWC).not.toHaveBeenCalled();

    paymentsData.getUserSubscription.mockResolvedValueOnce({
      planId: "pro",
      status: "ACTIVE",
      currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
      Plan: { name: "Pro", id: "pro", enableLifetimeAccess: false },
    });
    userApi.getUserNWC.mockRejectedValueOnce(new Error("nwc down"));
    const walletFailed = await loadPlansData(plansRequest());
    expect(walletFailed.user).toEqual({ id: "user-1", isEnabled: true });
    expect(walletFailed.currentSubscription).toEqual({
      planId: "pro",
      status: "ACTIVE",
      plan: "Pro",
      isExpired: false,
    });
    expect(walletFailed.nwc).toBeNull();
  });

  it("reports the checkout flag from feature flags", async () => {
    flags.featureFlags.subscriptionCheckoutV2Enabled = false;

    const data = await loadPlansData(plansRequest());

    expect(data.subscriptionCheckoutV2Enabled).toBe(false);
    expect(data.btcpayYearlyOnChainEnabled).toBe(true);
  });

  it("rejects when the plan catalog, prices, or seat count throw", async () => {
    paymentsData.getAllPlans.mockRejectedValueOnce(new Error("plans down"));
    await expect(loadPlansData(plansRequest())).rejects.toThrow("plans down");

    paymentsData.getAllPlans.mockResolvedValueOnce([
      makePlan({
        id: "starter",
        planBillingModel: paymentsData.PlanBillingModel.recurring,
      }),
    ]);
    paymentsData.listActivePlanPricesForPlans.mockRejectedValueOnce(
      new Error("prices down")
    );
    await expect(loadPlansData(plansRequest())).rejects.toThrow("prices down");

    paymentsData.getAllPlans.mockResolvedValueOnce([
      makePlan({
        id: "founder",
        price: 100,
        planBillingModel: paymentsData.PlanBillingModel.lifetime,
        isSpecialOffering: true,
        founderSeatCap: 5,
      }),
    ]);
    paymentsData.listActivePlanPricesForPlans.mockResolvedValueOnce([]);
    paymentsData.countActiveSubscriptionsForPlan.mockRejectedValueOnce(
      new Error("count down")
    );
    await expect(loadPlansData(plansRequest())).rejects.toThrow("count down");
  });
});
