import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

const userApi = vi.hoisted(() => ({
  getConfirmedChildrenForParent: vi.fn(),
  getGiveawayBlacklist: vi.fn(),
  getPendingChildrenForParent: vi.fn(),
  getPendingParentRequestsForChild: vi.fn(),
  getQueueTypes: vi.fn(),
  getResolvedUploadProviderSettings: vi.fn(),
  getScheduleInterval: vi.fn(),
  getUserBasicInfo: vi.fn(),
  getUserBlastrRelayEnabled: vi.fn(),
  getUserByNpubWithProfile: vi.fn(),
  getUserCustomNostrClientBaseUrl: vi.fn(),
  getUserDateFormat: vi.fn(),
  getUserDefaultZapAmountSatsStored: vi.fn(),
  getUserEnableMirrorBlossom: vi.fn(),
  getUserFilterMuted: vi.fn(),
  getUserHidePostsFromLowTrustUsers: vi.fn(),
  getUserMirrorUploadUrls: vi.fn(),
  getUserMutedList: vi.fn(),
  getUserNWC: vi.fn(),
  getUserPreferredNostrClient: vi.fn(),
  getUserPrimarySignerProfile: vi.fn(),
  getUserPushNotificationPreferences: vi.fn(),
  getUserThemePreference: vi.fn(),
  getUserTimeFormat: vi.fn(),
  getUserTimezone: vi.fn(),
  getUsersByNpubs: vi.fn(),
}));

const payments = vi.hoisted(() => {
  const getUserSubscription = vi.fn();
  return {
    getAllPlans: vi.fn(),
    getRelayFanoutSubscription: vi.fn((userId: string) =>
      getUserSubscription(userId)
    ),
    getUserPaymentHistory: vi.fn(),
    getUserSubscription,
  };
});

const subscriptions = vi.hoisted(() => ({
  getSubscriptionData: vi.fn(),
  isSubscriptionActiveForGating: vi.fn(),
}));

const relays = vi.hoisted(() => ({
  getEffectiveWriteRelays: vi.fn(),
  loadRelaySettingsLoaderSlice: vi.fn(),
}));

const blastr = vi.hoisted(() => ({
  getUserPolicy: vi.fn(),
  resolvePubkeyHex: vi.fn(),
}));

const entitlementSync = vi.hoisted(() => ({
  syncBlastrEntitlementForUser: vi.fn(async () => undefined),
}));

const deployment = vi.hoisted(() => ({
  relayFanoutForSubscription: vi.fn(),
}));

const referral = vi.hoisted(() => ({
  getReferralSettingsData: vi.fn(),
}));

const templates = vi.hoisted(() => ({
  listReplyTemplates: vi.fn(),
}));

const cache = vi.hoisted(() => ({
  getHashTagPresetsCached: vi.fn(),
}));

const acks = vi.hoisted(() => ({
  findLatestPublishRelayAcksByUserAndUrls: vi.fn(),
}));

const logger = vi.hoisted(() => ({
  logWarning: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));
vi.mock("~/features/user", () => userApi);
vi.mock("~/features/payments/data", () => payments);
vi.mock("~/features/payments/subscriptions.server", () => subscriptions);
vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => deployment
);
vi.mock("~/features/relays/relay-resolution.server", () => relays);
vi.mock("~/infra/blastr/blastr-admin.client.server", () => blastr);
vi.mock("~/infra/blastr/entitlement-sync.server", () => entitlementSync);
vi.mock("~/features/referral/referral-settings.server", () => referral);
vi.mock(
  "~/features/engagement/engagement-reply-templates.server",
  () => templates
);
vi.mock("~/features/user/services/user-cache.server", () => cache);
vi.mock(
  "~/features/settings/repositories/settings-loader-data.server",
  () => acks
);
vi.mock("~/lib/error-logger.server", () => logger);
interface PrimarySignerModule {
  isPrimarySignerProfile: (value: unknown) => boolean;
}

vi.mock("~/features/auth/signer", async () => {
  const profile = await vi.importActual<PrimarySignerModule>(
    "~/features/auth/signer/primary-signer-profile"
  );
  return { isPrimarySignerProfile: profile.isPrimarySignerProfile };
});

import { getQueueAccentHex } from "~/features/posts/queue-colors";
import { BLASTR_KNOWN_SYSTEM_RELAYS } from "~/features/relays/relay-constants";
import {
  loadSettingsData,
  SETTINGS_LOADER_FALLBACK,
} from "~/features/settings/settings-loader.server";

const USER_ID = "user-1";
const START = new Date("2026-01-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-12-01T00:00:00.000Z");
const NEXT_DUE = new Date("2026-02-01T00:00:00.000Z");
const LAST_ATTEMPT = new Date("2026-01-15T00:00:00.000Z");
const NEXT_ATTEMPT = new Date("2026-01-16T00:00:00.000Z");
const GRACE_END = new Date("2026-01-20T00:00:00.000Z");
const NWC_USED = new Date("2026-02-01T00:00:00.000Z");
const PAID_AT = new Date("2026-01-10T00:00:00.000Z");
const ACK_CREATED = new Date("2026-03-01T00:00:00.000Z");
const ACK_RECEIVED = new Date("2026-03-01T00:00:01.000Z");
const PAID_UNTIL = new Date("2026-12-01T00:00:00.000Z");
const EMPTY_REFERRAL = {
  referralLink: "",
  commissionRatePercent: 20,
  totalEarnedSats: 0,
  paidSats: 0,
  pendingSats: 0,
  failedSats: 0,
  payoutDestination: null,
  payoutDestinationType: null,
};
const SIGNER_PROFILE = {
  type: "nip46",
  method: "bunker_input",
  bunkerInput: "bunker://alice",
  label: "Phone",
  expectedPubkey: null,
  updatedAt: "2026-01-02T00:00:00.000Z",
} as const;

function primeSettings(): void {
  userApi.getUserTimezone.mockResolvedValue(null);
  relays.loadRelaySettingsLoaderSlice.mockResolvedValue({
    appRelays: [],
    publishRelaySource: "nip65_profile",
    npub: "",
    relayIntent: { writeRelays: [] },
    profileRelays: [],
    profileRelayEntries: [],
  });
  relays.getEffectiveWriteRelays.mockResolvedValue({
    direct: [],
    managed: [],
  });
  userApi.getGiveawayBlacklist.mockResolvedValue([]);
  userApi.getQueueTypes.mockResolvedValue([]);
  userApi.getResolvedUploadProviderSettings.mockResolvedValue({
    provider: "",
    storedUploadProvider: "",
    customBlossomUrl: null,
  });
  subscriptions.isSubscriptionActiveForGating.mockResolvedValue(false);
  userApi.getUserEnableMirrorBlossom.mockResolvedValue(false);
  userApi.getUserMirrorUploadUrls.mockResolvedValue([]);
  cache.getHashTagPresetsCached.mockResolvedValue([]);
  userApi.getUserNWC.mockResolvedValue({ enabled: false });
  userApi.getUserMutedList.mockResolvedValue(null);
  templates.listReplyTemplates.mockResolvedValue([]);
  userApi.getUserFilterMuted.mockResolvedValue(false);
  userApi.getUserHidePostsFromLowTrustUsers.mockResolvedValue(false);
  userApi.getUserPushNotificationPreferences.mockResolvedValue({
    pushNotificationsEnabled: false,
    pushNotifyPublishSuccess: false,
    pushNotifyPublishFailure: false,
    pushNotifyRunwayLow: false,
    pushNotifyIncludePreview: false,
    runwayNotifyBelowDays: null,
  });
  userApi.getUserTimeFormat.mockResolvedValue("12h");
  userApi.getUserDateFormat.mockResolvedValue("mmddyyyy");
  userApi.getUserPreferredNostrClient.mockResolvedValue("");
  userApi.getUserCustomNostrClientBaseUrl.mockResolvedValue(null);
  userApi.getUserPrimarySignerProfile.mockResolvedValue(null);
  userApi.getUserBlastrRelayEnabled.mockResolvedValue(true);
  userApi.getUserThemePreference.mockResolvedValue(null);
  userApi.getUserDefaultZapAmountSatsStored.mockResolvedValue(null);
  userApi.getScheduleInterval.mockResolvedValue([]);
  payments.getRelayFanoutSubscription.mockImplementation((userId: string) =>
    payments.getUserSubscription(userId)
  );
  payments.getUserSubscription.mockResolvedValue(null);
  userApi.getUserBasicInfo.mockResolvedValue(null);
  payments.getAllPlans.mockResolvedValue([]);
  payments.getUserPaymentHistory.mockResolvedValue([]);
  referral.getReferralSettingsData.mockResolvedValue(EMPTY_REFERRAL);
  subscriptions.getSubscriptionData.mockResolvedValue({});
  userApi.getConfirmedChildrenForParent.mockResolvedValue([]);
  userApi.getPendingChildrenForParent.mockResolvedValue([]);
  userApi.getPendingParentRequestsForChild.mockResolvedValue([]);
  userApi.getUsersByNpubs.mockResolvedValue([]);
  userApi.getUserByNpubWithProfile.mockResolvedValue(null);
  deployment.relayFanoutForSubscription.mockReturnValue(false);
  blastr.resolvePubkeyHex.mockReturnValue(null);
  blastr.getUserPolicy.mockResolvedValue(null);
  entitlementSync.syncBlastrEntitlementForUser.mockResolvedValue(undefined);
  acks.findLatestPublishRelayAcksByUserAndUrls.mockResolvedValue([]);
}

function requireById<T extends { id: string }>(
  items: readonly T[],
  id: string
): T {
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(`Missing ${id}`);
  }
  return item;
}

describe("settings loader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    primeSettings();
  });

  it("exposes safe fallback settings", () => {
    expect(SETTINGS_LOADER_FALLBACK.timezone).toBe("Etc/GMT");
    expect(SETTINGS_LOADER_FALLBACK.publishRelaySource).toBe("nip65_profile");
    expect(SETTINGS_LOADER_FALLBACK.relays).toEqual([]);
    expect(SETTINGS_LOADER_FALLBACK.subscription).toBeNull();
    expect(SETTINGS_LOADER_FALLBACK.availablePlans).toEqual([]);
    expect(SETTINGS_LOADER_FALLBACK.isChild).toBe(false);
    expect(SETTINGS_LOADER_FALLBACK.hasAccountsAccess).toBe(false);
    expect(SETTINGS_LOADER_FALLBACK.canToggleBlastr).toBe(false);
    expect(SETTINGS_LOADER_FALLBACK.blastrRelayEnabled).toBe(true);
    expect(SETTINGS_LOADER_FALLBACK.blastrPolicy).toBeNull();
    expect(SETTINGS_LOADER_FALLBACK.blastrSystemRelays).toEqual([]);
    expect(SETTINGS_LOADER_FALLBACK.timeFormat).toBe("12h");
    expect(SETTINGS_LOADER_FALLBACK.dateFormat).toBe("mmddyyyy");
    expect(SETTINGS_LOADER_FALLBACK.themePreference).toBeNull();
    expect(SETTINGS_LOADER_FALLBACK.defaultZapAmountSats).toBeNull();
    expect(SETTINGS_LOADER_FALLBACK.isSubscriptionActiveForGating).toBe(false);
    expect(SETTINGS_LOADER_FALLBACK.billingContext).toBeNull();
    expect(SETTINGS_LOADER_FALLBACK.referral).toEqual(EMPTY_REFERRAL);
    expect(SETTINGS_LOADER_FALLBACK.accounts.pendingIncomingParents).toEqual(
      []
    );
    expect(SETTINGS_LOADER_FALLBACK.mutedList).toMatchObject({ npubs: [] });
  });

  it("returns empty settings when the user record and subscription are missing", async () => {
    const data = await loadSettingsData(USER_ID);

    expect(data.timezone).toBeNull();
    expect(data.relays).toEqual([]);
    expect(data.publishRelaySource).toBe("nip65_profile");
    expect(data.profileRelays).toEqual([]);
    expect(data.profileRelayEntries).toEqual([]);
    expect(data.managedRelays).toEqual([]);
    expect(data.relayAcks).toEqual({});
    expect(data.giveawayBlacklist).toEqual([]);
    expect(data.queueTypes).toEqual([]);
    expect(data.globalScheduleIntervalHours).toEqual([]);
    expect(data.uploadProvider).toBe("");
    expect(data.uploadProviderStored).toBe("");
    expect(data.isSubscriptionActiveForGating).toBe(false);
    expect(data.customBlossomUrl).toBeNull();
    expect(data.enableMirrorBlossom).toBe(false);
    expect(data.mirrorUploadUrls).toEqual([]);
    expect(data.hashTagPresets).toEqual([]);
    expect(data.nwcEnabled).toBe(false);
    expect(data.maskedNwcString).toBeNull();
    expect(data.nwcLastUsed).toBeNull();
    expect(data.subscription).toBeNull();
    expect(data.availablePlans).toEqual([]);
    expect(data.paymentHistory).toEqual([]);
    expect(data.isChild).toBe(false);
    expect(entitlementSync.syncBlastrEntitlementForUser).not.toHaveBeenCalled();
    expect(data.hasAccountsAccess).toBe(true);
    expect(data.accounts).toEqual({
      isChild: false,
      parentNpub: "",
      parentUser: null,
      confirmedChildren: [],
      pendingChildren: [],
      pendingIncomingParents: [],
    });
    expect(data.mutedList).toBeNull();
    expect(data.filterMuted).toBe(false);
    expect(data.hidePostsFromLowTrustUsers).toBe(false);
    expect(data.replyTemplates).toEqual([]);
    expect(data.pushNotificationsEnabled).toBe(false);
    expect(data.pushNotifyPublishSuccess).toBe(false);
    expect(data.pushNotifyPublishFailure).toBe(false);
    expect(data.pushNotifyRunwayLow).toBe(false);
    expect(data.pushNotifyIncludePreview).toBe(false);
    expect(data.runwayNotifyBelowDays).toBeNull();
    expect(data.timeFormat).toBe("12h");
    expect(data.dateFormat).toBe("mmddyyyy");
    expect(data.preferredNostrClient).toBe("");
    expect(data.customNostrClientBaseUrl).toBeNull();
    expect(data.primarySignerProfile).toBeNull();
    expect(data.blastrRelayEnabled).toBe(true);
    expect(data.themePreference).toBeNull();
    expect(data.canToggleBlastr).toBe(false);
    expect(data.blastrPolicy).toBeNull();
    expect(data.blastrSystemRelays).toBe(BLASTR_KNOWN_SYSTEM_RELAYS);
    expect(data.referral).toEqual(EMPTY_REFERRAL);
    expect(data.defaultZapAmountSats).toBeNull();
    expect(data.billingContext).toBeNull();

    expect(acks.findLatestPublishRelayAcksByUserAndUrls).not.toHaveBeenCalled();
    expect(logger.logWarning).not.toHaveBeenCalled();
    expect(blastr.resolvePubkeyHex).not.toHaveBeenCalled();
    expect(userApi.getConfirmedChildrenForParent).not.toHaveBeenCalled();
    expect(userApi.getPendingChildrenForParent).not.toHaveBeenCalled();
    expect(userApi.getPendingParentRequestsForChild).not.toHaveBeenCalled();
    expect(userApi.getUserByNpubWithProfile).not.toHaveBeenCalled();
    expect(userApi.getUsersByNpubs).toHaveBeenCalledWith([]);
    expect(payments.getAllPlans).toHaveBeenCalledTimes(1);
    expect(referral.getReferralSettingsData).toHaveBeenCalledWith("");
    expect(subscriptions.getSubscriptionData).toHaveBeenCalledWith(USER_ID);
    expect(deployment.relayFanoutForSubscription).toHaveBeenCalledWith({
      subscriptionActive: false,
      planEnablesRelayBlast: false,
    });
    expect(relays.getEffectiveWriteRelays).toHaveBeenCalledWith(USER_ID, {
      intent: { writeRelays: [] },
    });
  });

  it("loads a populated parent account with subscription, relays, and blastr policy", async () => {
    const presets = [{ id: "preset-1", name: "Nostr", tags: "#nostr" }];
    const replyTemplates = [{ id: "tpl-1", slug: "thanks", body: "Thank you" }];
    const blacklist = ["npub1bad"];
    const mirrorUrls = ["https://blossom.example"];
    const mutedList = {
      npubs: ["npub1muted"],
      lastSynced: "2026-01-01T00:00:00.000Z",
    };
    const managed = [
      {
        id: "blastr",
        role: "fanout",
        enabled: true,
        relayUrl: "wss://blastr.example",
      },
    ];
    const profileRelayEntries = [
      { url: "wss://d.example", scope: "write" },
      { url: "wss://e.example", scope: "read" },
    ];
    const confirmedChildren = [
      { id: "child-1", npub: "npub1kid", name: "Kid" },
    ];
    const pendingChildren = [
      { id: "child-2", npub: "npub1pending", name: "Pending" },
    ];
    const billingContext = {
      commMode: "AUTO_RENEW_NWC",
      uiStatus: "ACTIVE_AUTO_RENEW",
      isPaidLifecycle: true,
      paidUntil: PAID_UNTIL,
      graceEndsAt: null,
      bannerVariant: "none",
      primaryCta: "manage_nwc",
    };
    const referralData = {
      referralLink: "https://smartflow.social/?ref=npub1me",
      commissionRatePercent: 20,
      totalEarnedSats: 100,
      paidSats: 40,
      pendingSats: 50,
      failedSats: 10,
      payoutDestination: "alice@getalby.com",
      payoutDestinationType: "lnurl",
    };

    userApi.getUserTimezone.mockResolvedValue("Europe/Kyiv");
    relays.loadRelaySettingsLoaderSlice.mockResolvedValue({
      appRelays: ["wss://a.example", "wss://c.example"],
      publishRelaySource: "app",
      npub: "npub1me",
      relayIntent: { writeRelays: ["wss://a.example", "wss://b.example"] },
      profileRelays: ["wss://d.example"],
      profileRelayEntries,
    });
    relays.getEffectiveWriteRelays.mockResolvedValue({
      direct: ["wss://a.example", "wss://b.example"],
      managed,
    });
    userApi.getGiveawayBlacklist.mockResolvedValue(blacklist);
    userApi.getQueueTypes.mockResolvedValue([
      {
        id: "q1",
        name: "Main",
        colorToken: "blue",
        description: "Daily",
        scheduleType: "INTERVAL",
        scheduleConfig: { hours: [8] },
        isEnabled: true,
        status: "ACTIVE",
        isDefault: true,
        userId: USER_ID,
        hashTagPresetId: "preset-1",
        includeHashtagsInNoteBody: true,
        hashTagPreset: {
          id: "preset-1",
          name: "Nostr",
          tags: "#nostr",
          description: "Tags",
        },
      },
    ]);
    userApi.getScheduleInterval.mockResolvedValue(["24", "1"]);
    userApi.getResolvedUploadProviderSettings.mockResolvedValue({
      provider: "sfs",
      storedUploadProvider: "blossom",
      customBlossomUrl: "https://blossom.example",
    });
    subscriptions.isSubscriptionActiveForGating.mockResolvedValue(true);
    userApi.getUserEnableMirrorBlossom.mockResolvedValue(true);
    userApi.getUserMirrorUploadUrls.mockResolvedValue(mirrorUrls);
    cache.getHashTagPresetsCached.mockResolvedValue(presets);
    userApi.getUserNWC.mockResolvedValue({
      enabled: true,
      maskedString: "nostr+walletconnect://****",
      lastUsed: NWC_USED,
    });
    userApi.getUserMutedList.mockResolvedValue(mutedList);
    templates.listReplyTemplates.mockResolvedValue(replyTemplates);
    userApi.getUserFilterMuted.mockResolvedValue(true);
    userApi.getUserHidePostsFromLowTrustUsers.mockResolvedValue(true);
    userApi.getUserPushNotificationPreferences.mockResolvedValue({
      pushNotificationsEnabled: true,
      pushNotifyPublishSuccess: true,
      pushNotifyPublishFailure: true,
      pushNotifyRunwayLow: true,
      pushNotifyIncludePreview: true,
      runwayNotifyBelowDays: 5,
    });
    userApi.getUserTimeFormat.mockResolvedValue("24h");
    userApi.getUserDateFormat.mockResolvedValue("yyyymmdd");
    userApi.getUserPreferredNostrClient.mockResolvedValue("DAMUS");
    userApi.getUserCustomNostrClientBaseUrl.mockResolvedValue(
      "https://client.example"
    );
    userApi.getUserPrimarySignerProfile.mockResolvedValue(SIGNER_PROFILE);
    userApi.getUserBlastrRelayEnabled.mockResolvedValue(false);
    userApi.getUserThemePreference.mockResolvedValue("dark");
    userApi.getUserDefaultZapAmountSatsStored.mockResolvedValue(21);
    payments.getUserSubscription.mockResolvedValue({
      id: "sub-1",
      planId: "Creator",
      status: "ACTIVE",
      renewalMode: "auto",
      billingCadence: "monthly",
      accessDurationMonths: 1,
      paymentMethod: "nwc_auto_renew",
      renewalFailureCount: 2,
      lastRenewalAttemptAt: LAST_ATTEMPT,
      nextRenewalAttemptAt: NEXT_ATTEMPT,
      gracePeriodEndsAt: null,
      startDate: START,
      currentPeriodEnd: PERIOD_END,
      nextPaymentDue: NEXT_DUE,
      cancelAtPeriodEnd: false,
      Plan: {
        id: "creator",
        name: "Creator",
        price: 19,
        enableLifetimeAccess: false,
        enableRelayBlast: true,
      },
    });
    userApi.getUserBasicInfo.mockResolvedValue({
      npub: "npub1me",
      isChild: false,
      parentNpub: null,
    });
    payments.getAllPlans.mockResolvedValue([
      {
        id: "starter",
        name: "Starter",
        price: 9,
        purchasable: true,
        enableLifetimeAccess: false,
      },
      {
        id: "hidden",
        name: "Hidden",
        price: 1,
        purchasable: false,
        enableLifetimeAccess: false,
      },
      {
        id: "pro",
        name: "Pro",
        price: 29.5,
        purchasable: true,
        enableLifetimeAccess: true,
      },
    ]);
    payments.getUserPaymentHistory.mockResolvedValue([
      {
        id: "pay-1",
        amount: 2100,
        amountUsd: 19,
        description: "Creator month",
        paidAt: PAID_AT,
        paymentMethod: "nwc_auto_renew",
        paymentHash: "hash-1",
        Subscription: { Plan: { name: "Creator", price: 19 } },
      },
    ]);
    referral.getReferralSettingsData.mockResolvedValue(referralData);
    subscriptions.getSubscriptionData.mockResolvedValue({ billingContext });
    userApi.getConfirmedChildrenForParent.mockResolvedValue(confirmedChildren);
    userApi.getPendingChildrenForParent.mockResolvedValue(pendingChildren);
    userApi.getPendingParentRequestsForChild.mockResolvedValue([
      "npub1incoming",
    ]);
    userApi.getUsersByNpubs.mockResolvedValue([
      { npub: "npub1incoming", nostrProfile: { name: "Incoming" } },
      { npub: "npub1blank" },
    ]);
    deployment.relayFanoutForSubscription.mockReturnValue(true);
    blastr.resolvePubkeyHex.mockReturnValue("aa");
    blastr.getUserPolicy.mockResolvedValue({
      policy: { mode: "blacklist", enabled: true },
      relays: [{ relay_url: "wss://blocked.example", action: "block" }],
      ignored: true,
    });
    acks.findLatestPublishRelayAcksByUserAndUrls.mockResolvedValue([
      {
        relayUrl: "wss://a.example",
        status: "ok",
        createdAt: ACK_CREATED,
        receivedAt: ACK_RECEIVED,
      },
      {
        relayUrl: "wss://b.example",
        status: "timeout",
        createdAt: ACK_CREATED,
        receivedAt: null,
      },
    ]);

    const data = await loadSettingsData(USER_ID);

    expect(data.timezone).toBe("Europe/Kyiv");
    expect(data.relays).toEqual(["wss://a.example", "wss://c.example"]);
    expect(data.publishRelaySource).toBe("app");
    expect(data.profileRelays).toEqual(["wss://d.example"]);
    expect(data.profileRelayEntries).toBe(profileRelayEntries);
    expect(data.managedRelays).toBe(managed);
    expect(data.relayAcks).toEqual({
      "wss://a.example": {
        status: "ok",
        createdAt: "2026-03-01T00:00:00.000Z",
        receivedAt: "2026-03-01T00:00:01.000Z",
      },
      "wss://b.example": {
        status: "timeout",
        createdAt: "2026-03-01T00:00:00.000Z",
        receivedAt: null,
      },
    });
    expect(data.queueTypes).toEqual([
      {
        id: "q1",
        name: "Main",
        color: getQueueAccentHex("blue"),
        colorToken: "blue",
        description: "Daily",
        scheduleType: "INTERVAL",
        scheduleConfig: { hours: [8] },
        status: "active",
        isEnabled: true,
        isDefault: true,
        userId: USER_ID,
        hashTagPresetId: "preset-1",
        includeHashtagsInNoteBody: true,
        hashTagPreset: {
          id: "preset-1",
          name: "Nostr",
          tags: "#nostr",
          description: "Tags",
        },
      },
    ]);
    expect(data.globalScheduleIntervalHours).toEqual([1, 24]);
    expect(data.uploadProvider).toBe("sfs");
    expect(data.uploadProviderStored).toBe("blossom");
    expect(data.customBlossomUrl).toBe("https://blossom.example");
    expect(data.isSubscriptionActiveForGating).toBe(true);
    expect(data.enableMirrorBlossom).toBe(true);
    expect(data.mirrorUploadUrls).toBe(mirrorUrls);
    expect(data.hashTagPresets).toBe(presets);
    expect(data.giveawayBlacklist).toBe(blacklist);
    expect(data.nwcEnabled).toBe(true);
    expect(data.maskedNwcString).toBe("nostr+walletconnect://****");
    expect(data.nwcLastUsed).toBe(NWC_USED);
    expect(data.mutedList).toBe(mutedList);
    expect(data.replyTemplates).toBe(replyTemplates);
    expect(data.filterMuted).toBe(true);
    expect(data.hidePostsFromLowTrustUsers).toBe(true);
    expect(data.pushNotificationsEnabled).toBe(true);
    expect(data.pushNotifyPublishSuccess).toBe(true);
    expect(data.pushNotifyPublishFailure).toBe(true);
    expect(data.pushNotifyRunwayLow).toBe(true);
    expect(data.pushNotifyIncludePreview).toBe(true);
    expect(data.runwayNotifyBelowDays).toBe(5);
    expect(data.timeFormat).toBe("24h");
    expect(data.dateFormat).toBe("yyyymmdd");
    expect(data.preferredNostrClient).toBe("DAMUS");
    expect(data.customNostrClientBaseUrl).toBe("https://client.example");
    expect(data.primarySignerProfile).toBe(SIGNER_PROFILE);
    expect(data.blastrRelayEnabled).toBe(false);
    expect(data.themePreference).toBe("dark");
    expect(data.defaultZapAmountSats).toBe(21);
    expect(data.subscription).toEqual({
      id: "sub-1",
      planId: "Creator",
      status: "ACTIVE",
      renewalMode: "auto",
      billingCadence: "monthly",
      accessDurationMonths: 1,
      billingPaymentMethod: "nwc_auto_renew",
      renewalFailureCount: 2,
      lastRenewalAttemptAt: LAST_ATTEMPT,
      nextRenewalAttemptAt: NEXT_ATTEMPT,
      gracePeriodEndsAt: null,
      startDate: START,
      currentPeriodEnd: PERIOD_END,
      nextPaymentDue: NEXT_DUE,
      cancelAtPeriodEnd: false,
      plan: {
        id: "creator",
        name: "Creator",
        price: 19,
        enableLifetimeAccess: false,
      },
    });
    expect(data.availablePlans).toEqual([
      {
        id: "starter",
        name: "Starter",
        price: 9,
        enableLifetimeAccess: false,
      },
      { id: "pro", name: "Pro", price: 29.5, enableLifetimeAccess: true },
    ]);
    expect(data.paymentHistory).toEqual([
      {
        id: "pay-1",
        amount: 2100,
        amountUsd: 19,
        description: "Creator month",
        paidAt: PAID_AT,
        paymentMethod: "nwc_auto_renew",
        paymentHash: "hash-1",
        planName: "Creator",
        planPrice: 19,
      },
    ]);
    expect(data.isChild).toBe(false);
    expect(data.hasAccountsAccess).toBe(true);
    expect(data.accounts).toEqual({
      isChild: false,
      parentNpub: "npub1me",
      parentUser: null,
      confirmedChildren,
      pendingChildren,
      pendingIncomingParents: [
        {
          id: "npub1incoming",
          npub: "npub1incoming",
          nostrProfile: { name: "Incoming" },
        },
        { id: "npub1blank", npub: "npub1blank", nostrProfile: null },
      ],
    });
    expect(data.referral).toEqual(referralData);
    expect(data.billingContext).toEqual(billingContext);
    expect(data.canToggleBlastr).toBe(true);
    expect(data.blastrPolicy).toEqual({
      policy: { mode: "blacklist", enabled: true },
      relays: [{ relay_url: "wss://blocked.example", action: "block" }],
    });
    expect(data.blastrSystemRelays).toBe(BLASTR_KNOWN_SYSTEM_RELAYS);
    expect(logger.logWarning).not.toHaveBeenCalled();
    expect(relays.getEffectiveWriteRelays).toHaveBeenCalledWith(USER_ID, {
      intent: { writeRelays: ["wss://a.example", "wss://b.example"] },
    });
    expect(acks.findLatestPublishRelayAcksByUserAndUrls).toHaveBeenCalledWith(
      USER_ID,
      [
        "wss://a.example",
        "wss://b.example",
        "wss://c.example",
        "wss://d.example",
        "wss://e.example",
        "wss://blastr.example",
      ]
    );
    expect(userApi.getConfirmedChildrenForParent).toHaveBeenCalledWith(
      "npub1me"
    );
    expect(userApi.getUsersByNpubs).toHaveBeenCalledWith(["npub1incoming"]);
    expect(blastr.resolvePubkeyHex).toHaveBeenCalledWith("npub1me");
    expect(blastr.getUserPolicy).toHaveBeenCalledWith("aa");
    expect(deployment.relayFanoutForSubscription).toHaveBeenCalledWith({
      subscriptionActive: true,
      planEnablesRelayBlast: true,
    });
    expect(referral.getReferralSettingsData).toHaveBeenCalledWith("npub1me");
  });

  it("loads a linked child and the parent profile without billing rows", async () => {
    const parent = {
      npub: "npub1parent",
      name: "Parent",
      nostrProfile: { name: "Parent" },
    };
    userApi.getUserBasicInfo.mockResolvedValue({
      npub: "npub1child",
      isChild: true,
      parentNpub: "npub1parent",
    });
    userApi.getUserByNpubWithProfile.mockResolvedValue(parent);
    payments.getUserSubscription.mockResolvedValue({
      id: "sub-child",
      planId: "pro",
      status: "ACTIVE",
      startDate: START,
      currentPeriodEnd: PERIOD_END,
      nextPaymentDue: null,
      cancelAtPeriodEnd: false,
      Plan: {
        id: "pro",
        name: "Pro",
        price: 29,
        enableLifetimeAccess: false,
        enableRelayBlast: false,
      },
    });

    const data = await loadSettingsData(USER_ID);

    expect(data.isChild).toBe(true);
    expect(entitlementSync.syncBlastrEntitlementForUser).toHaveBeenCalledWith(
      USER_ID
    );
    expect(data.hasAccountsAccess).toBe(true);
    expect(data.accounts).toEqual({
      isChild: true,
      parentNpub: "npub1parent",
      parentUser: { ...parent, id: "npub1parent" },
      confirmedChildren: [],
      pendingChildren: [],
      pendingIncomingParents: [],
    });
    expect(data.availablePlans).toEqual([]);
    expect(data.paymentHistory).toEqual([]);
    expect(data.referral).toEqual(EMPTY_REFERRAL);
    expect(data.billingContext).toBeNull();
    expect(data.subscription?.id).toBe("sub-child");
    expect(data.subscription?.plan).toEqual({
      id: "pro",
      name: "Pro",
      price: 29,
      enableLifetimeAccess: false,
    });
    expect(data.subscription?.renewalMode).toBeUndefined();
    expect(data.subscription?.lastRenewalAttemptAt).toBeNull();
    expect(payments.getAllPlans).not.toHaveBeenCalled();
    expect(payments.getUserPaymentHistory).not.toHaveBeenCalled();
    expect(referral.getReferralSettingsData).not.toHaveBeenCalled();
    expect(subscriptions.getSubscriptionData).not.toHaveBeenCalled();
    expect(userApi.getConfirmedChildrenForParent).not.toHaveBeenCalled();
    expect(userApi.getUserByNpubWithProfile).toHaveBeenCalledWith(
      "npub1parent"
    );
  });

  it("leaves the parent empty when a child has no parent npub", async () => {
    userApi.getUserBasicInfo.mockResolvedValue({
      npub: "npub1child",
      isChild: true,
      parentNpub: null,
    });

    const data = await loadSettingsData(USER_ID);

    expect(data.accounts).toEqual({
      isChild: true,
      parentNpub: null,
      parentUser: null,
      confirmedChildren: [],
      pendingChildren: [],
      pendingIncomingParents: [],
    });
    expect(userApi.getUserByNpubWithProfile).not.toHaveBeenCalled();
    expect(payments.getAllPlans).not.toHaveBeenCalled();
  });

  it("drops a child parent when the parent account cannot be loaded", async () => {
    userApi.getUserBasicInfo.mockResolvedValue({
      npub: "npub1child",
      isChild: true,
      parentNpub: "npub1missing",
    });
    userApi.getUserByNpubWithProfile.mockResolvedValue(null);

    const data = await loadSettingsData(USER_ID);

    expect(data.accounts.parentNpub).toBeNull();
    expect(data.accounts.parentUser).toBeNull();
    expect(data.accounts.isChild).toBe(true);
    expect(userApi.getUserByNpubWithProfile).toHaveBeenCalledWith(
      "npub1missing"
    );
  });

  it("normalizes partial queues, payments, intervals, and unknown plans", async () => {
    userApi.getUserBasicInfo.mockResolvedValue({
      npub: "npub1edge",
      isChild: false,
      parentNpub: null,
    });
    userApi.getScheduleInterval.mockResolvedValue([
      "8",
      "0.25",
      "8",
      "0",
      "-1",
      "nope",
      " 4 ",
    ]);
    userApi.getUserNWC.mockResolvedValue({ enabled: true });
    userApi.getUserPrimarySignerProfile.mockResolvedValue({ type: "nip46" });
    userApi.getQueueTypes.mockResolvedValue([
      {
        id: "q-fixed",
        name: "Fixed",
        colorToken: "nope",
        description: null,
        scheduleType: "FIXED_SLOTS",
        scheduleConfig: { slots: ["09:00"] },
        isEnabled: false,
        status: "PAUSED",
        isDefault: false,
        userId: USER_ID,
        hashTagPresetId: "hp-1",
        includeHashtagsInNoteBody: false,
        hashTagPreset: {
          id: "hp-1",
          name: "Preset",
          tags: "#a",
          description: null,
        },
      },
      {
        id: "q-week",
        name: "Week",
        colorToken: null,
        description: "Weekly",
        scheduleType: "WEEKLY_SLOTS",
        scheduleConfig: ["mon"],
        isEnabled: null,
        status: "ARCHIVED",
        isDefault: null,
        userId: USER_ID,
        hashTagPresetId: null,
        includeHashtagsInNoteBody: null,
        hashTagPreset: { id: "hp-2", name: "Bad", tags: 1 },
      },
      {
        id: "q-custom",
        name: "Custom",
        colorToken: "blue",
        description: null,
        scheduleType: "CUSTOM",
        scheduleConfig: { interval: 2 },
        isEnabled: true,
        status: "ACTIVE",
        isDefault: true,
        userId: USER_ID,
        hashTagPresetId: "hp-3",
        includeHashtagsInNoteBody: true,
        hashTagPreset: "nope",
      },
    ]);
    payments.getUserSubscription.mockResolvedValue({
      id: "sub-legacy",
      planId: "Legacy",
      status: "PAST_DUE",
      renewalMode: 4,
      billingCadence: false,
      accessDurationMonths: 1.5,
      paymentMethod: "lightning_one_time",
      renewalFailureCount: "2",
      nextRenewalAttemptAt: null,
      gracePeriodEndsAt: GRACE_END,
      startDate: START,
      currentPeriodEnd: null,
      nextPaymentDue: null,
      cancelAtPeriodEnd: true,
      Plan: {
        id: "legacy",
        name: "Legacy",
        price: "5.50",
        enableLifetimeAccess: true,
        enableRelayBlast: true,
      },
    });
    payments.getUserPaymentHistory.mockResolvedValue([
      {
        id: "pay-zero",
        amount: 0,
        amountUsd: 0,
        description: null,
        paidAt: null,
        paymentMethod: null,
        paymentHash: "",
        Subscription: { Plan: { name: "Free", price: 0 } },
      },
      {
        id: "pay-null",
        amount: 5,
        amountUsd: null,
        description: "Top up",
        paidAt: null,
        paymentMethod: "lightning",
        paymentHash: "",
        Subscription: null,
      },
      {
        id: "pay-text",
        amount: 1250,
        amountUsd: "12.50",
        description: "Manual",
        paidAt: PAID_AT,
        paymentMethod: "lightning",
        paymentHash: "hash-edge",
        Subscription: { Plan: { name: "Legacy", price: "5.50" } },
      },
    ]);

    const data = await loadSettingsData(USER_ID);
    const fixed = requireById(data.queueTypes, "q-fixed");
    const weekly = requireById(data.queueTypes, "q-week");
    const custom = requireById(data.queueTypes, "q-custom");

    expect(data.globalScheduleIntervalHours).toEqual([0.25, 4, 8]);
    expect(data.nwcEnabled).toBe(true);
    expect(data.maskedNwcString).toBeNull();
    expect(data.nwcLastUsed).toBeNull();
    expect(data.primarySignerProfile).toBeNull();
    expect(fixed.scheduleType).toBe("FIXED_SLOTS");
    expect(fixed.status).toBe("paused");
    expect(fixed.color).toBe(getQueueAccentHex("nope"));
    expect(fixed.colorToken).toBe("nope");
    expect(fixed.scheduleConfig).toEqual({ slots: ["09:00"] });
    expect(fixed.isEnabled).toBe(false);
    expect(fixed.isDefault).toBe(false);
    expect(fixed.includeHashtagsInNoteBody).toBe(false);
    expect(fixed.hashTagPreset).toEqual({
      id: "hp-1",
      name: "Preset",
      tags: "#a",
      description: undefined,
    });
    expect(weekly.scheduleType).toBe("WEEKLY_SLOTS");
    expect(weekly.status).toBe("archived");
    expect(weekly.color).toBe(getQueueAccentHex(null));
    expect(weekly.colorToken).toBeUndefined();
    expect(weekly.scheduleConfig).toBeUndefined();
    expect(weekly.isEnabled).toBeUndefined();
    expect(weekly.isDefault).toBe(false);
    expect(weekly.hashTagPresetId).toBeUndefined();
    expect(weekly.includeHashtagsInNoteBody).toBe(true);
    expect(weekly.hashTagPreset).toBeNull();
    expect(custom.scheduleType).toBe("INTERVAL");
    expect(custom.status).toBe("active");
    expect(custom.color).toBe(getQueueAccentHex("blue"));
    expect(custom.scheduleConfig).toEqual({ interval: 2 });
    expect(custom.hashTagPreset).toBeNull();
    expect(custom.hashTagPresetId).toBe("hp-3");
    expect(data.subscription).toEqual({
      id: "sub-legacy",
      planId: "Legacy",
      status: "PAST_DUE",
      renewalMode: undefined,
      billingCadence: undefined,
      accessDurationMonths: 1.5,
      billingPaymentMethod: "lightning_one_time",
      renewalFailureCount: undefined,
      lastRenewalAttemptAt: null,
      nextRenewalAttemptAt: null,
      gracePeriodEndsAt: GRACE_END,
      startDate: START,
      currentPeriodEnd: null,
      nextPaymentDue: null,
      cancelAtPeriodEnd: true,
      plan: {
        id: "legacy",
        name: "Legacy",
        price: 5.5,
        enableLifetimeAccess: true,
      },
    });
    expect(data.paymentHistory).toEqual([
      {
        id: "pay-zero",
        amount: 0,
        amountUsd: null,
        description: null,
        paidAt: null,
        paymentMethod: null,
        paymentHash: "",
        planName: "Free",
        planPrice: undefined,
      },
      {
        id: "pay-null",
        amount: 5,
        amountUsd: null,
        description: "Top up",
        paidAt: null,
        paymentMethod: "lightning",
        paymentHash: "",
        planName: undefined,
        planPrice: undefined,
      },
      {
        id: "pay-text",
        amount: 1250,
        amountUsd: 12.5,
        description: "Manual",
        paidAt: PAID_AT,
        paymentMethod: "lightning",
        paymentHash: "hash-edge",
        planName: "Legacy",
        planPrice: 5.5,
      },
    ]);
    expect(logger.logWarning).toHaveBeenCalledWith(
      "Invalid subscription plan in settings loader",
      {
        userId: USER_ID,
        planId: "legacy",
        planName: "Legacy",
      }
    );
    expect(deployment.relayFanoutForSubscription).toHaveBeenCalledWith({
      subscriptionActive: false,
      planEnablesRelayBlast: true,
    });
  });

  it("skips a blastr policy when the pubkey is missing", async () => {
    userApi.getUserBasicInfo.mockResolvedValue({
      npub: "npub1me",
      isChild: false,
      parentNpub: null,
    });
    deployment.relayFanoutForSubscription.mockReturnValue(true);
    blastr.resolvePubkeyHex.mockReturnValue(null);

    const data = await loadSettingsData(USER_ID);

    expect(data.canToggleBlastr).toBe(true);
    expect(data.blastrPolicy).toBeNull();
    expect(blastr.resolvePubkeyHex).toHaveBeenCalledWith("npub1me");
    expect(blastr.getUserPolicy).not.toHaveBeenCalled();
  });

  it("skips a blastr policy when the admin client returns nothing", async () => {
    userApi.getUserBasicInfo.mockResolvedValue({
      npub: "npub1me",
      isChild: false,
      parentNpub: null,
    });
    deployment.relayFanoutForSubscription.mockReturnValue(true);
    blastr.resolvePubkeyHex.mockReturnValue("cc");
    blastr.getUserPolicy.mockResolvedValue(null);

    const data = await loadSettingsData(USER_ID);

    expect(data.blastrPolicy).toBeNull();
    expect(blastr.getUserPolicy).toHaveBeenCalledWith("cc");
  });

  it("skips a blastr lookup when the account has no npub", async () => {
    userApi.getUserBasicInfo.mockResolvedValue({
      npub: "",
      isChild: false,
      parentNpub: null,
    });
    deployment.relayFanoutForSubscription.mockReturnValue(true);

    const data = await loadSettingsData(USER_ID);

    expect(data.canToggleBlastr).toBe(true);
    expect(data.blastrPolicy).toBeNull();
    expect(blastr.resolvePubkeyHex).not.toHaveBeenCalled();
  });

  it("rejects when a settings dependency throws", async () => {
    userApi.getUserTimezone.mockRejectedValue(new Error("timezone down"));

    await expect(loadSettingsData(USER_ID)).rejects.toThrow("timezone down");
  });
});
