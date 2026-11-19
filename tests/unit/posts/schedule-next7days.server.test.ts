import { beforeEach, describe, expect, it, vi } from "vitest";

interface RangeQuery {
  userId: string;
  queueType: string;
  fromUtc: Date;
  toUtc: Date;
}

interface RangedPost {
  scheduledAtUtc: Date | null;
  queueType: { name: string } | null;
}

interface TemporalModule {
  fromDate: (date: Date, timezone?: string) => unknown;
  toPrismaDate: (value: unknown) => Date | null;
}

const postsApi = vi.hoisted(() => ({
  getScheduledPostsInDateRange: vi.fn(
    async (_query: RangeQuery): Promise<RangedPost[]> => []
  ),
  getScheduledLongFormPostsInDateRange: vi.fn(
    async (_query: RangeQuery): Promise<RangedPost[]> => []
  ),
}));

const clock = vi.hoisted(() => ({ failDates: false }));

vi.mock("~/lib/temporal", async () => {
  const actual = await vi.importActual<TemporalModule>("~/lib/temporal");
  return {
    ...actual,
    nowInTimezone: (timezone: string) =>
      actual.fromDate(new Date("2026-03-10T15:00:00.000Z"), timezone),
    toPrismaDate: (value: unknown) =>
      clock.failDates ? null : actual.toPrismaDate(value),
  };
});
vi.mock("~/features/posts/server", () => postsApi);

import { getScheduleNext7DaysCounts } from "~/features/posts/services/schedule-next7days.server";
import {
  addDays,
  endOfDay,
  nowInTimezone,
  startOfDay,
  toPrismaDate,
} from "~/lib/temporal";

function expectedWindow(timezone: string): { fromUtc: Date; toUtc: Date } {
  const start = startOfDay(nowInTimezone(timezone), timezone);
  const end = endOfDay(addDays(start, 6), timezone);
  const fromUtc = toPrismaDate(start);
  const toUtc = toPrismaDate(end);
  if (!fromUtc || !toUtc) {
    throw new Error("expected a date window");
  }
  return { fromUtc, toUtc };
}

describe("next 7 day schedule counts", () => {
  beforeEach(() => {
    clock.failDates = false;
    postsApi.getScheduledPostsInDateRange.mockReset();
    postsApi.getScheduledPostsInDateRange.mockResolvedValue([]);
    postsApi.getScheduledLongFormPostsInDateRange.mockReset();
    postsApi.getScheduledLongFormPostsInDateRange.mockResolvedValue([]);
  });

  it("returns seven empty days when the date conversion fails", async () => {
    clock.failDates = true;
    const days = await getScheduleNext7DaysCounts("user-1", "Main", "UTC");
    expect(days).toEqual([
      { dateKey: "2026-03-10", count: 0, byQueue: [] },
      { dateKey: "2026-03-11", count: 0, byQueue: [] },
      { dateKey: "2026-03-12", count: 0, byQueue: [] },
      { dateKey: "2026-03-13", count: 0, byQueue: [] },
      { dateKey: "2026-03-14", count: 0, byQueue: [] },
      { dateKey: "2026-03-15", count: 0, byQueue: [] },
      { dateKey: "2026-03-16", count: 0, byQueue: [] },
    ]);
    expect(postsApi.getScheduledPostsInDateRange).not.toHaveBeenCalled();
    expect(
      postsApi.getScheduledLongFormPostsInDateRange
    ).not.toHaveBeenCalled();
  });

  it("counts posts and articles per day and queue", async () => {
    postsApi.getScheduledPostsInDateRange.mockResolvedValue([
      {
        scheduledAtUtc: new Date("2026-03-10T10:00:00.000Z"),
        queueType: { name: "Main" },
      },
      {
        scheduledAtUtc: new Date("2026-03-10T11:00:00.000Z"),
        queueType: { name: "Main" },
      },
      {
        scheduledAtUtc: new Date("2026-03-10T12:00:00.000Z"),
        queueType: null,
      },
      {
        scheduledAtUtc: null,
        queueType: { name: "Main" },
      },
      {
        scheduledAtUtc: new Date("2026-03-11T09:00:00.000Z"),
        queueType: { name: "Other" },
      },
      {
        scheduledAtUtc: new Date("2026-03-20T09:00:00.000Z"),
        queueType: { name: "Later" },
      },
    ]);
    postsApi.getScheduledLongFormPostsInDateRange.mockResolvedValue([
      {
        scheduledAtUtc: new Date("2026-03-11T15:00:00.000Z"),
        queueType: { name: "Main" },
      },
    ]);

    const days = await getScheduleNext7DaysCounts("user-1", "all", "UTC");
    expect(days.map((day) => [day.dateKey, day.count, day.byQueue])).toEqual([
      [
        "2026-03-10",
        3,
        [
          { queueName: "Main", count: 2 },
          { queueName: "Unassigned", count: 1 },
        ],
      ],
      [
        "2026-03-11",
        2,
        [
          { queueName: "Other", count: 1 },
          { queueName: "Main", count: 1 },
        ],
      ],
      ["2026-03-12", 0, []],
      ["2026-03-13", 0, []],
      ["2026-03-14", 0, []],
      ["2026-03-15", 0, []],
      ["2026-03-16", 0, []],
    ]);

    const window = expectedWindow("UTC");
    expect(postsApi.getScheduledPostsInDateRange).toHaveBeenCalledWith({
      userId: "user-1",
      queueType: "all",
      fromUtc: window.fromUtc,
      toUtc: window.toUtc,
    });
    expect(postsApi.getScheduledLongFormPostsInDateRange).toHaveBeenCalledWith({
      userId: "user-1",
      queueType: "all",
      fromUtc: window.fromUtc,
      toUtc: window.toUtc,
    });
  });

  it("uses Etc/UTC for a blank timezone and the user zone for date keys", async () => {
    postsApi.getScheduledPostsInDateRange.mockResolvedValue([
      {
        scheduledAtUtc: new Date("2026-03-10T10:00:00.000Z"),
        queueType: { name: "Main" },
      },
    ]);
    const utcDays = await getScheduleNext7DaysCounts("user-1", "Main", "");
    expect(utcDays[0]).toEqual({
      dateKey: "2026-03-10",
      count: 1,
      byQueue: [{ queueName: "Main", count: 1 }],
    });
    const blankWindow = expectedWindow("Etc/UTC");
    expect(postsApi.getScheduledPostsInDateRange).toHaveBeenCalledWith({
      userId: "user-1",
      queueType: "Main",
      fromUtc: blankWindow.fromUtc,
      toUtc: blankWindow.toUtc,
    });

    postsApi.getScheduledPostsInDateRange.mockResolvedValue([
      {
        scheduledAtUtc: new Date("2026-03-11T03:30:00.000Z"),
        queueType: { name: "Main" },
      },
      {
        scheduledAtUtc: new Date("2026-03-10T03:00:00.000Z"),
        queueType: { name: "Main" },
      },
    ]);
    const zoned = await getScheduleNext7DaysCounts(
      "user-1",
      "Main",
      "America/New_York"
    );
    expect(zoned[0]).toEqual({
      dateKey: "2026-03-10",
      count: 1,
      byQueue: [{ queueName: "Main", count: 1 }],
    });
    expect(zoned[1]?.count).toBe(0);
    const nyWindow = expectedWindow("America/New_York");
    expect(postsApi.getScheduledPostsInDateRange).toHaveBeenLastCalledWith({
      userId: "user-1",
      queueType: "Main",
      fromUtc: nyWindow.fromUtc,
      toUtc: nyWindow.toUtc,
    });
  });

  it("propagates range query failures", async () => {
    postsApi.getScheduledPostsInDateRange.mockRejectedValueOnce(
      new Error("posts down")
    );
    await expect(
      getScheduleNext7DaysCounts("user-1", "Main", "UTC")
    ).rejects.toThrow("posts down");
    postsApi.getScheduledLongFormPostsInDateRange.mockRejectedValueOnce(
      "articles down"
    );
    await expect(
      getScheduleNext7DaysCounts("user-1", "Main", "UTC")
    ).rejects.toBe("articles down");
  });
});
