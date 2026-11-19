import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

const rows = vi.hoisted(() => ({
  applyLocaleDefaultsOnceRow: vi.fn(),
  clearUserPrimarySignerProfileRow: vi.fn(),
  findEngagementLastCheckedAtRow: vi.fn(),
  findLocaleDefaultsAppliedAtRow: vi.fn(),
  findUserByIdRow: vi.fn(),
  findUserCustomNostrClientBaseUrlRow: vi.fn(),
  findUserDateFormatRow: vi.fn(),
  findUserDefaultZapAmountSatsRow: vi.fn(),
  findUserFilterMutedRow: vi.fn(),
  findUserForRunwayFallbackRow: vi.fn(),
  findUserHidePostsFromLowTrustUsersRow: vi.fn(),
  findUserMutedListRow: vi.fn(),
  findUserPreferredNostrClientRow: vi.fn(),
  findUserPrimarySignerProfileRow: vi.fn(),
  findUserPushNotificationPreferencesRow: vi.fn(),
  findUserRunwaySettingsRow: vi.fn(),
  findUserThemePreferenceRow: vi.fn(),
  findUserTimeFormatRow: vi.fn(),
  updateEngagementLastCheckedAtRow: vi.fn(),
  updateRunwaySettingsRow: vi.fn(),
  updateUserDateFormatRow: vi.fn(),
  updateUserDefaultZapAmountSatsRow: vi.fn(),
  updateUserFilterMutedRow: vi.fn(),
  updateUserHidePostsFromLowTrustUsersRow: vi.fn(),
  updateUserMutedListRow: vi.fn(),
  updateUserPreferredNostrClientRow: vi.fn(),
  updateUserPrimarySignerProfileRow: vi.fn(),
  updateUserPushNotificationPreferencesRow: vi.fn(),
  updateUserThemePreferenceRow: vi.fn(),
  updateUserTimeFormatRow: vi.fn(),
}));

const notifications = vi.hoisted(() => ({
  getUserIdWithRunwayLowNotificationEnabled: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));
vi.mock("~/features/user/repositories/user-settings-data.server", () => rows);
vi.mock(
  "~/features/user/services/user-notifications.server",
  () => notifications
);
interface PrimarySignerModule {
  isPrimarySignerProfile: (value: unknown) => boolean;
}

vi.mock("~/features/auth/signer", async () => {
  const profile = await vi.importActual<PrimarySignerModule>(
    "~/features/auth/signer/primary-signer-profile"
  );
  return { isPrimarySignerProfile: profile.isPrimarySignerProfile };
});

import {
  applyLocaleDefaultsOnce,
  clearUserPrimarySignerProfile,
  DEFAULT_ZAP_AMOUNT_SATS_FALLBACK,
  getEngagementLastCheckedAt,
  getLocaleDefaultsAppliedAt,
  getRunwaySettings,
  getUserCustomNostrClientBaseUrl,
  getUserDateFormat,
  getUserDefaultZapAmountSats,
  getUserDefaultZapAmountSatsStored,
  getUserFilterMuted,
  getUserHidePostsFromLowTrustUsers,
  getUserIdWithRunwayLowNotificationEnabled,
  getUserMutedList,
  getUserPreferredNostrClient,
  getUserPrimarySignerProfile,
  getUserPushNotificationPreferences,
  getUserThemePreference,
  getUserTimeFormat,
  PREFERRED_NOSTR_CLIENT_PRESETS,
  updateEngagementLastCheckedAt,
  updateRunwaySettings,
  updateScheduleOverviewTarget,
  updateUserDateFormat,
  updateUserDefaultZapAmountSats,
  updateUserFilterMuted,
  updateUserHidePostsFromLowTrustUsers,
  updateUserMutedList,
  updateUserPreferredNostrClient,
  updateUserPrimarySignerProfile,
  updateUserPushNotificationPreferences,
  updateUserThemePreference,
  updateUserTimeFormat,
} from "~/features/user/services/user-settings-preferences.server";

const USER_ID = "user-1";
const savedUser = { id: USER_ID, npub: "npub1saved" };
const bunkerProfile = {
  type: "nip46",
  method: "bunker_input",
  bunkerInput: "bunker://alice",
  label: "Phone",
  expectedPubkey: null,
  updatedAt: "2026-01-02T00:00:00.000Z",
} as const;
const DEFAULT_RUNWAY = {
  queueNames: [],
  mode: "last-post",
  redThresholdDays: 3,
  orangeThresholdDays: 7,
  targetPostsPerDay: 0,
};
const PUSH_DEFAULTS = {
  pushNotificationsEnabled: true,
  pushNotifyPublishSuccess: true,
  pushNotifyPublishFailure: true,
  pushNotifyRunwayLow: false,
  pushNotifyIncludePreview: true,
  runwayNotifyBelowDays: null,
};

describe("user settings preferences", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reads a muted list and drops malformed stored values", async () => {
    rows.findUserMutedListRow.mockResolvedValueOnce(null);
    await expect(getUserMutedList(USER_ID)).resolves.toBeNull();

    rows.findUserMutedListRow.mockResolvedValueOnce({ mutedList: null });
    await expect(getUserMutedList(USER_ID)).resolves.toBeNull();

    rows.findUserMutedListRow.mockResolvedValueOnce({ mutedList: "legacy" });
    await expect(getUserMutedList(USER_ID)).resolves.toBeNull();

    rows.findUserMutedListRow.mockResolvedValueOnce({ mutedList: 0 });
    await expect(getUserMutedList(USER_ID)).resolves.toBeNull();

    rows.findUserMutedListRow.mockResolvedValueOnce({ mutedList: [] });
    const fromArray = await getUserMutedList(USER_ID);
    expect(fromArray?.npubs).toEqual([]);
    expect(fromArray?.lastSynced).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    rows.findUserMutedListRow.mockResolvedValueOnce({
      mutedList: { npubs: "npub1", lastSynced: 5 },
    });
    const fromBadFields = await getUserMutedList(USER_ID);
    expect(fromBadFields?.npubs).toEqual([]);
    expect(fromBadFields?.lastSynced).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    rows.findUserMutedListRow.mockResolvedValueOnce({
      mutedList: {
        npubs: ["npub1muted"],
        lastSynced: "2024-01-01T00:00:00.000Z",
      },
    });
    await expect(getUserMutedList(USER_ID)).resolves.toEqual({
      npubs: ["npub1muted"],
      lastSynced: "2024-01-01T00:00:00.000Z",
    });
  });

  it("updates the muted list and surfaces a repository failure", async () => {
    const mutedList = {
      npubs: ["npub1muted"],
      lastSynced: "2024-01-01T00:00:00.000Z",
    };
    rows.updateUserMutedListRow.mockResolvedValue(savedUser);
    await expect(updateUserMutedList(USER_ID, mutedList)).resolves.toBe(
      savedUser
    );
    expect(rows.updateUserMutedListRow).toHaveBeenCalledWith(
      USER_ID,
      mutedList
    );

    rows.updateUserMutedListRow.mockRejectedValue(new Error("muted down"));
    await expect(updateUserMutedList(USER_ID, mutedList)).rejects.toThrow(
      "muted down"
    );
  });

  it("lists runway-low recipients and rethrows notification lookup failures", async () => {
    notifications.getUserIdWithRunwayLowNotificationEnabled.mockResolvedValue([
      USER_ID,
      "user-2",
    ]);
    await expect(getUserIdWithRunwayLowNotificationEnabled()).resolves.toEqual([
      USER_ID,
      "user-2",
    ]);

    notifications.getUserIdWithRunwayLowNotificationEnabled.mockRejectedValue(
      new Error("notify down")
    );
    await expect(getUserIdWithRunwayLowNotificationEnabled()).rejects.toThrow(
      "notify down"
    );
  });

  it("reads push preferences with stored values and defaults", async () => {
    rows.findUserPushNotificationPreferencesRow.mockResolvedValueOnce(null);
    await expect(getUserPushNotificationPreferences(USER_ID)).resolves.toEqual(
      PUSH_DEFAULTS
    );

    rows.findUserPushNotificationPreferencesRow.mockResolvedValueOnce({
      pushNotificationsEnabled: null,
      pushNotifyPublishSuccess: null,
      pushNotifyPublishFailure: null,
      pushNotifyRunwayLow: null,
      pushNotifyIncludePreview: null,
      runwayNotifyBelowDays: null,
    });
    await expect(getUserPushNotificationPreferences(USER_ID)).resolves.toEqual(
      PUSH_DEFAULTS
    );

    rows.findUserPushNotificationPreferencesRow.mockResolvedValueOnce({
      pushNotificationsEnabled: false,
      pushNotifyPublishSuccess: false,
      pushNotifyPublishFailure: false,
      pushNotifyRunwayLow: true,
      pushNotifyIncludePreview: false,
      runwayNotifyBelowDays: 4,
    });
    await expect(getUserPushNotificationPreferences(USER_ID)).resolves.toEqual({
      pushNotificationsEnabled: false,
      pushNotifyPublishSuccess: false,
      pushNotifyPublishFailure: false,
      pushNotifyRunwayLow: true,
      pushNotifyIncludePreview: false,
      runwayNotifyBelowDays: 4,
    });
  });

  it("updates push preferences and surfaces a repository failure", async () => {
    const preferences = {
      pushNotificationsEnabled: false,
      runwayNotifyBelowDays: null,
    };
    rows.updateUserPushNotificationPreferencesRow.mockResolvedValue(savedUser);
    await expect(
      updateUserPushNotificationPreferences(USER_ID, preferences)
    ).resolves.toBe(savedUser);
    expect(rows.updateUserPushNotificationPreferencesRow).toHaveBeenCalledWith(
      USER_ID,
      preferences
    );

    rows.updateUserPushNotificationPreferencesRow.mockRejectedValue(
      new Error("push down")
    );
    await expect(
      updateUserPushNotificationPreferences(USER_ID, preferences)
    ).rejects.toThrow("push down");
  });

  it("reads and updates mute filtering and low-trust hiding", async () => {
    rows.findUserFilterMutedRow.mockResolvedValueOnce(null);
    await expect(getUserFilterMuted(USER_ID)).resolves.toBe(false);
    rows.findUserFilterMutedRow.mockResolvedValueOnce({ filterMuted: null });
    await expect(getUserFilterMuted(USER_ID)).resolves.toBe(false);
    rows.findUserFilterMutedRow.mockResolvedValueOnce({ filterMuted: true });
    await expect(getUserFilterMuted(USER_ID)).resolves.toBe(true);
    rows.findUserFilterMutedRow.mockRejectedValue(new Error("filter down"));
    await expect(getUserFilterMuted(USER_ID)).rejects.toThrow("filter down");

    rows.updateUserFilterMutedRow.mockResolvedValue(savedUser);
    await expect(updateUserFilterMuted(USER_ID, true)).resolves.toBe(savedUser);
    expect(rows.updateUserFilterMutedRow).toHaveBeenCalledWith(USER_ID, true);
    rows.updateUserFilterMutedRow.mockRejectedValue(new Error("filter write"));
    await expect(updateUserFilterMuted(USER_ID, false)).rejects.toThrow(
      "filter write"
    );

    rows.findUserHidePostsFromLowTrustUsersRow.mockResolvedValueOnce(null);
    await expect(getUserHidePostsFromLowTrustUsers(USER_ID)).resolves.toBe(
      false
    );
    rows.findUserHidePostsFromLowTrustUsersRow.mockResolvedValueOnce({
      hidePostsFromLowTrustUsers: null,
    });
    await expect(getUserHidePostsFromLowTrustUsers(USER_ID)).resolves.toBe(
      false
    );
    rows.findUserHidePostsFromLowTrustUsersRow.mockResolvedValueOnce({
      hidePostsFromLowTrustUsers: true,
    });
    await expect(getUserHidePostsFromLowTrustUsers(USER_ID)).resolves.toBe(
      true
    );
    rows.findUserHidePostsFromLowTrustUsersRow.mockRejectedValue(
      new Error("trust down")
    );
    await expect(getUserHidePostsFromLowTrustUsers(USER_ID)).rejects.toThrow(
      "trust down"
    );

    rows.updateUserHidePostsFromLowTrustUsersRow.mockResolvedValue(savedUser);
    await expect(
      updateUserHidePostsFromLowTrustUsers(USER_ID, false)
    ).resolves.toBe(savedUser);
    expect(rows.updateUserHidePostsFromLowTrustUsersRow).toHaveBeenCalledWith(
      USER_ID,
      false
    );
    rows.updateUserHidePostsFromLowTrustUsersRow.mockRejectedValue(
      new Error("trust write")
    );
    await expect(
      updateUserHidePostsFromLowTrustUsers(USER_ID, true)
    ).rejects.toThrow("trust write");
  });

  it("returns a known theme, ignores invalid or unmigrated reads, and rethrows", async () => {
    rows.findUserThemePreferenceRow.mockResolvedValueOnce({
      themePreference: "dark",
    });
    await expect(getUserThemePreference(USER_ID)).resolves.toBe("dark");
    rows.findUserThemePreferenceRow.mockResolvedValueOnce({
      themePreference: "light",
    });
    await expect(getUserThemePreference(USER_ID)).resolves.toBe("light");
    rows.findUserThemePreferenceRow.mockResolvedValueOnce({
      themePreference: "system",
    });
    await expect(getUserThemePreference(USER_ID)).resolves.toBe("system");
    rows.findUserThemePreferenceRow.mockResolvedValueOnce({
      themePreference: "sepia",
    });
    await expect(getUserThemePreference(USER_ID)).resolves.toBeNull();
    rows.findUserThemePreferenceRow.mockResolvedValueOnce(null);
    await expect(getUserThemePreference(USER_ID)).resolves.toBeNull();

    rows.findUserThemePreferenceRow.mockRejectedValueOnce({ code: "P2022" });
    await expect(getUserThemePreference(USER_ID)).resolves.toBeNull();
    rows.findUserThemePreferenceRow.mockRejectedValueOnce(
      new Error("column themePreference does not exist")
    );
    await expect(getUserThemePreference(USER_ID)).resolves.toBeNull();
    rows.findUserThemePreferenceRow.mockRejectedValueOnce(new Error("timeout"));
    await expect(getUserThemePreference(USER_ID)).rejects.toThrow("timeout");
    rows.findUserThemePreferenceRow.mockRejectedValueOnce("down");
    await expect(getUserThemePreference(USER_ID)).rejects.toBe("down");
  });

  it("saves a theme, keeps the user when the column is missing, and rethrows", async () => {
    rows.updateUserThemePreferenceRow.mockResolvedValueOnce(savedUser);
    await expect(updateUserThemePreference(USER_ID, "dark")).resolves.toBe(
      savedUser
    );
    expect(rows.updateUserThemePreferenceRow).toHaveBeenCalledWith(
      USER_ID,
      "dark"
    );

    const missingCode = { code: "P2022" };
    rows.updateUserThemePreferenceRow.mockRejectedValueOnce(missingCode);
    rows.findUserByIdRow.mockResolvedValueOnce(savedUser);
    await expect(updateUserThemePreference(USER_ID, "light")).resolves.toBe(
      savedUser
    );

    rows.updateUserThemePreferenceRow.mockRejectedValueOnce(missingCode);
    rows.findUserByIdRow.mockResolvedValueOnce(null);
    await expect(updateUserThemePreference(USER_ID, "system")).rejects.toBe(
      missingCode
    );

    const missingColumn = new Error("themePreference does not exist");
    rows.updateUserThemePreferenceRow.mockRejectedValueOnce(missingColumn);
    rows.findUserByIdRow.mockResolvedValueOnce(savedUser);
    await expect(updateUserThemePreference(USER_ID, "dark")).resolves.toBe(
      savedUser
    );

    rows.updateUserThemePreferenceRow.mockRejectedValueOnce(missingCode);
    rows.findUserByIdRow.mockRejectedValueOnce(new Error("lookup failed"));
    await expect(updateUserThemePreference(USER_ID, "dark")).rejects.toThrow(
      "lookup failed"
    );

    const timeout = new Error("timeout");
    rows.updateUserThemePreferenceRow.mockRejectedValueOnce(timeout);
    await expect(updateUserThemePreference(USER_ID, "dark")).rejects.toBe(
      timeout
    );
  });

  it("reads and updates the time format", async () => {
    rows.findUserTimeFormatRow.mockResolvedValueOnce(null);
    await expect(getUserTimeFormat(USER_ID)).resolves.toBe("24h");
    rows.findUserTimeFormatRow.mockResolvedValueOnce({ timeFormat: "12h" });
    await expect(getUserTimeFormat(USER_ID)).resolves.toBe("12h");
    rows.findUserTimeFormatRow.mockResolvedValueOnce({ timeFormat: "24h" });
    await expect(getUserTimeFormat(USER_ID)).resolves.toBe("24h");
    rows.findUserTimeFormatRow.mockResolvedValueOnce({ timeFormat: " 12h " });
    await expect(getUserTimeFormat(USER_ID)).resolves.toBe("24h");
    rows.findUserTimeFormatRow.mockRejectedValueOnce(new Error("time down"));
    await expect(getUserTimeFormat(USER_ID)).rejects.toThrow("time down");

    rows.updateUserTimeFormatRow.mockResolvedValue(savedUser);
    await expect(updateUserTimeFormat(USER_ID, "12h")).resolves.toBe(savedUser);
    expect(rows.updateUserTimeFormatRow).toHaveBeenCalledWith(USER_ID, "12h");
    rows.updateUserTimeFormatRow.mockRejectedValue(new Error("time write"));
    await expect(updateUserTimeFormat(USER_ID, "24h")).rejects.toThrow(
      "time write"
    );
  });

  it("reads a stored zap amount and falls back when it is missing or invalid", async () => {
    expect(DEFAULT_ZAP_AMOUNT_SATS_FALLBACK).toBe(21);

    rows.findUserDefaultZapAmountSatsRow.mockResolvedValueOnce({
      defaultZapAmountSats: 2,
    });
    await expect(getUserDefaultZapAmountSatsStored(USER_ID)).resolves.toBe(2);
    rows.findUserDefaultZapAmountSatsRow.mockResolvedValueOnce({
      defaultZapAmountSats: 1,
    });
    await expect(getUserDefaultZapAmountSatsStored(USER_ID)).resolves.toBe(1);

    for (const invalid of [0, -4, 2.5, "3", null, undefined]) {
      rows.findUserDefaultZapAmountSatsRow.mockResolvedValueOnce({
        defaultZapAmountSats: invalid,
      });
      await expect(getUserDefaultZapAmountSatsStored(USER_ID)).resolves.toBe(
        null
      );
    }
    rows.findUserDefaultZapAmountSatsRow.mockResolvedValueOnce(null);
    await expect(getUserDefaultZapAmountSatsStored(USER_ID)).resolves.toBe(
      null
    );

    rows.findUserDefaultZapAmountSatsRow.mockResolvedValueOnce({
      defaultZapAmountSats: 2,
    });
    await expect(getUserDefaultZapAmountSats(USER_ID)).resolves.toBe(2);
    rows.findUserDefaultZapAmountSatsRow.mockResolvedValueOnce(null);
    await expect(getUserDefaultZapAmountSats(USER_ID)).resolves.toBe(21);

    rows.findUserDefaultZapAmountSatsRow.mockRejectedValue(
      new Error("zap down")
    );
    await expect(getUserDefaultZapAmountSatsStored(USER_ID)).rejects.toThrow(
      "zap down"
    );
    await expect(getUserDefaultZapAmountSats(USER_ID)).rejects.toThrow(
      "zap down"
    );
  });

  it("updates the zap amount and surfaces a repository failure", async () => {
    rows.updateUserDefaultZapAmountSatsRow.mockResolvedValue(savedUser);
    await expect(updateUserDefaultZapAmountSats(USER_ID, 21)).resolves.toBe(
      savedUser
    );
    expect(rows.updateUserDefaultZapAmountSatsRow).toHaveBeenCalledWith(
      USER_ID,
      21
    );
    rows.updateUserDefaultZapAmountSatsRow.mockRejectedValue(
      new Error("zap write")
    );
    await expect(updateUserDefaultZapAmountSats(USER_ID, 21)).rejects.toThrow(
      "zap write"
    );
  });

  it("reads a signer profile, ignores invalid rows, and handles a missing column", async () => {
    rows.findUserPrimarySignerProfileRow.mockResolvedValueOnce({
      primarySignerProfile: bunkerProfile,
    });
    await expect(getUserPrimarySignerProfile(USER_ID)).resolves.toBe(
      bunkerProfile
    );

    rows.findUserPrimarySignerProfileRow.mockResolvedValueOnce(null);
    await expect(getUserPrimarySignerProfile(USER_ID)).resolves.toBeNull();
    rows.findUserPrimarySignerProfileRow.mockResolvedValueOnce({
      primarySignerProfile: { type: "extension" },
    });
    await expect(getUserPrimarySignerProfile(USER_ID)).resolves.toBeNull();
    rows.findUserPrimarySignerProfileRow.mockResolvedValueOnce({
      primarySignerProfile: [],
    });
    await expect(getUserPrimarySignerProfile(USER_ID)).resolves.toBeNull();
    rows.findUserPrimarySignerProfileRow.mockResolvedValueOnce({
      primarySignerProfile: {
        type: "nip46",
        method: "bunker_input",
        bunkerInput: "",
        label: null,
        expectedPubkey: null,
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    });
    await expect(getUserPrimarySignerProfile(USER_ID)).resolves.toBeNull();

    rows.findUserPrimarySignerProfileRow.mockRejectedValueOnce({
      code: "P2022",
    });
    await expect(getUserPrimarySignerProfile(USER_ID)).resolves.toBeNull();
    rows.findUserPrimarySignerProfileRow.mockRejectedValueOnce(
      new Error("primarySignerProfile does not exist")
    );
    await expect(getUserPrimarySignerProfile(USER_ID)).resolves.toBeNull();
    rows.findUserPrimarySignerProfileRow.mockRejectedValueOnce(
      new Error("timeout")
    );
    await expect(getUserPrimarySignerProfile(USER_ID)).rejects.toThrow(
      "timeout"
    );
  });

  it("saves and clears a signer profile, including a missing column", async () => {
    rows.updateUserPrimarySignerProfileRow.mockResolvedValueOnce(savedUser);
    await expect(
      updateUserPrimarySignerProfile(USER_ID, bunkerProfile)
    ).resolves.toBe(savedUser);
    expect(rows.updateUserPrimarySignerProfileRow).toHaveBeenCalledWith(
      USER_ID,
      bunkerProfile
    );

    const missingCode = { code: "P2022" };
    rows.updateUserPrimarySignerProfileRow.mockRejectedValueOnce(missingCode);
    rows.findUserByIdRow.mockResolvedValueOnce(savedUser);
    await expect(
      updateUserPrimarySignerProfile(USER_ID, bunkerProfile)
    ).resolves.toBe(savedUser);

    rows.updateUserPrimarySignerProfileRow.mockRejectedValueOnce(missingCode);
    rows.findUserByIdRow.mockResolvedValueOnce(null);
    await expect(
      updateUserPrimarySignerProfile(USER_ID, bunkerProfile)
    ).rejects.toBe(missingCode);

    const missingColumn = new Error("primarySignerProfile does not exist");
    rows.updateUserPrimarySignerProfileRow.mockRejectedValueOnce(missingColumn);
    rows.findUserByIdRow.mockResolvedValueOnce(savedUser);
    await expect(
      updateUserPrimarySignerProfile(USER_ID, bunkerProfile)
    ).resolves.toBe(savedUser);

    rows.updateUserPrimarySignerProfileRow.mockRejectedValueOnce(missingCode);
    rows.findUserByIdRow.mockRejectedValueOnce(new Error("lookup failed"));
    await expect(
      updateUserPrimarySignerProfile(USER_ID, bunkerProfile)
    ).rejects.toThrow("lookup failed");

    const timeout = new Error("timeout");
    rows.updateUserPrimarySignerProfileRow.mockRejectedValueOnce(timeout);
    await expect(
      updateUserPrimarySignerProfile(USER_ID, bunkerProfile)
    ).rejects.toBe(timeout);

    rows.clearUserPrimarySignerProfileRow.mockResolvedValueOnce(savedUser);
    await expect(clearUserPrimarySignerProfile(USER_ID)).resolves.toBe(
      savedUser
    );
    expect(rows.clearUserPrimarySignerProfileRow).toHaveBeenCalledWith(USER_ID);

    rows.clearUserPrimarySignerProfileRow.mockRejectedValueOnce(missingCode);
    rows.findUserByIdRow.mockResolvedValueOnce(savedUser);
    await expect(clearUserPrimarySignerProfile(USER_ID)).resolves.toBe(
      savedUser
    );

    rows.clearUserPrimarySignerProfileRow.mockRejectedValueOnce(missingCode);
    rows.findUserByIdRow.mockResolvedValueOnce(null);
    await expect(clearUserPrimarySignerProfile(USER_ID)).rejects.toBe(
      missingCode
    );

    rows.clearUserPrimarySignerProfileRow.mockRejectedValueOnce(missingColumn);
    rows.findUserByIdRow.mockResolvedValueOnce(savedUser);
    await expect(clearUserPrimarySignerProfile(USER_ID)).resolves.toBe(
      savedUser
    );

    rows.clearUserPrimarySignerProfileRow.mockRejectedValueOnce(missingCode);
    rows.findUserByIdRow.mockRejectedValueOnce(new Error("lookup failed"));
    await expect(clearUserPrimarySignerProfile(USER_ID)).rejects.toThrow(
      "lookup failed"
    );

    rows.clearUserPrimarySignerProfileRow.mockRejectedValueOnce(timeout);
    await expect(clearUserPrimarySignerProfile(USER_ID)).rejects.toBe(timeout);
  });

  it("reads and updates the date format", async () => {
    rows.findUserDateFormatRow.mockResolvedValueOnce(null);
    await expect(getUserDateFormat(USER_ID)).resolves.toBe("ddmmyyyy");
    rows.findUserDateFormatRow.mockResolvedValueOnce({
      dateFormat: "ddmmyyyy",
    });
    await expect(getUserDateFormat(USER_ID)).resolves.toBe("ddmmyyyy");
    rows.findUserDateFormatRow.mockResolvedValueOnce({
      dateFormat: "mmddyyyy",
    });
    await expect(getUserDateFormat(USER_ID)).resolves.toBe("mmddyyyy");
    rows.findUserDateFormatRow.mockResolvedValueOnce({
      dateFormat: "yyyymmdd",
    });
    await expect(getUserDateFormat(USER_ID)).resolves.toBe("yyyymmdd");
    rows.findUserDateFormatRow.mockResolvedValueOnce({ dateFormat: "MDY" });
    await expect(getUserDateFormat(USER_ID)).resolves.toBe("ddmmyyyy");
    rows.findUserDateFormatRow.mockRejectedValueOnce(new Error("date down"));
    await expect(getUserDateFormat(USER_ID)).rejects.toThrow("date down");

    rows.updateUserDateFormatRow.mockResolvedValue(savedUser);
    await expect(updateUserDateFormat(USER_ID, "yyyymmdd")).resolves.toBe(
      savedUser
    );
    expect(rows.updateUserDateFormatRow).toHaveBeenCalledWith(
      USER_ID,
      "yyyymmdd"
    );
    rows.updateUserDateFormatRow.mockRejectedValue(new Error("date write"));
    await expect(updateUserDateFormat(USER_ID, "mmddyyyy")).rejects.toThrow(
      "date write"
    );
  });

  it("reads a preferred Nostr client and a trimmed custom base URL", async () => {
    expect([...PREFERRED_NOSTR_CLIENT_PRESETS]).toEqual([
      "PRIMAL",
      "DAMUS",
      "AMETHYST",
      "NOSTUR",
      "NOSTRUDEL",
      "IRIS",
      "YAKIHONNE",
      "JUMBLE",
      "CUSTOM",
    ]);

    for (const preset of PREFERRED_NOSTR_CLIENT_PRESETS) {
      rows.findUserPreferredNostrClientRow.mockResolvedValueOnce({
        preferredNostrClient: preset,
      });
      await expect(getUserPreferredNostrClient(USER_ID)).resolves.toBe(preset);
    }
    rows.findUserPreferredNostrClientRow.mockResolvedValueOnce(null);
    await expect(getUserPreferredNostrClient(USER_ID)).resolves.toBe("PRIMAL");
    rows.findUserPreferredNostrClientRow.mockResolvedValueOnce({
      preferredNostrClient: "primal",
    });
    await expect(getUserPreferredNostrClient(USER_ID)).resolves.toBe("PRIMAL");
    rows.findUserPreferredNostrClientRow.mockResolvedValueOnce({
      preferredNostrClient: 1,
    });
    await expect(getUserPreferredNostrClient(USER_ID)).resolves.toBe("PRIMAL");
    rows.findUserPreferredNostrClientRow.mockRejectedValueOnce(
      new Error("client down")
    );
    await expect(getUserPreferredNostrClient(USER_ID)).rejects.toThrow(
      "client down"
    );

    rows.findUserCustomNostrClientBaseUrlRow.mockResolvedValueOnce({
      customNostrClientBaseUrl: "  https://njump.me/  ",
    });
    await expect(getUserCustomNostrClientBaseUrl(USER_ID)).resolves.toBe(
      "https://njump.me/"
    );
    rows.findUserCustomNostrClientBaseUrlRow.mockResolvedValueOnce({
      customNostrClientBaseUrl: "   ",
    });
    await expect(getUserCustomNostrClientBaseUrl(USER_ID)).resolves.toBeNull();
    rows.findUserCustomNostrClientBaseUrlRow.mockResolvedValueOnce({
      customNostrClientBaseUrl: "",
    });
    await expect(getUserCustomNostrClientBaseUrl(USER_ID)).resolves.toBeNull();
    rows.findUserCustomNostrClientBaseUrlRow.mockResolvedValueOnce({
      customNostrClientBaseUrl: 12,
    });
    await expect(getUserCustomNostrClientBaseUrl(USER_ID)).resolves.toBeNull();
    rows.findUserCustomNostrClientBaseUrlRow.mockResolvedValueOnce(null);
    await expect(getUserCustomNostrClientBaseUrl(USER_ID)).resolves.toBeNull();
    rows.findUserCustomNostrClientBaseUrlRow.mockRejectedValueOnce(
      new Error("url down")
    );
    await expect(getUserCustomNostrClientBaseUrl(USER_ID)).rejects.toThrow(
      "url down"
    );
  });

  it("stores a custom client URL only for the custom preset", async () => {
    rows.updateUserPreferredNostrClientRow.mockResolvedValue(savedUser);
    await expect(
      updateUserPreferredNostrClient(USER_ID, "CUSTOM", "  https://njump.me/  ")
    ).resolves.toBe(savedUser);
    await updateUserPreferredNostrClient(USER_ID, "CUSTOM", "   ");
    await updateUserPreferredNostrClient(USER_ID, "CUSTOM", null);
    await updateUserPreferredNostrClient(USER_ID, "DAMUS", "https://njump.me/");

    expect(rows.updateUserPreferredNostrClientRow).toHaveBeenNthCalledWith(
      1,
      USER_ID,
      {
        preferredNostrClient: "CUSTOM",
        customNostrClientBaseUrl: "https://njump.me/",
      }
    );
    expect(rows.updateUserPreferredNostrClientRow).toHaveBeenNthCalledWith(
      2,
      USER_ID,
      {
        preferredNostrClient: "CUSTOM",
        customNostrClientBaseUrl: null,
      }
    );
    expect(rows.updateUserPreferredNostrClientRow).toHaveBeenNthCalledWith(
      3,
      USER_ID,
      {
        preferredNostrClient: "CUSTOM",
        customNostrClientBaseUrl: null,
      }
    );
    expect(rows.updateUserPreferredNostrClientRow).toHaveBeenNthCalledWith(
      4,
      USER_ID,
      {
        preferredNostrClient: "DAMUS",
        customNostrClientBaseUrl: null,
      }
    );

    rows.updateUserPreferredNostrClientRow.mockRejectedValue(
      new Error("client write")
    );
    await expect(
      updateUserPreferredNostrClient(USER_ID, "IRIS")
    ).rejects.toThrow("client write");
  });

  it("reads and updates engagement and locale timestamps", async () => {
    const checkedAt = new Date("2026-04-01T00:00:00.000Z");
    rows.findEngagementLastCheckedAtRow.mockResolvedValueOnce({
      engagementLastCheckedAt: checkedAt,
    });
    await expect(getEngagementLastCheckedAt(USER_ID)).resolves.toBe(checkedAt);
    rows.findEngagementLastCheckedAtRow.mockResolvedValueOnce({
      engagementLastCheckedAt: null,
    });
    await expect(getEngagementLastCheckedAt(USER_ID)).resolves.toBeNull();
    rows.findEngagementLastCheckedAtRow.mockResolvedValueOnce(null);
    await expect(getEngagementLastCheckedAt(USER_ID)).resolves.toBeNull();
    rows.findEngagementLastCheckedAtRow.mockRejectedValueOnce(
      new Error("engagement down")
    );
    await expect(getEngagementLastCheckedAt(USER_ID)).rejects.toThrow(
      "engagement down"
    );

    rows.updateEngagementLastCheckedAtRow.mockResolvedValue(savedUser);
    await expect(updateEngagementLastCheckedAt(USER_ID)).resolves.toBe(
      savedUser
    );
    expect(rows.updateEngagementLastCheckedAtRow).toHaveBeenCalledWith(USER_ID);
    rows.updateEngagementLastCheckedAtRow.mockRejectedValue(
      new Error("engagement write")
    );
    await expect(updateEngagementLastCheckedAt(USER_ID)).rejects.toThrow(
      "engagement write"
    );

    const appliedAt = new Date("2026-04-02T00:00:00.000Z");
    rows.findLocaleDefaultsAppliedAtRow.mockResolvedValueOnce({
      localeDefaultsAppliedAt: appliedAt,
    });
    await expect(getLocaleDefaultsAppliedAt(USER_ID)).resolves.toBe(appliedAt);
    rows.findLocaleDefaultsAppliedAtRow.mockResolvedValueOnce({
      localeDefaultsAppliedAt: null,
    });
    await expect(getLocaleDefaultsAppliedAt(USER_ID)).resolves.toBeNull();
    rows.findLocaleDefaultsAppliedAtRow.mockResolvedValueOnce(null);
    await expect(getLocaleDefaultsAppliedAt(USER_ID)).resolves.toBeNull();
    rows.findLocaleDefaultsAppliedAtRow.mockRejectedValueOnce(
      new Error("locale down")
    );
    await expect(getLocaleDefaultsAppliedAt(USER_ID)).rejects.toThrow(
      "locale down"
    );

    rows.applyLocaleDefaultsOnceRow.mockResolvedValue(savedUser);
    await expect(
      applyLocaleDefaultsOnce(USER_ID, "12h", "ddmmyyyy")
    ).resolves.toBe(savedUser);
    expect(rows.applyLocaleDefaultsOnceRow).toHaveBeenCalledWith(
      USER_ID,
      "12h",
      "ddmmyyyy"
    );
    rows.applyLocaleDefaultsOnceRow.mockRejectedValue(
      new Error("locale write")
    );
    await expect(
      applyLocaleDefaultsOnce(USER_ID, "24h", "mmddyyyy")
    ).rejects.toThrow("locale write");
  });

  it("normalizes runway settings and substitutes defaults when the column is missing", async () => {
    rows.findUserRunwaySettingsRow.mockResolvedValueOnce({
      runwaySettings: {
        queueNames: ["Main", 1, "Side"],
        mode: "first-queue-empty",
        redThresholdDays: 0,
        orangeThresholdDays: 9,
        targetPostsPerDay: 10,
      },
    });
    await expect(getRunwaySettings(USER_ID)).resolves.toEqual({
      queueNames: ["Main", "Side"],
      mode: "first-queue-empty",
      redThresholdDays: 0,
      orangeThresholdDays: 9,
      targetPostsPerDay: 10,
    });

    rows.findUserRunwaySettingsRow.mockResolvedValueOnce({
      runwaySettings: {
        queueNames: [1, 2],
        mode: "nope",
        redThresholdDays: 1.5,
        orangeThresholdDays: -3,
        targetPostsPerDay: 11,
      },
    });
    await expect(getRunwaySettings(USER_ID)).resolves.toEqual(DEFAULT_RUNWAY);

    rows.findUserRunwaySettingsRow.mockResolvedValueOnce({
      runwaySettings: null,
    });
    await expect(getRunwaySettings(USER_ID)).resolves.toEqual(DEFAULT_RUNWAY);
    rows.findUserRunwaySettingsRow.mockResolvedValueOnce({
      runwaySettings: ["Main"],
    });
    await expect(getRunwaySettings(USER_ID)).resolves.toEqual(DEFAULT_RUNWAY);
    rows.findUserRunwaySettingsRow.mockResolvedValueOnce({
      runwaySettings: "last-post",
    });
    await expect(getRunwaySettings(USER_ID)).resolves.toEqual(DEFAULT_RUNWAY);
    rows.findUserRunwaySettingsRow.mockResolvedValueOnce(null);
    await expect(getRunwaySettings(USER_ID)).resolves.toEqual(DEFAULT_RUNWAY);

    rows.findUserRunwaySettingsRow.mockRejectedValueOnce({ code: "P2022" });
    await expect(getRunwaySettings(USER_ID)).resolves.toEqual(DEFAULT_RUNWAY);
    rows.findUserRunwaySettingsRow.mockRejectedValueOnce(
      new Error("runwaySettings does not exist")
    );
    await expect(getRunwaySettings(USER_ID)).resolves.toEqual(DEFAULT_RUNWAY);
    rows.findUserRunwaySettingsRow.mockRejectedValueOnce(
      new Error("runway down")
    );
    await expect(getRunwaySettings(USER_ID)).rejects.toThrow("runway down");
  });

  it("writes runway settings and returns a fallback user when the column is missing", async () => {
    rows.updateRunwaySettingsRow.mockResolvedValue(savedUser);
    await expect(
      updateRunwaySettings(USER_ID, {
        queueNames: ["Main"],
        mode: "last-post",
      })
    ).resolves.toBe(savedUser);
    await updateRunwaySettings(USER_ID, {
      queueNames: [],
      mode: "first-queue-empty",
      redThresholdDays: 0,
      orangeThresholdDays: 0,
      targetPostsPerDay: 0,
    });
    expect(rows.updateRunwaySettingsRow).toHaveBeenNthCalledWith(1, USER_ID, {
      queueNames: ["Main"],
      mode: "last-post",
      redThresholdDays: 3,
      orangeThresholdDays: 7,
      targetPostsPerDay: 0,
    });
    expect(rows.updateRunwaySettingsRow).toHaveBeenNthCalledWith(2, USER_ID, {
      queueNames: [],
      mode: "first-queue-empty",
      redThresholdDays: 0,
      orangeThresholdDays: 0,
      targetPostsPerDay: 0,
    });

    const missingCode = { code: "P2022" };
    const fallbackRow = { id: USER_ID, npub: "npub1saved", isEnabled: true };
    const fallbackUser = {
      ...fallbackRow,
      runwaySettings: null,
      primarySignerProfile: null,
      pushNotifyRunwayLow: false,
      pushNotifyIncludePreview: true,
      runwayNotifyBelowDays: null,
      lastRunwayLowNotificationAt: null,
      dateFormat: null,
    };
    rows.updateRunwaySettingsRow.mockRejectedValueOnce(missingCode);
    rows.findUserForRunwayFallbackRow.mockResolvedValueOnce(fallbackRow);
    await expect(
      updateRunwaySettings(USER_ID, {
        queueNames: ["Main"],
        mode: "last-post",
      })
    ).resolves.toEqual(fallbackUser);

    rows.updateRunwaySettingsRow.mockRejectedValueOnce(missingCode);
    rows.findUserForRunwayFallbackRow.mockResolvedValueOnce(null);
    await expect(
      updateRunwaySettings(USER_ID, {
        queueNames: [],
        mode: "last-post",
      })
    ).rejects.toBe(missingCode);

    const missingColumn = new Error("runwaySettings does not exist");
    rows.updateRunwaySettingsRow.mockRejectedValueOnce(missingColumn);
    rows.findUserForRunwayFallbackRow.mockResolvedValueOnce(fallbackRow);
    await expect(
      updateRunwaySettings(USER_ID, {
        queueNames: [],
        mode: "last-post",
      })
    ).resolves.toEqual(fallbackUser);

    rows.updateRunwaySettingsRow.mockRejectedValueOnce(missingCode);
    rows.findUserForRunwayFallbackRow.mockRejectedValueOnce(
      new Error("lookup failed")
    );
    await expect(
      updateRunwaySettings(USER_ID, {
        queueNames: [],
        mode: "last-post",
      })
    ).rejects.toThrow("lookup failed");

    const timeout = new Error("timeout");
    rows.updateRunwaySettingsRow.mockRejectedValueOnce(timeout);
    await expect(
      updateRunwaySettings(USER_ID, {
        queueNames: [],
        mode: "last-post",
      })
    ).rejects.toBe(timeout);
  });

  it("merges the schedule overview target into the current runway settings", async () => {
    rows.findUserRunwaySettingsRow.mockResolvedValueOnce({
      runwaySettings: {
        queueNames: ["Main"],
        mode: "last-post",
        redThresholdDays: 4,
        orangeThresholdDays: 8,
        targetPostsPerDay: 1,
      },
    });
    rows.updateRunwaySettingsRow.mockResolvedValueOnce(savedUser);
    await expect(updateScheduleOverviewTarget(USER_ID, 6)).resolves.toBe(
      savedUser
    );
    expect(rows.updateRunwaySettingsRow).toHaveBeenCalledWith(USER_ID, {
      queueNames: ["Main"],
      mode: "last-post",
      redThresholdDays: 4,
      orangeThresholdDays: 8,
      targetPostsPerDay: 6,
    });

    rows.findUserRunwaySettingsRow.mockResolvedValueOnce({
      runwaySettings: null,
    });
    const missingCode = { code: "P2022" };
    const fallbackRow = { id: USER_ID, npub: "npub1saved" };
    rows.updateRunwaySettingsRow.mockRejectedValueOnce(missingCode);
    rows.findUserForRunwayFallbackRow.mockResolvedValueOnce(fallbackRow);
    await expect(updateScheduleOverviewTarget(USER_ID, 2)).resolves.toEqual({
      ...fallbackRow,
      runwaySettings: null,
      primarySignerProfile: null,
      pushNotifyRunwayLow: false,
      pushNotifyIncludePreview: true,
      runwayNotifyBelowDays: null,
      lastRunwayLowNotificationAt: null,
      dateFormat: null,
    });
    expect(rows.updateRunwaySettingsRow).toHaveBeenLastCalledWith(USER_ID, {
      queueNames: [],
      mode: "last-post",
      redThresholdDays: 3,
      orangeThresholdDays: 7,
      targetPostsPerDay: 2,
    });

    rows.findUserRunwaySettingsRow.mockRejectedValueOnce(
      new Error("runway down")
    );
    await expect(updateScheduleOverviewTarget(USER_ID, 3)).rejects.toThrow(
      "runway down"
    );
  });
});
