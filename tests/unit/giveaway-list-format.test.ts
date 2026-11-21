import { describe, expect, it } from "vitest";

import {
  formatGiveawayCount,
  formatGiveawayListDay,
} from "~/features/giveaway/giveaway-list-format";

describe("giveaway list labels", () => {
  const nearMidnightUtc = "2026-05-06T23:30:00.000Z";

  it("uses the same calendar day for a timezone on every call", () => {
    const london = formatGiveawayListDay(
      nearMidnightUtc,
      "Europe/London",
      "en-US"
    );
    expect(london).toBe("May 7");
    expect(
      formatGiveawayListDay(nearMidnightUtc, "Europe/London", "en-US")
    ).toBe(london);
    expect(formatGiveawayListDay(nearMidnightUtc, "UTC", "en-US")).toBe(
      "May 6"
    );
  });

  it("follows the account date locale instead of the machine locale", () => {
    expect(
      formatGiveawayListDay(nearMidnightUtc, "Europe/London", "en-GB")
    ).toBe("7 May");
  });

  it("formats counts with an explicit locale", () => {
    expect(formatGiveawayCount(1619, "en-GB")).toBe("1,619");
    expect(formatGiveawayCount(1619, "en-GB")).toBe(
      formatGiveawayCount(1619, "en-GB")
    );
  });

  it("returns a dash for an unreadable timestamp", () => {
    expect(formatGiveawayListDay("not-a-date", "UTC", "en-GB")).toBe("—");
  });
});
