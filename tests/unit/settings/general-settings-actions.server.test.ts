// @ts-nocheck -- mocked collaborators are narrower than the production types.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FanoutInput {
  planEnablesRelayBlast: boolean;
  subscriptionActive: boolean;
}

interface FailureBody {
  error: string;
  status: number;
}

interface PlanFlag {
  enableRelayBlast?: boolean;
}

interface PushPreferences {
  pushNotificationsEnabled?: boolean;
  pushNotifyIncludePreview?: boolean;
  pushNotifyPublishFailure?: boolean;
  pushNotifyPublishSuccess?: boolean;
  pushNotifyRunwayLow?: boolean;
  runwayNotifyBelowDays?: number | null;
}

interface RelayUpdate {
  publishRelaySource: string;
  relays: string[];
}

interface SubscriptionRow {
  Plan?: PlanFlag | null;
  status?: string;
}

function resetMocks(mocks: Record<string, { mockReset: () => void }>): void {
  for (const mock of Object.values(mocks)) mock.mockReset();
}

const payments = vi.hoisted(() => ({
  getUserSubscription: vi.fn(
    async (_userId: string): Promise<SubscriptionRow | null> => null
  ),
  relayFanoutForSubscription: vi.fn(
    (input: FanoutInput): boolean =>
      input.subscriptionActive && input.planEnablesRelayBlast
  ),
}));

const userApi = vi.hoisted(() => ({
  applyLocaleDefaultsOnce: vi.fn(
    async (_userId: string, _timeFormat: string, _dateFormat: string) =>
      undefined
  ),
  getLocaleDefaultsAppliedAt: vi.fn(
    async (_userId: string): Promise<Date | null> => null
  ),
  getUserDateFormat: vi.fn(
    async (_userId: string): Promise<string | null> => null
  ),
  getUserTimeFormat: vi.fn(
    async (_userId: string): Promise<string | null> => null
  ),
  invalidateRelayIntentCache: vi.fn(async (_userId: string) => undefined),
  updateGiveawayBlacklist: vi.fn(
    async (_userId: string, _blacklist: string[]) => undefined
  ),
  updateScheduleInterval: vi.fn(
    async (_userId: string, _intervals: string[]) => undefined
  ),
  updateUserBlastrRelayEnabled: vi.fn(
    async (_userId: string, _enabled: boolean) => undefined
  ),
  updateUserDateFormat: vi.fn(
    async (_userId: string, _dateFormat: string) => undefined
  ),
  updateUserPreferredNostrClient: vi.fn(
    async (_userId: string, _client: string, _url?: string | null) => undefined
  ),
  updateUserPushNotificationPreferences: vi.fn(
    async (_userId: string, _preferences: PushPreferences) => undefined
  ),
  updateUserRelayPublishingPreferences: vi.fn(
    async (_userId: string, _preferences: RelayUpdate) => undefined
  ),
  updateUserThemePreference: vi.fn(
    async (_userId: string, _theme: string) => undefined
  ),
  updateUserTimeFormat: vi.fn(
    async (_userId: string, _timeFormat: string) => undefined
  ),
  updateUserTimezone: vi.fn(
    async (_userId: string, _timezone: string) => undefined
  ),
}));

vi.mock("~/features/payments/data", () => ({
  getRelayFanoutSubscription: (userId: string) =>
    payments.getUserSubscription(userId),
  getUserSubscription: payments.getUserSubscription,
}));
vi.mock("~/features/payments/entitlements/deployment-mode.server", () => ({
  relayFanoutForSubscription: payments.relayFanoutForSubscription,
}));
vi.mock("~/features/user", () => userApi);

import { handleGeneralSettingsAction } from "~/features/settings/actions/general-settings-actions.server";

const USER_ID = "user-1";

function form(entries: Record<string, string>): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(entries)) body.append(key, value);
  return body;
}

function run(
  action: string,
  entries: Record<string, string> = {}
): Promise<unknown> {
  return handleGeneralSettingsAction(USER_ID, action, form(entries));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseUnknown(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function errorMessage(body: unknown): string {
  if (!isRecord(body) || typeof body["error"] !== "string") {
    throw new Error("expected an error message");
  }
  return body["error"];
}

async function readFailure(result: unknown): Promise<FailureBody> {
  if (result instanceof Response) {
    return {
      error: errorMessage(parseUnknown(await result.text())),
      status: result.status,
    };
  }
  if (!isRecord(result) || !("data" in result) || !("init" in result)) {
    throw new Error("expected an error result");
  }
  const init = result["init"];
  if (!isRecord(init) || typeof init["status"] !== "number") {
    throw new Error("expected a status");
  }
  return { error: errorMessage(result["data"]), status: init["status"] };
}

function allowBlastr(): void {
  payments.getUserSubscription.mockResolvedValue({
    Plan: { enableRelayBlast: true },
    status: "ACTIVE",
  });
}

describe("general settings actions", () => {
  beforeEach(() => {
    resetMocks(userApi);
    resetMocks(payments);
    payments.getUserSubscription.mockResolvedValue(null);
    payments.relayFanoutForSubscription.mockImplementation(
      (input: FanoutInput) =>
        input.subscriptionActive && input.planEnablesRelayBlast
    );
  });

  it("returns null for an unknown action", async () => {
    await expect(run("delete_everything")).resolves.toBeNull();
    await expect(run("")).resolves.toBeNull();
    expect(userApi.updateUserTimezone).not.toHaveBeenCalled();
    expect(payments.getUserSubscription).not.toHaveBeenCalled();
  });

  describe("update_timezone", () => {
    it("saves a timezone and propagates database failures", async () => {
      await expect(
        run("update_timezone", { timezone: "Europe/Berlin" })
      ).resolves.toEqual({ success: true });
      expect(userApi.updateUserTimezone).toHaveBeenCalledWith(
        USER_ID,
        "Europe/Berlin"
      );

      userApi.updateUserTimezone.mockRejectedValueOnce(new Error("db down"));
      await expect(
        run("update_timezone", { timezone: "Europe/Berlin" })
      ).rejects.toThrow("db down");
      userApi.updateUserTimezone.mockRejectedValueOnce("db down");
      await expect(
        run("update_timezone", { timezone: "Europe/Berlin" })
      ).rejects.toBe("db down");
    });

    it("rejects a missing timezone", async () => {
      const failure = await readFailure(await run("update_timezone"));
      expect(failure.status).toBe(400);
      expect(failure.error).toContain("timezone");
      expect(userApi.updateUserTimezone).not.toHaveBeenCalled();
    });
  });

  describe("update_theme_preference", () => {
    it("saves each theme and returns it", async () => {
      for (const themePreference of ["system", "light", "dark"]) {
        userApi.updateUserThemePreference.mockClear();
        await expect(
          run("update_theme_preference", { themePreference })
        ).resolves.toEqual({ success: true, themePreference });
        expect(userApi.updateUserThemePreference).toHaveBeenCalledWith(
          USER_ID,
          themePreference
        );
      }
    });

    it("rejects an unknown theme", async () => {
      const failure = await readFailure(
        await run("update_theme_preference", { themePreference: "blue" })
      );
      expect(failure.status).toBe(400);
      expect(failure.error).toContain("themePreference");
      expect(userApi.updateUserThemePreference).not.toHaveBeenCalled();
    });
  });

  describe("update_relays", () => {
    it("saves relays and clears the relay intent cache", async () => {
      await expect(
        run("update_relays", {
          publishRelaySource: "app",
          relays: "wss://relay.example.com\nwss://backup.example.com",
        })
      ).resolves.toEqual({ success: true });
      expect(userApi.updateUserRelayPublishingPreferences).toHaveBeenCalledWith(
        USER_ID,
        {
          publishRelaySource: "app",
          relays: ["wss://relay.example.com", "wss://backup.example.com"],
        }
      );
      expect(userApi.invalidateRelayIntentCache).toHaveBeenCalledWith(USER_ID);

      userApi.updateUserRelayPublishingPreferences.mockClear();
      userApi.invalidateRelayIntentCache.mockClear();
      await expect(
        run("update_relays", { relays: "wss://relay.example.com" })
      ).resolves.toEqual({ success: true });
      expect(userApi.updateUserRelayPublishingPreferences).toHaveBeenCalledWith(
        USER_ID,
        {
          publishRelaySource: "nip65_profile",
          relays: ["wss://relay.example.com"],
        }
      );
    });

    it("rejects an empty list and a non-wss url", async () => {
      const empty = await readFailure(
        await run("update_relays", { relays: "" })
      );
      expect(empty.status).toBe(400);
      expect(empty.error).toContain("relays");
      const https = await readFailure(
        await run("update_relays", { relays: "https://relay.example.com" })
      );
      expect(https.status).toBe(400);
      expect(https.error).toContain("relays");
      expect(
        userApi.updateUserRelayPublishingPreferences
      ).not.toHaveBeenCalled();
      expect(userApi.invalidateRelayIntentCache).not.toHaveBeenCalled();
    });
  });

  describe("update_blastr_relay_enabled", () => {
    it("rejects every subscription that cannot fan out", async () => {
      for (const status of [
        "CANCELED",
        "PAST_DUE",
        "UNPAID",
        "TRIALING",
        "INACTIVE",
        "Active",
        "",
      ]) {
        payments.getUserSubscription.mockResolvedValueOnce({
          Plan: { enableRelayBlast: true },
          status,
        });
        const failure = await readFailure(
          await run("update_blastr_relay_enabled", {
            blastrRelayEnabled: "true",
          })
        );
        expect(failure).toEqual({
          error: "SFS Blastr is not available on your current plan.",
          status: 403,
        });
        expect(payments.relayFanoutForSubscription).toHaveBeenLastCalledWith({
          planEnablesRelayBlast: true,
          subscriptionActive: false,
        });
      }

      payments.getUserSubscription.mockResolvedValueOnce(null);
      expect(
        await readFailure(
          await run("update_blastr_relay_enabled", {
            blastrRelayEnabled: "true",
          })
        )
      ).toEqual({
        error: "SFS Blastr is not available on your current plan.",
        status: 403,
      });
      expect(payments.relayFanoutForSubscription).toHaveBeenLastCalledWith({
        planEnablesRelayBlast: false,
        subscriptionActive: false,
      });

      for (const plan of [
        undefined,
        null,
        { enableRelayBlast: false },
      ] as const) {
        payments.getUserSubscription.mockResolvedValueOnce({
          Plan: plan,
          status: "ACTIVE",
        });
        await readFailure(
          await run("update_blastr_relay_enabled", {
            blastrRelayEnabled: "true",
          })
        );
        expect(payments.relayFanoutForSubscription).toHaveBeenLastCalledWith({
          planEnablesRelayBlast: false,
          subscriptionActive: true,
        });
      }

      allowBlastr();
      payments.relayFanoutForSubscription.mockReturnValueOnce(false);
      expect(
        await readFailure(
          await run("update_blastr_relay_enabled", {
            blastrRelayEnabled: "true",
          })
        )
      ).toEqual({
        error: "SFS Blastr is not available on your current plan.",
        status: 403,
      });
      expect(userApi.updateUserBlastrRelayEnabled).not.toHaveBeenCalled();
    });

    it("saves the boolean form value when the plan allows blastr", async () => {
      const cases: Array<{ enabled: boolean; value?: string }> = [
        { enabled: true, value: "true" },
        { enabled: false, value: "false" },
        { enabled: false, value: "TRUE" },
        { enabled: false, value: "1" },
        { enabled: false, value: "" },
        { enabled: false },
      ];
      for (const item of cases) {
        allowBlastr();
        userApi.updateUserBlastrRelayEnabled.mockClear();
        const entries: Record<string, string> = {};
        if (item.value !== undefined)
          entries["blastrRelayEnabled"] = item.value;
        await expect(
          run("update_blastr_relay_enabled", entries)
        ).resolves.toEqual({ success: true });
        expect(userApi.updateUserBlastrRelayEnabled).toHaveBeenCalledWith(
          USER_ID,
          item.enabled
        );
        expect(payments.getUserSubscription).toHaveBeenCalledWith(USER_ID);
      }
    });

    it("propagates subscription lookup failures", async () => {
      payments.getUserSubscription.mockRejectedValueOnce(new Error("db down"));
      await expect(
        run("update_blastr_relay_enabled", { blastrRelayEnabled: "true" })
      ).rejects.toThrow("db down");
      payments.getUserSubscription.mockRejectedValueOnce("db down");
      await expect(
        run("update_blastr_relay_enabled", { blastrRelayEnabled: "true" })
      ).rejects.toBe("db down");
    });
  });

  describe("update_blacklist", () => {
    it("saves npubs and drops blank lines", async () => {
      await expect(
        run("update_blacklist", { blacklist: "npub1abc\n\nnpub1def" })
      ).resolves.toEqual({ success: true });
      expect(userApi.updateGiveawayBlacklist).toHaveBeenCalledWith(USER_ID, [
        "npub1abc",
        "npub1def",
      ]);
      await expect(run("update_blacklist", { blacklist: "" })).resolves.toEqual(
        {
          success: true,
        }
      );
      expect(userApi.updateGiveawayBlacklist).toHaveBeenLastCalledWith(
        USER_ID,
        []
      );
      await expect(
        run("update_blacklist", { blacklist: "\n  \n" })
      ).resolves.toEqual({ success: true });
      expect(userApi.updateGiveawayBlacklist).toHaveBeenLastCalledWith(
        USER_ID,
        []
      );
    });

    it("rejects a value that does not start with npub", async () => {
      const failure = await readFailure(
        await run("update_blacklist", { blacklist: "not-an-npub" })
      );
      expect(failure.status).toBe(400);
      expect(failure.error).toContain("npub");
      expect(userApi.updateGiveawayBlacklist).not.toHaveBeenCalled();
    });
  });

  describe("update_schedule_intervals", () => {
    it("saves allowed intervals", async () => {
      await expect(
        run("update_schedule_intervals", {
          scheduleIntervals: "1\n0.25\n0.5\n24",
        })
      ).resolves.toEqual({ success: true });
      expect(userApi.updateScheduleInterval).toHaveBeenCalledWith(USER_ID, [
        "1",
        "0.25",
        "0.5",
        "24",
      ]);
    });

    it("rejects empty, non-numeric, and disallowed intervals", async () => {
      for (const scheduleIntervals of ["", "0", "1.5", "abc"]) {
        const failure = await readFailure(
          await run("update_schedule_intervals", { scheduleIntervals })
        );
        expect(failure.status).toBe(400);
        expect(failure.error).toContain("scheduleIntervals");
      }
      expect(userApi.updateScheduleInterval).not.toHaveBeenCalled();
    });
  });

  describe("update_notification_preferences", () => {
    it("maps present flags and leaves missing flags out", async () => {
      await expect(run("update_notification_preferences")).resolves.toEqual({
        success: true,
      });
      expect(
        userApi.updateUserPushNotificationPreferences
      ).toHaveBeenCalledWith(USER_ID, {});

      await expect(
        run("update_notification_preferences", {
          pushNotificationsEnabled: "true",
          pushNotifyIncludePreview: "true",
          pushNotifyPublishFailure: "true",
          pushNotifyPublishSuccess: "true",
          pushNotifyRunwayLow: "true",
          runwayNotifyBelowDays: "10",
        })
      ).resolves.toEqual({ success: true });
      expect(
        userApi.updateUserPushNotificationPreferences
      ).toHaveBeenLastCalledWith(USER_ID, {
        pushNotificationsEnabled: true,
        pushNotifyIncludePreview: true,
        pushNotifyPublishFailure: true,
        pushNotifyPublishSuccess: true,
        pushNotifyRunwayLow: true,
        runwayNotifyBelowDays: 10,
      });
    });

    it("treats non-true flag strings as false", async () => {
      const keys = [
        "pushNotificationsEnabled",
        "pushNotifyPublishSuccess",
        "pushNotifyPublishFailure",
        "pushNotifyRunwayLow",
        "pushNotifyIncludePreview",
      ];
      for (const key of keys) {
        for (const [value, enabled] of [
          ["true", true],
          ["false", false],
          ["TRUE", false],
          ["yes", false],
        ] as const) {
          userApi.updateUserPushNotificationPreferences.mockClear();
          const entries: Record<string, string> = {};
          entries[key] = value;
          await expect(
            run("update_notification_preferences", entries)
          ).resolves.toEqual({ success: true });
          expect(
            userApi.updateUserPushNotificationPreferences
          ).toHaveBeenCalledWith(USER_ID, { [key]: enabled });
        }
      }
    });

    it("normalizes the runway threshold", async () => {
      const cases: Array<[string, number | null]> = [
        ["0", 0],
        ["365", 365],
        ["366", null],
        ["-1", null],
        ["12", 12],
        ["12abc", 12],
        ["12.9", 12],
        ["abc", null],
        [" 9", 9],
        ["", null],
        ["true", null],
      ];
      for (const [value, runwayNotifyBelowDays] of cases) {
        userApi.updateUserPushNotificationPreferences.mockClear();
        await run("update_notification_preferences", {
          runwayNotifyBelowDays: value,
        });
        expect(
          userApi.updateUserPushNotificationPreferences
        ).toHaveBeenCalledWith(USER_ID, { runwayNotifyBelowDays });
      }
    });
  });

  describe("update_time_format", () => {
    it("saves 12h and 24h", async () => {
      for (const timeFormat of ["12h", "24h"]) {
        userApi.updateUserTimeFormat.mockClear();
        await expect(
          run("update_time_format", { timeFormat })
        ).resolves.toEqual({
          success: true,
        });
        expect(userApi.updateUserTimeFormat).toHaveBeenCalledWith(
          USER_ID,
          timeFormat
        );
      }
    });

    it("rejects a missing or unknown time format", async () => {
      expect(await readFailure(await run("update_time_format"))).toEqual({
        error: "Invalid time format",
        status: 400,
      });
      expect(
        await readFailure(
          await run("update_time_format", { timeFormat: "13h" })
        )
      ).toEqual({ error: "Invalid time format", status: 400 });
      expect(userApi.updateUserTimeFormat).not.toHaveBeenCalled();
    });
  });

  describe("update_date_format", () => {
    it("saves each supported date format", async () => {
      for (const dateFormat of ["ddmmyyyy", "mmddyyyy", "yyyymmdd"]) {
        userApi.updateUserDateFormat.mockClear();
        await expect(
          run("update_date_format", { dateFormat })
        ).resolves.toEqual({
          success: true,
        });
        expect(userApi.updateUserDateFormat).toHaveBeenCalledWith(
          USER_ID,
          dateFormat
        );
      }
    });

    it("rejects a missing or unknown date format", async () => {
      expect(await readFailure(await run("update_date_format"))).toEqual({
        error: "Invalid date format",
        status: 400,
      });
      expect(
        await readFailure(
          await run("update_date_format", { dateFormat: "yyyy-mm-dd" })
        )
      ).toEqual({ error: "Invalid date format", status: 400 });
      expect(userApi.updateUserDateFormat).not.toHaveBeenCalled();
    });
  });

  describe("update_preferred_nostr_client", () => {
    it("saves a preset and a trimmed custom url", async () => {
      await expect(
        run("update_preferred_nostr_client", { preferredNostrClient: "PRIMAL" })
      ).resolves.toEqual({ success: true });
      expect(userApi.updateUserPreferredNostrClient).toHaveBeenCalledWith(
        USER_ID,
        "PRIMAL",
        undefined
      );

      await expect(
        run("update_preferred_nostr_client", {
          customNostrClientBaseUrl: "  https://client.example/app  ",
          preferredNostrClient: "CUSTOM",
        })
      ).resolves.toEqual({ success: true });
      expect(userApi.updateUserPreferredNostrClient).toHaveBeenLastCalledWith(
        USER_ID,
        "CUSTOM",
        "https://client.example/app"
      );

      await expect(
        run("update_preferred_nostr_client", {
          customNostrClientBaseUrl: "",
          preferredNostrClient: "CUSTOM",
        })
      ).resolves.toEqual({ success: true });
      expect(userApi.updateUserPreferredNostrClient).toHaveBeenLastCalledWith(
        USER_ID,
        "CUSTOM",
        undefined
      );
    });

    it("rejects an unknown client and a non-https custom url", async () => {
      const unknown = await readFailure(
        await run("update_preferred_nostr_client", {
          preferredNostrClient: "mastodon",
        })
      );
      expect(unknown.status).toBe(400);
      expect(unknown.error).toContain("preferredNostrClient");
      const http = await readFailure(
        await run("update_preferred_nostr_client", {
          customNostrClientBaseUrl: "http://client.example",
          preferredNostrClient: "CUSTOM",
        })
      );
      expect(http.status).toBe(400);
      expect(http.error).toContain("customNostrClientBaseUrl");
      const spaced = await readFailure(
        await run("update_preferred_nostr_client", {
          customNostrClientBaseUrl: "https://bad host",
          preferredNostrClient: "CUSTOM",
        })
      );
      expect(spaced.status).toBe(400);
      expect(spaced.error).toContain("customNostrClientBaseUrl");
      expect(userApi.updateUserPreferredNostrClient).not.toHaveBeenCalled();
    });
  });

  describe("apply_locale_defaults", () => {
    it("rejects an invalid time or date format before reading the user", async () => {
      for (const entries of [
        { dateFormat: "ddmmyyyy", timeFormat: "10h" },
        { dateFormat: "dd-mm-yyyy", timeFormat: "12h" },
        { dateFormat: "ddmmyyyy" },
        { timeFormat: "24h" },
      ]) {
        const failure = await readFailure(
          await run("apply_locale_defaults", entries)
        );
        expect(failure).toEqual({
          error: "Invalid time or date format for locale defaults",
          status: 400,
        });
      }
      expect(userApi.getLocaleDefaultsAppliedAt).not.toHaveBeenCalled();
      expect(userApi.applyLocaleDefaultsOnce).not.toHaveBeenCalled();
    });

    it("skips when defaults were already applied or the user left the defaults", async () => {
      userApi.getLocaleDefaultsAppliedAt.mockResolvedValue(
        new Date("2024-01-02T00:00:00.000Z")
      );
      await expect(
        run("apply_locale_defaults", {
          dateFormat: "mmddyyyy",
          timeFormat: "12h",
        })
      ).resolves.toEqual({ skipped: true, success: true });
      expect(userApi.getUserTimeFormat).not.toHaveBeenCalled();
      expect(userApi.applyLocaleDefaultsOnce).not.toHaveBeenCalled();

      userApi.getLocaleDefaultsAppliedAt.mockResolvedValue(null);
      const skips: Array<[string | null, string | null]> = [
        ["12h", "ddmmyyyy"],
        ["24h", "mmddyyyy"],
        ["24h", "yyyymmdd"],
        [null, "ddmmyyyy"],
        ["24h", null],
      ];
      for (const [timeFormat, dateFormat] of skips) {
        userApi.getUserTimeFormat.mockResolvedValue(timeFormat);
        userApi.getUserDateFormat.mockResolvedValue(dateFormat);
        userApi.applyLocaleDefaultsOnce.mockClear();
        await expect(
          run("apply_locale_defaults", {
            dateFormat: "mmddyyyy",
            timeFormat: "12h",
          })
        ).resolves.toEqual({ skipped: true, success: true });
        expect(userApi.applyLocaleDefaultsOnce).not.toHaveBeenCalled();
      }
    });

    it("applies locale defaults once while the account is still on defaults", async () => {
      userApi.getLocaleDefaultsAppliedAt.mockResolvedValue(null);
      userApi.getUserTimeFormat.mockResolvedValue("24h");
      userApi.getUserDateFormat.mockResolvedValue("ddmmyyyy");
      await expect(
        run("apply_locale_defaults", {
          dateFormat: "yyyymmdd",
          timeFormat: "12h",
        })
      ).resolves.toEqual({ success: true });
      expect(userApi.applyLocaleDefaultsOnce).toHaveBeenCalledWith(
        USER_ID,
        "12h",
        "yyyymmdd"
      );
    });

    it("propagates lookup failures", async () => {
      userApi.getLocaleDefaultsAppliedAt.mockRejectedValueOnce(
        new Error("db down")
      );
      await expect(
        run("apply_locale_defaults", {
          dateFormat: "ddmmyyyy",
          timeFormat: "12h",
        })
      ).rejects.toThrow("db down");
      userApi.getLocaleDefaultsAppliedAt.mockRejectedValueOnce("db down");
      await expect(
        run("apply_locale_defaults", {
          dateFormat: "ddmmyyyy",
          timeFormat: "12h",
        })
      ).rejects.toBe("db down");
    });
  });
});
