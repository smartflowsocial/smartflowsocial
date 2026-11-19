import { describe, expect, it } from "vitest";

import {
  parseDateRangeInTimezone,
  parseDateRangeUtc,
} from "~/lib/date-range.server";

describe("parseDateRangeUtc", () => {
  it("returns undefined when both bounds are missing or invalid", () => {
    expect(parseDateRangeUtc()).toBeUndefined();
    expect(parseDateRangeUtc(null, null)).toBeUndefined();
    expect(parseDateRangeUtc(undefined, undefined)).toBeUndefined();
    expect(parseDateRangeUtc("  ", "")).toBeUndefined();
    expect(parseDateRangeUtc("not-a-date", "2024-13-01")).toBeUndefined();
    expect(parseDateRangeUtc("2024-02-30", "2023-02-29")).toBeUndefined();
    expect(parseDateRangeUtc("20240115", "15-01-2024")).toBeUndefined();
  });

  it("parses a single valid bound and ignores the invalid side", () => {
    expect(parseDateRangeUtc(" 2024-01-15 ", "2024-02-30")).toEqual({
      fromUtc: new Date("2024-01-15T00:00:00.000Z"),
      toUtc: undefined,
    });
    expect(parseDateRangeUtc("2023-02-29", "2024-02-29")).toEqual({
      fromUtc: undefined,
      toUtc: new Date("2024-02-29T23:59:59.999Z"),
    });
  });

  it("uses the UTC start and end of each calendar day", () => {
    expect(parseDateRangeUtc("2024-01-15", "2024-01-16")).toEqual({
      fromUtc: new Date("2024-01-15T00:00:00.000Z"),
      toUtc: new Date("2024-01-16T23:59:59.999Z"),
    });
  });
});

describe("parseDateRangeInTimezone", () => {
  it("returns undefined when both bounds are missing, invalid, or the zone is unknown", () => {
    expect(parseDateRangeInTimezone(null, null, "UTC")).toBeUndefined();
    expect(
      parseDateRangeInTimezone(undefined, undefined, "UTC")
    ).toBeUndefined();
    expect(parseDateRangeInTimezone(" ", "\t", "UTC")).toBeUndefined();
    expect(
      parseDateRangeInTimezone("2024-02-30", "nope", "UTC")
    ).toBeUndefined();
    expect(
      parseDateRangeInTimezone("2024-01-15", "2024-01-16", "Mars/Base")
    ).toBeUndefined();
  });

  it("treats a blank timezone as UTC and keeps a one-sided range", () => {
    expect(parseDateRangeInTimezone("2024-01-15", "2024-02-30", "   ")).toEqual(
      {
        fromUtc: new Date("2024-01-15T00:00:00.000Z"),
        toUtc: undefined,
      }
    );
    expect(parseDateRangeInTimezone("bad", "2024-02-29", "UTC")).toEqual({
      fromUtc: undefined,
      toUtc: new Date("2024-02-29T23:59:59.999Z"),
    });
  });

  it("converts the calendar day in the requested timezone to UTC", () => {
    expect(
      parseDateRangeInTimezone("2024-01-15", "2024-01-15", "America/New_York")
    ).toEqual({
      fromUtc: new Date("2024-01-15T05:00:00.000Z"),
      toUtc: new Date("2024-01-16T04:59:59.999Z"),
    });
    expect(parseDateRangeInTimezone("2024-06-01", "2024-06-01", "UTC")).toEqual(
      parseDateRangeUtc("2024-06-01", "2024-06-01")
    );
  });
});
