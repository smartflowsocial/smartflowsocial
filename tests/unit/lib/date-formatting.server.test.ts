import { describe, expect, it } from "vitest";

import { formatDateForServer } from "~/lib/date-formatting.server";

describe("formatDateForServer", () => {
  it("returns a dash for empty or invalid dates", () => {
    expect(formatDateForServer(null, "UTC", "24h")).toBe("-");
    expect(formatDateForServer(undefined, "UTC", "24h")).toBe("-");
    expect(formatDateForServer("", "UTC", "12h")).toBe("-");
    expect(formatDateForServer(new Date(Number.NaN), "UTC", "24h")).toBe("-");
    expect(formatDateForServer(0, "UTC", "24h")).toBe("-");
  });

  it("formats a Date, an ISO string, and a unix timestamp", () => {
    const date = new Date("2024-06-15T15:04:00.000Z");
    const fromDate = formatDateForServer(date, "UTC", "24h");
    const fromIso = formatDateForServer(
      date.toISOString(),
      "Europe/Berlin",
      "12h"
    );
    const fromUnix = formatDateForServer(
      Math.floor(date.getTime() / 1000),
      "UTC",
      "24h",
      { isUnixTimestamp: true, dateLocale: "en-US" }
    );
    const fromUnixString = formatDateForServer(
      String(Math.floor(date.getTime() / 1000)),
      "America/New_York",
      "12h",
      { isUnixTimestamp: true }
    );

    expect(fromDate).toContain("2024");
    expect(fromIso).toContain("2024");
    expect(fromUnix).toContain("2024");
    expect(fromUnixString).toContain("2024");
    expect(fromIso.toLowerCase()).toMatch(/am|pm/);
  });

  it("treats a plain number as a unix timestamp", () => {
    const formatted = formatDateForServer(1_718_460_240, "UTC", "24h", {
      isUnixTimestamp: false,
      dateFormatOptions: {
        year: "numeric",
        month: "short",
        day: "numeric",
      },
    });
    expect(formatted).toContain("2024");
  });

  it("falls back when the timestamp or timezone cannot be parsed", () => {
    expect(
      formatDateForServer("not-a-timestamp", "UTC", "24h", {
        isUnixTimestamp: true,
      })
    ).toBe("-");
    expect(formatDateForServer("not-a-date", "UTC", "24h")).toBe("-");
    expect(
      formatDateForServer(
        new Date("2024-01-02T03:04:00.000Z"),
        "Not/AZone",
        "24h"
      )
    ).not.toBe("");
  });
});
