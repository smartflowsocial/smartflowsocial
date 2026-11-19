import { describe, expect, it } from "vitest";

import {
  cancelAtPeriodEndSchema,
  cancelChildRequestSchema,
  childNpubSchema,
  createHashtagPresetSchema,
  createQueueTypeSchema,
  deleteHashtagPresetSchema,
  deleteQueueTypeSchema,
  queueStatusActionSchema,
  requestChildSchema,
  scheduleDowngradeSchema,
  scheduleTypeSchema,
  searchAccountsSchema,
  switchToFreePlanSchema,
  toggleFilterMutedSchema,
  toggleHideLowTrustSchema,
  toggleQueueEnabledSchema,
  topUpSubscriptionSchema,
  unlinkChildSchema,
  updateBlacklistSchema,
  updateBlossomMirrorsSchema,
  updateDefaultZapAmountSchema,
  updateHashtagPresetSchema,
  updateNWCSchema,
  updatePreferredNostrClientSchema,
  updatePrimarySignerProfileSchema,
  updateQueueTypeSchema,
  updateRelaysSchema,
  updateScheduleIntervalsSchema,
  updateTagsSchema,
  updateThemePreferenceSchema,
  updateTimezoneSchema,
  updateUploadProviderSchema,
  uploadProviderSchema,
} from "~/lib/validation/schemas/settings.schemas";

const PLANS = [
  "free",
  "starter",
  "creator",
  "pro",
  "teams",
  "founder",
] as const;
const CLIENTS = [
  "PRIMAL",
  "DAMUS",
  "AMETHYST",
  "NOSTUR",
  "NOSTRUDEL",
  "IRIS",
  "YAKIHONNE",
  "JUMBLE",
] as const;
const COLORS = [
  "slate",
  "blue",
  "cyan",
  "teal",
  "green",
  "lime",
  "amber",
  "orange",
  "red",
  "pink",
  "violet",
  "indigo",
] as const;
const HEX = "ab".repeat(32);

function issues(result: {
  success: boolean;
  error?: { issues: Array<{ message: string }> };
}): string {
  if (result.success || !result.error) {
    throw new Error("expected a schema failure");
  }
  return result.error.issues.map((issue) => issue.message).join("\n");
}

describe("settings schema missed branches", () => {
  it("rejects a blank timezone and accepts every theme", () => {
    expect(issues(updateTimezoneSchema.safeParse({ timezone: "" }))).toContain(
      "Timezone is required"
    );
    for (const themePreference of ["system", "light", "dark"] as const) {
      expect(
        updateThemePreferenceSchema.parse({ themePreference }).themePreference
      ).toBe(themePreference);
    }
    expect(
      issues(
        updateThemePreferenceSchema.safeParse({ themePreference: "sepia" })
      )
    ).toContain("Invalid option");
  });

  it("trims relay lines and accepts both publish sources", () => {
    expect(
      updateRelaysSchema.parse({
        relays: "wss://one.example\n \nwss://two.example",
        publishRelaySource: "app",
      })
    ).toEqual({
      relays: ["wss://one.example", "wss://two.example"],
      publishRelaySource: "app",
    });
    expect(
      issues(
        updateRelaysSchema.safeParse({
          relays: "\n",
          publishRelaySource: "elsewhere",
        })
      )
    ).toContain("Invalid option");
    expect(issues(updateRelaysSchema.safeParse({ relays: "" }))).toContain(
      "At least one relay is required"
    );
  });

  it("allows an empty blacklist and rejects a non-npub line", () => {
    expect(
      updateBlacklistSchema.parse({ blacklist: "\n  \n" }).blacklist
    ).toEqual([]);
    expect(
      updateBlacklistSchema.parse({ blacklist: "npub1abc\n\nnpub1def" })
        .blacklist
    ).toEqual(["npub1abc", "npub1def"]);
    expect(
      issues(updateBlacklistSchema.safeParse({ blacklist: "npub1ok\nhex" }))
    ).toContain("All blacklist items must start with npub");
  });

  it.each([
    ["", "At least one schedule interval is required"],
    ["abc", "Must be a number"],
    ["0", "Must be positive"],
    ["-2", "Must be positive"],
    ["0.3", "Schedule interval must be 0.25"],
  ])("rejects schedule interval %s", (scheduleIntervals, message) => {
    expect(
      issues(updateScheduleIntervalsSchema.safeParse({ scheduleIntervals }))
    ).toContain(message);
  });

  it("keeps allowed schedule intervals and drops blank lines", () => {
    expect(
      updateScheduleIntervalsSchema.parse({
        scheduleIntervals: "0.25\n\n0.5\n2",
      }).scheduleIntervals
    ).toEqual(["0.25", "0.5", "2"]);
  });

  it.each(CLIENTS)(
    "accepts preferred client %s without a custom URL",
    (client) => {
      expect(
        updatePreferredNostrClientSchema.parse({
          preferredNostrClient: client,
          customNostrClientBaseUrl: "http://ignored.example",
        })
      ).toEqual({
        preferredNostrClient: client,
        customNostrClientBaseUrl: "http://ignored.example",
      });
    }
  );

  it("checks custom client URL branches", () => {
    expect(
      updatePreferredNostrClientSchema.parse({
        preferredNostrClient: "CUSTOM",
        customNostrClientBaseUrl: "https://client.example/app",
      }).customNostrClientBaseUrl
    ).toBe("https://client.example/app");
    expect(
      issues(
        updatePreferredNostrClientSchema.safeParse({
          preferredNostrClient: "CUSTOM",
          customNostrClientBaseUrl: "http://client.example",
        })
      )
    ).toContain("Custom client URL must start with https://");
    expect(
      issues(
        updatePreferredNostrClientSchema.safeParse({
          preferredNostrClient: "CUSTOM",
          customNostrClientBaseUrl: "https://",
        })
      )
    ).toContain("Invalid URL format");
    expect(
      issues(
        updatePreferredNostrClientSchema.safeParse({
          preferredNostrClient: "NOPE",
        })
      )
    ).toContain("Invalid option");
  });

  it("trims hashtag presets and requires ids", () => {
    expect(
      createHashtagPresetSchema.parse({
        name: "  Preset  ",
        tags: "  #a  ",
        description: "notes",
      })
    ).toEqual({ name: "Preset", tags: "#a", description: "notes" });
    expect(
      issues(createHashtagPresetSchema.safeParse({ name: " ", tags: " " }))
    ).toContain("Name is required");
    expect(
      updateHashtagPresetSchema.parse({
        id: "id-1",
        name: "Name",
        tags: "#t",
      }).description
    ).toBeUndefined();
    expect(issues(deleteHashtagPresetSchema.safeParse({ id: "" }))).toContain(
      "ID is required"
    );
  });

  it.each([
    "S3",
    "BLOSSOM_PRIMAL",
    "BLOSSOM_BLOSSTR",
    "BLOSSOM_SFS",
    "BLOSSOM_CUSTOM",
  ] as const)("accepts upload provider %s", (provider) => {
    expect(uploadProviderSchema.parse(provider)).toBe(provider);
  });

  it("checks custom blossom URL branches", () => {
    expect(
      updateUploadProviderSchema.parse({
        uploadProvider: "S3",
        customBlossomUrl: " https://cdn.example/ ",
      }).customBlossomUrl
    ).toBe("https://cdn.example");
    expect(
      issues(
        updateUploadProviderSchema.safeParse({
          uploadProvider: "BLOSSOM_CUSTOM",
          customBlossomUrl: "   ",
        })
      )
    ).toContain("Custom Blossom URL is required");
    expect(
      issues(
        updateUploadProviderSchema.safeParse({
          uploadProvider: "BLOSSOM_CUSTOM",
          customBlossomUrl: "http://blossom.example",
        })
      )
    ).toContain("Custom Blossom URL must start with https://");
    expect(
      issues(
        updateUploadProviderSchema.safeParse({
          uploadProvider: "BLOSSOM_CUSTOM",
          customBlossomUrl: "https://exa mple.com",
        })
      )
    ).toContain("Invalid URL format");
  });

  it.each([
    [undefined, false],
    ["on", true],
    ["true", true],
    [true, true],
    ["false", false],
    [false, false],
    ["yes", false],
  ] as const)("coerces blossom mirror flag %s", (flag, enabled) => {
    expect(
      updateBlossomMirrorsSchema.parse({
        enableMirrorBlossom: flag,
        mirrorUrls: "https://a.example/\n \nhttps://b.example",
      })
    ).toEqual({
      enableMirrorBlossom: enabled,
      mirrorUrls: ["https://a.example", "https://b.example"],
    });
  });

  it("rejects blossom mirrors that are not https URLs", () => {
    expect(
      issues(
        updateBlossomMirrorsSchema.safeParse({ mirrorUrls: "http://a.example" })
      )
    ).toContain("All mirror URLs must start with https://");
    expect(
      issues(updateBlossomMirrorsSchema.safeParse({ mirrorUrls: "https://" }))
    ).toContain("Invalid URL format");
    expect(updateBlossomMirrorsSchema.parse({}).mirrorUrls).toEqual([]);
  });

  it("checks primary signer bunker and nostrconnect requirements", () => {
    expect(
      updatePrimarySignerProfileSchema.parse({
        method: "bunker_input",
        bunkerInput: " bunker ",
        label: "  ",
        expectedPubkey: " pk ",
      })
    ).toEqual({
      method: "bunker_input",
      bunkerInput: "bunker",
      label: null,
      expectedPubkey: "pk",
      uri: "",
      relays: [],
    });
    expect(
      issues(
        updatePrimarySignerProfileSchema.safeParse({
          method: "bunker_input",
          bunkerInput: " ",
        })
      )
    ).toContain("Bunker input is required");
    expect(
      issues(
        updatePrimarySignerProfileSchema.safeParse({
          method: "nostrconnect_uri",
          uri: " ",
          relays: "wss://one.example",
        })
      )
    ).toContain("nostrconnect URI is required");
    expect(
      issues(
        updatePrimarySignerProfileSchema.safeParse({
          method: "nostrconnect_uri",
          uri: "nostrconnect://abc",
          relays: " \n ",
        })
      )
    ).toContain("At least one relay is required");
    expect(
      updatePrimarySignerProfileSchema.parse({
        method: "nostrconnect_uri",
        uri: " nostrconnect://abc ",
        relays: "wss://one.example\nwss://two.example",
      }).relays
    ).toEqual(["wss://one.example", "wss://two.example"]);
  });

  it.each(["INTERVAL", "FIXED_SLOTS", "WEEKLY_SLOTS"] as const)(
    "accepts schedule type %s",
    (scheduleType) => {
      expect(scheduleTypeSchema.parse(scheduleType)).toBe(scheduleType);
    }
  );

  it("checks queue create schedule modes, colors, and boolean flags", () => {
    expect(
      createQueueTypeSchema.parse({
        name: "  Queue  ",
        scheduleType: "INTERVAL",
        useGlobalInterval: "on",
        hashTagPresetId: "none",
        scheduleRandomWindowMinutes: "",
      })
    ).toMatchObject({
      name: "Queue",
      colorToken: "slate",
      hashTagPresetId: null,
      useGlobalInterval: true,
      scheduleRandomWindowMinutes: 0,
      includeHashtagsInNoteBody: true,
    });
    expect(
      createQueueTypeSchema.parse({
        name: "Slots",
        scheduleType: "FIXED_SLOTS",
        colorToken: "blue",
        slots: " 09:00, , 10:00 ",
        includeHashtagsInNoteBody: "on",
        hashTagPresetId: "preset-1",
        scheduleRandomWindowMinutes: 15,
      })
    ).toMatchObject({
      slots: ["09:00", "10:00"],
      includeHashtagsInNoteBody: true,
      hashTagPresetId: "preset-1",
      scheduleRandomWindowMinutes: 15,
    });
    expect(
      createQueueTypeSchema.parse({
        name: "Week",
        scheduleType: "WEEKLY_SLOTS",
        weeklySlots: JSON.stringify([{ dayOfWeek: 1, time: "9:30" }]),
        includeHashtagsInNoteBody: "false",
        intervalHours: "2",
      }).weeklySlots
    ).toEqual([{ dayOfWeek: 1, time: "9:30" }]);

    expect(
      issues(
        createQueueTypeSchema.safeParse({
          name: " ",
          scheduleType: "INTERVAL",
          intervalHours: "1",
        })
      )
    ).toContain("Name is required");
    expect(
      issues(
        createQueueTypeSchema.safeParse({
          name: "Q",
          scheduleType: "INTERVAL",
          intervalHours: "0.3",
        })
      )
    ).toContain("Schedule interval must be 0.25");
    expect(
      issues(
        createQueueTypeSchema.safeParse({
          name: "Q",
          scheduleType: "FIXED_SLOTS",
          slots: "",
        })
      )
    ).toContain("Slots are required");
    expect(
      issues(
        createQueueTypeSchema.safeParse({
          name: "Q",
          scheduleType: "WEEKLY_SLOTS",
          weeklySlots: "{",
        })
      )
    ).toContain("At least one weekly slot");
    expect(
      issues(
        createQueueTypeSchema.safeParse({
          name: "Q",
          scheduleType: "WEEKLY_SLOTS",
          weeklySlots: JSON.stringify([{ dayOfWeek: 7, time: "10:00" }]),
        })
      )
    ).toContain("Too big");
    expect(
      issues(
        createQueueTypeSchema.safeParse({
          name: "Q",
          scheduleType: "WEEKLY_SLOTS",
          weeklySlots: JSON.stringify([{ dayOfWeek: 1, time: "1030" }]),
        })
      )
    ).toContain("Time must be HH:mm");
    expect(
      issues(
        createQueueTypeSchema.safeParse({
          name: "Q",
          scheduleType: "INTERVAL",
          intervalHours: "1",
          scheduleRandomWindowMinutes: 16,
          colorToken: "black",
        })
      )
    ).toContain("Invalid option");
  });

  it.each(COLORS)("accepts queue color %s", (colorToken) => {
    expect(
      updateQueueTypeSchema.parse({
        id: "id-1",
        name: "Queue",
        scheduleType: "INTERVAL",
        colorToken,
        intervalHours: "1",
        isEnabled: "on",
      }).colorToken
    ).toBe(colorToken);
  });

  it("checks queue update, delete, toggle, and status actions", () => {
    expect(
      updateQueueTypeSchema.parse({
        id: "id-1",
        name: "Queue",
        scheduleType: "INTERVAL",
        colorToken: "slate",
        useGlobalInterval: true,
        hashTagPresetId: "",
        isEnabled: "false",
      })
    ).toMatchObject({
      hashTagPresetId: null,
      isEnabled: false,
      useGlobalInterval: true,
      includeHashtagsInNoteBody: true,
    });
    expect(
      issues(updateQueueTypeSchema.safeParse({ id: "", name: "Q" }))
    ).toContain("ID is required");
    expect(deleteQueueTypeSchema.parse({ id: "id-1" }).deleteMode).toBe(
      "queue_only"
    );
    expect(
      deleteQueueTypeSchema.parse({
        id: "id-1",
        deleteMode: "queue_and_scheduled",
      }).deleteMode
    ).toBe("queue_and_scheduled");
    expect(
      toggleQueueEnabledSchema.parse({ id: "id-1", isEnabled: "true" })
        .isEnabled
    ).toBe(true);
    expect(
      toggleQueueEnabledSchema.parse({ id: "id-1", isEnabled: false }).isEnabled
    ).toBe(false);
    expect(queueStatusActionSchema.parse({ id: "id-1" }).id).toBe("id-1");
    expect(issues(queueStatusActionSchema.safeParse({ id: "" }))).toContain(
      "ID is required"
    );
  });

  it("validates account search, child pubkeys, and engagement toggles", () => {
    expect(searchAccountsSchema.parse({}).q).toBe("");
    expect(searchAccountsSchema.parse({ q: "ada" }).q).toBe("ada");
    expect(childNpubSchema.parse(HEX)).toBe(HEX);
    expect(issues(childNpubSchema.safeParse("abc"))).toContain(
      "Invalid hex pubkey format"
    );
    expect(requestChildSchema.parse({ childNpub: HEX }).childNpub).toBe(HEX);
    expect(
      cancelChildRequestSchema.parse({ childNpub: HEX.toUpperCase() }).childNpub
    ).toBe(HEX.toUpperCase());
    expect(unlinkChildSchema.parse({ childNpub: HEX }).childNpub).toBe(HEX);
    expect(
      toggleFilterMutedSchema.parse({ filterMuted: "true" }).filterMuted
    ).toBe(true);
    expect(
      toggleFilterMutedSchema.parse({ filterMuted: "TRUE" }).filterMuted
    ).toBe(false);
    expect(
      toggleHideLowTrustSchema.parse({ hidePostsFromLowTrustUsers: "false" })
        .hidePostsFromLowTrustUsers
    ).toBe(false);
    expect(
      updateDefaultZapAmountSchema.parse({ defaultZapAmountSats: "21" })
        .defaultZapAmountSats
    ).toBe(21);
    expect(
      issues(
        updateDefaultZapAmountSchema.safeParse({ defaultZapAmountSats: 0 })
      )
    ).toContain("Too small");
    expect(
      issues(
        updateDefaultZapAmountSchema.safeParse({
          defaultZapAmountSats: 1_000_001,
        })
      )
    ).toContain("Too big");
    expect(updateNWCSchema.parse({}).nwcEnabled).toBe(false);
    expect(
      updateNWCSchema.parse({ nwcEnabled: "on", nwcString: "nwc" })
    ).toEqual({
      nwcEnabled: true,
      nwcString: "nwc",
    });
    expect(updateTagsSchema.parse({}).hashtags).toBeUndefined();
  });

  it.each(PLANS)("accepts plan %s for free switch and downgrade", (planId) => {
    expect(switchToFreePlanSchema.parse({ planId }).planId).toBe(planId);
    expect(scheduleDowngradeSchema.parse({ planId }).planId).toBe(planId);
  });

  it("accepts an empty cancel body and checks top-up durations", () => {
    expect(cancelAtPeriodEndSchema.parse({})).toEqual({});
    expect(
      topUpSubscriptionSchema.parse({
        targetPlanId: "pro",
        paymentLane: "lightning_one_time",
        accessDurationMonths: "1",
      })
    ).toMatchObject({ billingCadence: "monthly", accessDurationMonths: 1 });
    expect(
      topUpSubscriptionSchema.parse({
        targetPlanId: "founder",
        paymentLane: "nwc_auto_renew",
        billingCadence: "yearly",
        accessDurationMonths: 12,
      }).accessDurationMonths
    ).toBe(12);
    for (const months of [1, 3, 6]) {
      expect(
        topUpSubscriptionSchema.parse({
          targetPlanId: "creator",
          paymentLane: "lightning_one_time",
          billingCadence: "monthly",
          accessDurationMonths: months,
        }).accessDurationMonths
      ).toBe(months);
    }
    expect(
      issues(
        topUpSubscriptionSchema.safeParse({
          targetPlanId: "pro",
          paymentLane: "lightning_one_time",
          billingCadence: "yearly",
          accessDurationMonths: 6,
        })
      )
    ).toContain("Yearly top-ups must be 12 months");
    expect(
      issues(
        topUpSubscriptionSchema.safeParse({
          targetPlanId: "pro",
          paymentLane: "lightning_one_time",
          accessDurationMonths: 12,
        })
      )
    ).toContain("Monthly top-ups must be 1, 3, or 6 months");
    expect(
      issues(
        topUpSubscriptionSchema.safeParse({
          targetPlanId: "enterprise",
          paymentLane: "card",
          accessDurationMonths: "nope",
        })
      )
    ).toContain("Invalid option");
  });
});
