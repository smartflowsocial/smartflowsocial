import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface UpdateArgs {
  where: { id: string };
  data: Record<string, unknown>;
}
interface FindArgs {
  where: { id: string };
  select: Record<string, boolean>;
}

const db = vi.hoisted(() => ({
  update: vi.fn(async (args: UpdateArgs) => ({ id: args.where.id })),
  findUnique: vi.fn(async (args: FindArgs) => ({ id: args.where.id })),
}));

vi.mock("~/lib/prisma.server", () => ({
  prisma: { user: { update: db.update, findUnique: db.findUnique } },
}));

import {
  applyLocaleDefaultsOnceRow,
  clearUserPrimarySignerProfileRow,
  findEngagementLastCheckedAtRow,
  findGiveawayBlacklistRow,
  findLocaleDefaultsAppliedAtRow,
  findScheduleIntervalRow,
  findUserBlastrRelayEnabledRow,
  findUserByIdRow,
  findUserCustomBlossomUrlRow,
  findUserCustomNostrClientBaseUrlRow,
  findUserDateFormatRow,
  findUserDefaultZapAmountSatsRow,
  findUserEnableMirrorBlossomRow,
  findUserFilterMutedRow,
  findUserForRunwayFallbackRow,
  findUserHidePostsFromLowTrustUsersRow,
  findUserMirrorUploadUrlsRow,
  findUserMutedListRow,
  findUserPreferredNostrClientRow,
  findUserPrimarySignerProfileRow,
  findUserPushNotificationPreferencesRow,
  findUserRelaysRow,
  findUserRunwaySettingsRow,
  findUserThemePreferenceRow,
  findUserTimeFormatRow,
  findUserTimezoneRow,
  findUserUploadProviderSettingsRow,
  updateEngagementLastCheckedAtRow,
  updateGiveawayBlacklistRow,
  updateRunwaySettingsRow,
  updateScheduleIntervalRow,
  updateUserBlastrRelayEnabledRow,
  updateUserCustomBlossomUrlRow,
  updateUserDateFormatRow,
  updateUserDefaultZapAmountSatsRow,
  updateUserEnableMirrorBlossomRow,
  updateUserFilterMutedRow,
  updateUserHidePostsFromLowTrustUsersRow,
  updateUserMirrorUploadUrlsRow,
  updateUserMutedListRow,
  updateUserPreferredNostrClientRow,
  updateUserPrimarySignerProfileRow,
  updateUserPushNotificationPreferencesRow,
  updateUserRelayPublishingPreferencesRow,
  updateUserRelaysRow,
  updateUserThemePreferenceRow,
  updateUserTimeFormatRow,
  updateUserTimezoneRow,
  updateUserUploadProviderRow,
  updateUserUploadProviderSettingsRow,
} from "~/features/user/repositories/user-settings-data.server";

function lastUpdate(): UpdateArgs {
  const call = db.update.mock.calls.at(-1);
  if (!call) throw new Error("expected an update");
  return call[0];
}

describe("user settings rows", () => {
  beforeEach(() => {
    db.update.mockClear();
    db.findUnique.mockClear();
  });

  it("reads and writes each settings column", async () => {
    await updateUserTimezoneRow("user-1", "Europe/Berlin");
    expect(lastUpdate().data).toEqual({ timezone: "Europe/Berlin" });
    await findUserTimezoneRow("user-1");

    await updateUserRelaysRow("user-1", ["wss://relay.example"]);
    expect(lastUpdate().data).toEqual({ userRelays: ["wss://relay.example"] });
    await updateUserRelayPublishingPreferencesRow("user-1", {
      userRelays: ["wss://relay.example"],
      publishRelaySource: "account",
    });
    await findUserRelaysRow("user-1");

    await updateGiveawayBlacklistRow("user-1", ["npub1"]);
    await findGiveawayBlacklistRow("user-1");
    await updateScheduleIntervalRow("user-1", ["09:00"]);
    await findScheduleIntervalRow("user-1");

    await updateUserUploadProviderRow("user-1", "S3");
    await findUserCustomBlossomUrlRow("user-1");
    await updateUserCustomBlossomUrlRow("user-1", "https://blossom.example");
    await findUserUploadProviderSettingsRow("user-1");

    await findUserEnableMirrorBlossomRow("user-1");
    await updateUserEnableMirrorBlossomRow("user-1", true);
    await findUserThemePreferenceRow("user-1");
    await updateUserThemePreferenceRow("user-1", "dark");
    await findUserBlastrRelayEnabledRow("user-1");
    await updateUserBlastrRelayEnabledRow("user-1", false);
    await findUserMirrorUploadUrlsRow("user-1");
    await updateUserMirrorUploadUrlsRow("user-1", ["https://mirror.example"]);

    await updateUserMutedListRow("user-1", ["npub1"]);
    await findUserMutedListRow("user-1");
    await findUserPushNotificationPreferencesRow("user-1");
    await updateUserFilterMutedRow("user-1", true);
    await findUserFilterMutedRow("user-1");
    await updateUserHidePostsFromLowTrustUsersRow("user-1", false);
    await findUserHidePostsFromLowTrustUsersRow("user-1");

    await findUserTimeFormatRow("user-1");
    await updateUserTimeFormatRow("user-1", "24h");
    await findUserDefaultZapAmountSatsRow("user-1");
    await updateUserDefaultZapAmountSatsRow("user-1", 21);
    await findUserDateFormatRow("user-1");
    await updateUserDateFormatRow("user-1", "YYYY-MM-DD");
    await findUserPreferredNostrClientRow("user-1");
    await findUserCustomNostrClientBaseUrlRow("user-1");
    await updateUserPreferredNostrClientRow("user-1", {
      preferredNostrClient: "custom",
      customNostrClientBaseUrl: "https://client.example",
    });

    await findEngagementLastCheckedAtRow("user-1");
    await updateEngagementLastCheckedAtRow("user-1");
    expect(lastUpdate().data.engagementLastCheckedAt).toBeInstanceOf(Date);
    await findLocaleDefaultsAppliedAtRow("user-1");
    await applyLocaleDefaultsOnceRow("user-1", "12h", "DD/MM/YYYY");
    expect(lastUpdate().data).toMatchObject({
      timeFormat: "12h",
      dateFormat: "DD/MM/YYYY",
    });

    await findUserRunwaySettingsRow("user-1");
    await updateRunwaySettingsRow("user-1", {
      queueNames: ["main"],
      mode: "balanced",
      redThresholdDays: 2,
      orangeThresholdDays: 5,
      targetPostsPerDay: 3,
    });
    await findUserForRunwayFallbackRow("user-1");
    await findUserByIdRow("user-1");
    await findUserPrimarySignerProfileRow("user-1");
    await updateUserPrimarySignerProfileRow("user-1", { kind: "nip07" });

    const selects = db.findUnique.mock.calls.map((call) => call[0].select);
    expect(selects.some((select) => select.timezone === true)).toBe(true);
    expect(selects.some((select) => select.runwaySettings === true)).toBe(true);
    expect(
      db.update.mock.calls.every((call) => call[0].where.id === "user-1")
    ).toBe(true);
  });

  it("keeps a blossom url only for the custom provider", async () => {
    await updateUserUploadProviderSettingsRow(
      "user-1",
      "BLOSSOM_CUSTOM",
      "https://blossom.example"
    );
    expect(lastUpdate().data.customBlossomUrl).toBe("https://blossom.example");

    await updateUserUploadProviderSettingsRow(
      "user-1",
      "S3",
      "https://blossom.example"
    );
    expect(lastUpdate().data.customBlossomUrl).toBeNull();
  });

  it("writes only the push preferences that were set", async () => {
    await updateUserPushNotificationPreferencesRow("user-1", {});
    expect(lastUpdate().data).toEqual({});

    await updateUserPushNotificationPreferencesRow("user-1", {
      pushNotificationsEnabled: false,
      pushNotifyPublishSuccess: true,
      pushNotifyPublishFailure: false,
      pushNotifyRunwayLow: true,
      pushNotifyIncludePreview: false,
      runwayNotifyBelowDays: null,
    });
    expect(lastUpdate().data).toEqual({
      pushNotificationsEnabled: false,
      pushNotifyPublishSuccess: true,
      pushNotifyPublishFailure: false,
      pushNotifyRunwayLow: true,
      pushNotifyIncludePreview: false,
      runwayNotifyBelowDays: null,
    });
  });

  it("clears the primary signer profile", async () => {
    await clearUserPrimarySignerProfileRow("user-1");
    expect(lastUpdate().data.primarySignerProfile).toBe(Prisma.JsonNull);
  });
});
