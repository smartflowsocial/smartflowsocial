import { beforeEach, describe, expect, it, vi } from "vitest";

interface SchedulerClock {
  toDateMode: "real" | "invalid" | "past";
  createMode: "real" | "throw-error" | "throw-string" | "throw-utc";
  logThrows: "off" | "error" | "string";
  fromDateThrows: boolean;
}

interface LoggedError {
  message: string;
  context: string;
}

const clock = vi.hoisted((): SchedulerClock => ({
  toDateMode: "real",
  createMode: "real",
  logThrows: "off",
  fromDateThrows: false,
}));

const postsApi = vi.hoisted(() => ({
  getLastPostTimeForQueue: vi.fn(
    async (_args: {
      userId: string;
      queueTypeId: string;
      queueTypeName: string;
    }): Promise<Date | null> => null
  ),
}));

const users = vi.hoisted(() => ({
  getScheduleInterval: vi.fn(async (_userId: string): Promise<unknown> => [
    "4",
  ]),
}));

const logger = vi.hoisted(() => ({
  logError: vi.fn(
    (_error: unknown, context?: Record<string, unknown>): void => {
      const message = context?.["message"];
      if (
        clock.logThrows === "error" &&
        message === "Error in calculateNextScheduleTime"
      ) {
        throw new Error("logger down");
      }
      if (
        clock.logThrows === "string" &&
        message === "Error in calculateNextScheduleTime"
      ) {
        throw "logger down";
      }
    }
  ),
}));

vi.mock("~/features/posts/server", () => ({
  getLastPostTimeForQueue: postsApi.getLastPostTimeForQueue,
}));
vi.mock("~/features/user", () => ({
  getScheduleInterval: users.getScheduleInterval,
}));
vi.mock("~/lib/error-logger.server", () => logger);
interface ZonedStamp {
  epochMilliseconds: number;
}

interface TemporalApi {
  toDate: (value: ZonedStamp) => Date;
  fromDate: (date: Date, timezone?: string) => ZonedStamp;
  createZonedDateTime: (
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    timezone?: string
  ) => ZonedStamp;
}

vi.mock("~/lib/temporal", async (importOriginal) => {
  const loaded: unknown = await importOriginal();
  if (typeof loaded !== "object" || loaded === null) {
    throw new Error("Expected temporal module");
  }
  const actual = loaded as TemporalApi & Record<string, unknown>;
  return {
    ...actual,
    toDate: (value: ZonedStamp): Date => {
      if (clock.toDateMode === "invalid") return new Date(Number.NaN);
      if (clock.toDateMode === "past") {
        return new Date(Date.parse("2024-01-14T10:00:00.000Z"));
      }
      return actual.toDate(value);
    },
    fromDate: (date: Date, timezone = "UTC"): ZonedStamp => {
      if (timezone === "string-zone") throw "bad zone";
      if (clock.fromDateThrows) throw new Error("fromDate down");
      return actual.fromDate(date, timezone);
    },
    createZonedDateTime: (
      year: number,
      month: number,
      day: number,
      hour: number,
      minute: number,
      timezone = "UTC"
    ): ZonedStamp => {
      if (clock.createMode === "throw-error") throw new Error("slot failed");
      if (clock.createMode === "throw-string") throw "slot failed";
      if (clock.createMode === "throw-utc" && timezone === "UTC") {
        throw new Error("utc slot");
      }
      return actual.createZonedDateTime(
        year,
        month,
        day,
        hour,
        minute,
        timezone
      );
    },
  };
});
vi.mock("~/lib/prisma.server", async () => {
  const helpers = await import("../../utils/mock-helpers");
  return { prisma: helpers.createMockPrisma() };
});
vi.mock("~/infra/queue/queue-client.server", () => ({
  redis: {
    status: "ready",
    get: vi.fn(async (_key: string): Promise<null> => null),
    set: vi.fn(async (_key: string, _value: string): Promise<string> => "OK"),
    on: vi.fn(),
  },
}));

import { QueueTypeFactory } from "../../factories";
import { setupFetchMock, TEST_USER_ID } from "../../utils/mock-helpers";

import { calculateNextScheduleTime } from "~/features/posts/scheduling/services/schedulers";

const USER_ID = TEST_USER_ID;
const BASE = new Date("2024-01-15T10:00:00.000Z");
const PAST_DATE = new Date("2024-01-14T10:00:00.000Z");

function queue(
  configure: (factory: QueueTypeFactory) => QueueTypeFactory
): ReturnType<QueueTypeFactory["build"]> {
  return configure(
    new QueueTypeFactory({ id: "queue-1", name: "posts", userId: USER_ID })
  ).build();
}

function loggedErrors(): LoggedError[] {
  return logger.logError.mock.calls.map((call) => ({
    message: call[0] instanceof Error ? call[0].message : "",
    context: typeof call[1]?.["message"] === "string" ? call[1]["message"] : "",
  }));
}

async function withThrowingIncludes(
  thrown: Error | string,
  run: () => Promise<Date>
): Promise<Date> {
  const original = String.prototype.includes;
  String.prototype.includes = () => {
    throw thrown;
  };
  try {
    return await run();
  } finally {
    String.prototype.includes = original;
  }
}

describe("scheduler branches", () => {
  beforeEach(async () => {
    clock.toDateMode = "real";
    clock.createMode = "real";
    clock.logThrows = "off";
    clock.fromDateThrows = false;
    setupFetchMock();
    await import("~/lib/prisma.server");
    await import("~/infra/queue/queue-client.server");
    postsApi.getLastPostTimeForQueue.mockReset();
    postsApi.getLastPostTimeForQueue.mockResolvedValue(null);
    users.getScheduleInterval.mockReset();
    users.getScheduleInterval.mockResolvedValue(["4"]);
    logger.logError.mockClear();
  });

  it("uses now when base time is missing or invalid", async () => {
    const missing = await calculateNextScheduleTime({
      queueType: {
        id: "queue-1",
        name: "posts",
        scheduleType: "CUSTOM",
      },
      userId: USER_ID,
    });
    const delta = missing.getTime() - Date.now();
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(5_000);

    const invalid = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.withName("posts").asInterval(4)),
      userId: USER_ID,
      baseTime: new Date(Number.NaN),
    });
    expect(Number.isNaN(invalid.getTime())).toBe(false);
    expect(postsApi.getLastPostTimeForQueue).toHaveBeenCalledWith({
      userId: USER_ID,
      queueTypeId: "queue-1",
      queueTypeName: "posts",
    });
  });

  it("schedules interval modes from the last post, the default, and bad intervals", async () => {
    const last = new Date("2024-01-15T08:00:00.000Z");
    postsApi.getLastPostTimeForQueue.mockResolvedValue(last);
    const fourHours = await calculateNextScheduleTime({
      queueType: {
        id: "queue-1",
        name: "posts",
        scheduleType: "INTERVAL",
        scheduleConfig: null,
      },
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(fourHours.toISOString()).toBe("2024-01-15T12:00:00.000Z");

    const futureLast = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asInterval(4)),
      userId: USER_ID,
      baseTime: BASE,
    });
    postsApi.getLastPostTimeForQueue.mockResolvedValue(
      new Date("2024-01-15T12:00:00.000Z")
    );
    const afterFuture = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asInterval(4)),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(futureLast.toISOString()).toBe("2024-01-15T12:00:00.000Z");
    expect(afterFuture.toISOString()).toBe("2024-01-15T16:00:00.000Z");

    postsApi.getLastPostTimeForQueue.mockResolvedValue(last);
    const fractional = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asInterval(1.5)),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(fractional.toISOString()).toBe("2024-01-15T11:00:00.000Z");

    for (const intervalHours of [0, -2, Number.NaN]) {
      const fallback = await calculateNextScheduleTime({
        queueType: {
          id: "queue-1",
          name: "posts",
          scheduleType: "INTERVAL",
          scheduleConfig: { intervalHours },
        },
        userId: USER_ID,
        baseTime: BASE,
      });
      expect(fallback.toISOString()).toBe("2024-01-15T10:15:00.000Z");
    }

    postsApi.getLastPostTimeForQueue.mockResolvedValue(new Date(Number.NaN));
    const invalidLast = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asInterval(4)),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(invalidLast.toISOString()).toBe("2024-01-15T10:15:00.000Z");
  });

  it("reads the global interval and falls back when it is empty or throws", async () => {
    const last = new Date("2024-01-15T08:00:00.000Z");
    postsApi.getLastPostTimeForQueue.mockResolvedValue(last);
    users.getScheduleInterval.mockResolvedValueOnce(["6"]);
    const six = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asInterval(4, true)),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(six.toISOString()).toBe("2024-01-15T14:00:00.000Z");
    expect(users.getScheduleInterval).toHaveBeenCalledWith(USER_ID);

    users.getScheduleInterval.mockResolvedValueOnce([]);
    const empty = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asInterval(9, true)),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(empty.toISOString()).toBe("2024-01-15T12:00:00.000Z");

    users.getScheduleInterval.mockResolvedValueOnce("6");
    const notArray = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asInterval(9, true)),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(notArray.toISOString()).toBe("2024-01-15T12:00:00.000Z");

    users.getScheduleInterval.mockRejectedValueOnce(new Error("interval down"));
    const asError = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asInterval(9, true)),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(asError.toISOString()).toBe("2024-01-15T12:00:00.000Z");

    users.getScheduleInterval.mockRejectedValueOnce("interval string");
    const asString = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asInterval(9, true)),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(asString.toISOString()).toBe("2024-01-15T12:00:00.000Z");
    expect(loggedErrors().map((entry) => entry.message)).toEqual([
      "interval down",
      "interval string",
    ]);
    expect(
      loggedErrors().every(
        (entry) => entry.context === "Error getting schedule interval"
      )
    ).toBe(true);
  });

  it("picks fixed slots for today, tomorrow, and the next slot after a last post", async () => {
    const today = await calculateNextScheduleTime({
      queueType: queue((factory) =>
        factory.asFixedSlots([
          "09:00",
          "15:30",
          "bad",
          "25:00",
          "12:60",
          "10:30:00",
        ])
      ),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(today.toISOString()).toBe("2024-01-15T15:30:00.000Z");

    const tomorrow = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asFixedSlots(["09:00"])),
      userId: USER_ID,
      baseTime: new Date("2024-01-15T23:30:00.000Z"),
    });
    expect(tomorrow.toISOString()).toBe("2024-01-16T09:00:00.000Z");

    postsApi.getLastPostTimeForQueue.mockResolvedValue(
      new Date("2024-01-15T16:00:00.000Z")
    );
    const afterLast = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asFixedSlots(["09:00", "18:00"])),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(afterLast.toISOString()).toBe("2024-01-15T18:00:00.000Z");

    postsApi.getLastPostTimeForQueue.mockResolvedValue(
      new Date("2024-01-01T10:00:00.000Z")
    );
    const oldLast = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asFixedSlots(["11:00"])),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(oldLast.toISOString()).toBe("2024-01-15T11:00:00.000Z");

    const local = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asFixedSlots(["11:00"])),
      userId: USER_ID,
      userTimezone: "America/New_York",
      baseTime: new Date("2024-01-15T15:00:00.000Z"),
    });
    expect(local.toISOString()).toBe("2024-01-15T16:00:00.000Z");
  });

  it("falls back when slots are empty, invalid, or slot parsing throws", async () => {
    const empty = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asFixedSlots([])),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(empty.toISOString()).toBe("2024-01-15T10:00:01.000Z");

    const invalid = await calculateNextScheduleTime({
      queueType: {
        id: "queue-1",
        name: "posts",
        scheduleType: "FIXED_SLOTS",
        scheduleConfig: { slots: [930, "no-colon"] },
      },
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(invalid.toISOString()).toBe("2024-01-15T10:00:01.000Z");

    const fromError = await withThrowingIncludes(new Error("slot parse"), () =>
      calculateNextScheduleTime({
        queueType: queue((factory) => factory.asFixedSlots(["09:00"])),
        userId: USER_ID,
        baseTime: BASE,
      })
    );
    expect(fromError.toISOString()).toBe("2024-01-15T10:00:01.000Z");

    const fromString = await withThrowingIncludes("slot string", () =>
      calculateNextScheduleTime({
        queueType: queue((factory) => factory.asFixedSlots(["09:00"])),
        userId: USER_ID,
        baseTime: BASE,
      })
    );
    expect(fromString.toISOString()).toBe("2024-01-15T10:00:01.000Z");
    expect(loggedErrors().map((entry) => entry.context)).toEqual([
      "Error parsing slot",
      "Error parsing slot",
    ]);
    expect(loggedErrors().map((entry) => entry.message)).toEqual([
      "slot parse",
      "slot string",
    ]);
  });

  it("uses the UTC fallback when a timezone throws and returns the final slot fallback", async () => {
    postsApi.getLastPostTimeForQueue.mockResolvedValue(
      new Date("2024-01-15T09:00:00.000Z")
    );
    const zoned = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asFixedSlots(["11:00"])),
      userId: USER_ID,
      userTimezone: "explode",
      baseTime: BASE,
    });
    expect(zoned.toISOString()).toBe("2024-01-15T11:00:00.000Z");
    expect(loggedErrors()[0]?.context).toBe(
      "Error in createSlotInUserTimezone"
    );

    logger.logError.mockClear();
    clock.createMode = "throw-utc";
    postsApi.getLastPostTimeForQueue.mockResolvedValue(
      new Date("2024-01-15T12:00:00.000Z")
    );
    const bothFail = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asFixedSlots(["11:00"])),
      userId: USER_ID,
      userTimezone: "string-zone",
      baseTime: BASE,
    });
    expect(bothFail.toISOString()).toBe("2024-01-15T10:00:01.000Z");
    expect(loggedErrors().some((entry) => entry.message === "bad zone")).toBe(
      true
    );

    clock.createMode = "real";
    clock.toDateMode = "past";
    postsApi.getLastPostTimeForQueue.mockResolvedValue(
      new Date("2024-01-16T10:00:00.000Z")
    );
    const pastSlots = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asFixedSlots(["11:00", "18:00"])),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(pastSlots.toISOString()).toBe(PAST_DATE.toISOString());
  });

  it("picks the next weekly slot, skips duplicates, and ignores invalid rows", async () => {
    const monday = await calculateNextScheduleTime({
      queueType: queue((factory) =>
        factory.asWeeklySlots([
          { dayOfWeek: 1, time: "09:00" },
          { dayOfWeek: 1, time: "09:00" },
          { dayOfWeek: 8, time: "09:00" },
          { dayOfWeek: 1.5, time: "09:00" },
          { dayOfWeek: 2, time: "bad" },
          { dayOfWeek: 2, time: "09" },
        ])
      ),
      userId: USER_ID,
      baseTime: new Date("2024-01-18T12:00:00.000Z"),
    });
    expect(monday.toISOString()).toBe("2024-01-22T09:00:00.000Z");

    const sunday = await calculateNextScheduleTime({
      queueType: queue((factory) =>
        factory.asWeeklySlots([{ dayOfWeek: 0, time: "08:30" }])
      ),
      userId: USER_ID,
      baseTime: new Date("2024-01-21T10:00:00.000Z"),
    });
    expect(sunday.toISOString()).toBe("2024-01-28T08:30:00.000Z");

    postsApi.getLastPostTimeForQueue.mockResolvedValue(
      new Date("2024-01-21T09:00:00.000Z")
    );
    const afterLast = await calculateNextScheduleTime({
      queueType: queue((factory) =>
        factory.asWeeklySlots([{ dayOfWeek: 0, time: "08:30" }])
      ),
      userId: USER_ID,
      baseTime: new Date("2024-01-21T00:00:00.000Z"),
    });
    expect(afterLast.toISOString()).toBe("2024-01-28T08:30:00.000Z");
  });

  it("falls back when weekly slots are empty or datetime creation throws", async () => {
    const empty = await calculateNextScheduleTime({
      queueType: {
        id: "queue-1",
        name: "posts",
        scheduleType: "WEEKLY_SLOTS",
        scheduleConfig: null,
      },
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(empty.toISOString()).toBe("2024-01-15T10:00:01.000Z");

    clock.createMode = "throw-error";
    const asError = await calculateNextScheduleTime({
      queueType: queue((factory) =>
        factory.asWeeklySlots([{ dayOfWeek: 1, time: "09:00" }])
      ),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(asError.toISOString()).toBe("2024-01-15T10:00:01.000Z");

    clock.createMode = "throw-string";
    const asString = await calculateNextScheduleTime({
      queueType: queue((factory) =>
        factory.asWeeklySlots([{ dayOfWeek: 1, time: "09:00" }])
      ),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(asString.toISOString()).toBe("2024-01-15T10:00:01.000Z");
    expect(
      loggedErrors().every(
        (entry) => entry.context === "Error creating weekly slot datetime"
      )
    ).toBe(true);
    expect(
      loggedErrors().some((entry) => entry.message === "slot failed")
    ).toBe(true);
  });

  it("falls back for a missing schedule type and for an unknown mode", async () => {
    const missingType = await calculateNextScheduleTime({
      queueType: { id: "queue-1", name: "posts" },
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(missingType.toISOString()).toBe("2024-01-15T10:00:01.000Z");
    expect(
      loggedErrors().some((entry) => entry.message === "Invalid queueType")
    ).toBe(true);

    logger.logError.mockClear();
    const custom = await calculateNextScheduleTime({
      queueType: {
        id: "queue-1",
        name: "posts",
        scheduleType: "CUSTOM",
        scheduleConfig: null,
      },
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(custom.toISOString()).toBe("2024-01-15T10:00:01.000Z");
    expect(logger.logError).not.toHaveBeenCalled();

    const asText = await calculateNextScheduleTime({
      queueType: "posts" as unknown as { id: string; name: string },
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(asText.toISOString()).toBe("2024-01-15T10:00:01.000Z");
  });

  it("keeps going when the last-post lookup throws an Error or a string", async () => {
    postsApi.getLastPostTimeForQueue.mockRejectedValueOnce(
      new Error("last down")
    );
    const asError = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asInterval(4)),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(asError.toISOString()).toBe("2024-01-15T10:15:00.000Z");

    postsApi.getLastPostTimeForQueue.mockRejectedValueOnce("last string");
    const asString = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asInterval(4)),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(asString.toISOString()).toBe("2024-01-15T10:15:00.000Z");
    expect(loggedErrors().map((entry) => entry.message)).toEqual([
      "last down",
      "last string",
    ]);
    expect(
      loggedErrors().every(
        (entry) => entry.context === "Error getting last post time"
      )
    ).toBe(true);
  });

  it("returns the base time when the calculated date is invalid or the logger throws", async () => {
    clock.toDateMode = "invalid";
    const invalid = await calculateNextScheduleTime({
      queueType: {
        id: "queue-1",
        name: "posts",
        scheduleType: "CUSTOM",
      },
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(invalid.toISOString()).toBe(BASE.toISOString());
    expect(
      loggedErrors().some((entry) =>
        entry.message.includes("Invalid date returned")
      )
    ).toBe(true);

    clock.toDateMode = "real";
    clock.fromDateThrows = true;
    clock.logThrows = "error";
    const loggerError = await calculateNextScheduleTime({
      queueType: queue((factory) => factory.asInterval(4)),
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(loggerError.toISOString()).toBe(BASE.toISOString());

    clock.logThrows = "string";
    const loggerString = await calculateNextScheduleTime({
      queueType: { name: "posts", scheduleType: "INTERVAL", id: "queue-1" },
      userId: USER_ID,
      baseTime: BASE,
    });
    expect(loggerString.toISOString()).toBe(BASE.toISOString());
    expect(
      loggedErrors().some(
        (entry) =>
          entry.context === "Error in calculateNextScheduleTime wrapper"
      )
    ).toBe(true);
  });
});
