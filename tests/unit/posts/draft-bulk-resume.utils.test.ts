import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const errors = vi.hoisted(() => ({
  handleErrorSafely: vi.fn(
    (_error: unknown, _context?: { component?: string; action?: string }) =>
      undefined
  ),
}));

vi.mock("~/lib/error-handler.client", () => ({
  handleErrorSafely: errors.handleErrorSafely,
}));

import {
  applyOffsetAndFormat,
  applyScheduleOffset,
  fetchScheduledTime,
  formatForDateTimeLocalExport,
  getIntervalHours,
} from "~/features/posts/drafts/utils/draft-bulk-resume.utils";
import type { QueueType } from "~/features/posts/types";
import { fromDate } from "~/lib/temporal";

const BASE = new Date("2024-03-08T12:00:00.000Z");

function isQueueType(_value: unknown): _value is QueueType {
  return true;
}

function queue(fields: {
  scheduleType?: QueueType["scheduleType"];
  scheduleConfig?: QueueType["scheduleConfig"];
  includeScheduleType?: boolean;
}): QueueType {
  const value: QueueType = {
    id: "queue-1",
    name: "Queue",
  };
  if (fields.includeScheduleType !== false && fields.scheduleType) {
    value.scheduleType = fields.scheduleType;
  }
  if (fields.scheduleConfig) {
    value.scheduleConfig = fields.scheduleConfig;
  }
  return value;
}

describe("draft bulk resume helpers", () => {
  describe("getIntervalHours", () => {
    it("returns 4 for a config that is not an interval", () => {
      expect(getIntervalHours(null, null)).toBe(4);
      expect(getIntervalHours({ slots: ["09:00"] }, null)).toBe(4);
      expect(getIntervalHours({ weeklySlots: [] }, null)).toBe(4);
      expect(getIntervalHours("daily", null)).toBe(4);
    });

    it("uses the configured hours, including zero, or 4 when unset", () => {
      expect(getIntervalHours({ intervalHours: 2 }, null)).toBe(2);
      expect(getIntervalHours({ intervalHours: 0 }, null)).toBe(0);
      expect(getIntervalHours({ useGlobalInterval: false }, null)).toBe(4);
      expect(getIntervalHours({ intervalHours: 1.5 }, null)).toBe(1.5);
    });

    it("reads the user interval when the queue uses the global interval", () => {
      expect(getIntervalHours({ useGlobalInterval: true }, null)).toBe(4);
      expect(
        getIntervalHours({ useGlobalInterval: true }, { scheduleInterval: [] })
      ).toBe(4);
      expect(getIntervalHours({ useGlobalInterval: true }, {})).toBe(4);
      expect(
        getIntervalHours({ useGlobalInterval: true }, { scheduleInterval: "6" })
      ).toBe(4);
      expect(
        getIntervalHours({ useGlobalInterval: true }, { scheduleInterval: [6] })
      ).toBe(6);
      expect(
        getIntervalHours(
          { useGlobalInterval: true },
          { scheduleInterval: ["3"] }
        )
      ).toBe(3);
      expect(
        getIntervalHours(
          { useGlobalInterval: true },
          { scheduleInterval: ["0"] }
        )
      ).toBe(4);
      expect(
        getIntervalHours({ useGlobalInterval: true }, { scheduleInterval: [0] })
      ).toBe(4);
      expect(
        getIntervalHours(
          { useGlobalInterval: true },
          { scheduleInterval: [-2] }
        )
      ).toBe(-2);
      expect(
        getIntervalHours(
          { useGlobalInterval: true },
          { scheduleInterval: ["nope"] }
        )
      ).toBe(4);
      expect(
        getIntervalHours(
          { useGlobalInterval: true },
          { scheduleInterval: [true] }
        )
      ).toBe(4);
    });
  });

  describe("applyScheduleOffset", () => {
    const user = { timezone: "UTC", scheduleInterval: [6] };

    it("returns the base date for the first row or a queue without a schedule", () => {
      const interval = queue({
        scheduleType: "INTERVAL",
        scheduleConfig: { intervalHours: 4 },
      });
      expect(applyScheduleOffset(BASE, 0, interval, user)).toEqual(BASE);

      const bare = queue({ includeScheduleType: false });
      expect(applyScheduleOffset(BASE, 1, bare, user)).toEqual(BASE);

      const emptyType: unknown = { id: "q", name: "Q", scheduleType: "" };
      if (!isQueueType(emptyType)) throw new Error("expected queue");
      expect(applyScheduleOffset(BASE, 1, emptyType, user)).toEqual(BASE);

      const numeric: unknown = 4;
      if (!isQueueType(numeric)) throw new Error("expected queue");
      expect(applyScheduleOffset(BASE, 1, numeric, user)).toEqual(BASE);
    });

    it("offsets an interval from the queue or the user", () => {
      const fromQueue = queue({
        scheduleType: "INTERVAL",
        scheduleConfig: { intervalHours: 2 },
      });
      expect(applyScheduleOffset(BASE, 1, fromQueue, user).toISOString()).toBe(
        "2024-03-08T14:00:00.000Z"
      );
      expect(applyScheduleOffset(BASE, 2, fromQueue, user).toISOString()).toBe(
        "2024-03-08T16:00:00.000Z"
      );

      const fractional = queue({
        scheduleType: "INTERVAL",
        scheduleConfig: { intervalHours: 1.5 },
      });
      expect(applyScheduleOffset(BASE, 1, fractional, user).toISOString()).toBe(
        "2024-03-08T13:30:00.000Z"
      );

      const globalInterval = queue({
        scheduleType: "INTERVAL",
        scheduleConfig: { useGlobalInterval: true },
      });
      expect(
        applyScheduleOffset(BASE, 1, globalInterval, user).toISOString()
      ).toBe("2024-03-08T18:00:00.000Z");

      const missingConfig = queue({ scheduleType: "INTERVAL" });
      expect(
        applyScheduleOffset(BASE, 1, missingConfig, null).toISOString()
      ).toBe("2024-03-08T16:00:00.000Z");
    });

    it("walks fixed slots, including wrap, empty, and unparsed times", () => {
      const slots = queue({
        scheduleType: "FIXED_SLOTS",
        scheduleConfig: { slots: ["14:00", "09:00"] },
      });
      const morning = new Date("2024-03-08T08:00:00.000Z");
      expect(applyScheduleOffset(morning, 1, slots, user).toISOString()).toBe(
        "2024-03-08T14:00:00.000Z"
      );
      expect(applyScheduleOffset(morning, 3, slots, user).toISOString()).toBe(
        "2024-03-09T14:00:00.000Z"
      );

      const noon = new Date("2024-03-08T10:00:00.000Z");
      expect(applyScheduleOffset(noon, 2, slots, user).toISOString()).toBe(
        "2024-03-09T14:00:00.000Z"
      );

      const afterLast = new Date("2024-03-08T15:00:00.000Z");
      expect(applyScheduleOffset(afterLast, 1, slots, user).toISOString()).toBe(
        "2024-03-08T14:00:00.000Z"
      );

      const bareSlot = queue({
        scheduleType: "FIXED_SLOTS",
        scheduleConfig: { slots: ["9"] },
      });
      expect(
        applyScheduleOffset(morning, 1, bareSlot, user).toISOString()
      ).toBe("2024-03-09T09:00:00.000Z");

      const empty = queue({
        scheduleType: "FIXED_SLOTS",
        scheduleConfig: { slots: [] },
      });
      expect(applyScheduleOffset(BASE, 1, empty, user)).toEqual(BASE);

      const notFixed = queue({
        scheduleType: "FIXED_SLOTS",
        scheduleConfig: { useGlobalInterval: true },
      });
      expect(applyScheduleOffset(BASE, 1, notFixed, user)).toEqual(BASE);
    });

    it("moves to the next weekly slot and ignores slots that cannot be parsed", () => {
      const weekly = queue({
        scheduleType: "WEEKLY_SLOTS",
        scheduleConfig: {
          weeklySlots: [{ dayOfWeek: 5, time: "15:00" }],
        },
      });
      expect(applyScheduleOffset(BASE, 1, weekly, user).toISOString()).toBe(
        "2024-03-08T15:00:00.000Z"
      );
      expect(applyScheduleOffset(BASE, 2, weekly, user).toISOString()).toBe(
        "2024-03-15T15:00:00.000Z"
      );

      const sunday = queue({
        scheduleType: "WEEKLY_SLOTS",
        scheduleConfig: {
          weeklySlots: [
            { dayOfWeek: 9, time: "15:00" },
            { dayOfWeek: -1, time: "10:00" },
            { dayOfWeek: 0, time: "24:00" },
            { dayOfWeek: 0, time: "12:60" },
            { dayOfWeek: 0, time: "ab" },
            { dayOfWeek: 0, time: "09:00" },
          ],
        },
      });
      const thursday = new Date("2024-03-07T10:00:00.000Z");
      expect(applyScheduleOffset(thursday, 1, sunday, user).toISOString()).toBe(
        "2024-03-10T09:00:00.000Z"
      );
      const sundayMorning = new Date("2024-03-10T10:00:00.000Z");
      expect(
        applyScheduleOffset(sundayMorning, 1, sunday, user).toISOString()
      ).toBe("2024-03-17T09:00:00.000Z");

      const none = queue({
        scheduleType: "WEEKLY_SLOTS",
        scheduleConfig: { weeklySlots: [] },
      });
      expect(applyScheduleOffset(BASE, 1, none, user)).toEqual(BASE);

      const intervalShaped = queue({
        scheduleType: "WEEKLY_SLOTS",
        scheduleConfig: { intervalHours: 2 },
      });
      expect(applyScheduleOffset(BASE, 1, intervalShaped, user)).toEqual(BASE);

      const badZone = queue({
        scheduleType: "WEEKLY_SLOTS",
        scheduleConfig: {
          weeklySlots: [{ dayOfWeek: 5, time: "15:00" }],
        },
      });
      expect(() =>
        applyScheduleOffset(BASE, 1, badZone, { timezone: "Not/AZone" })
      ).toThrow(RangeError);
      expect(
        applyScheduleOffset(BASE, 1, weekly, { timezone: null }).toISOString()
      ).toBe("2024-03-08T15:00:00.000Z");
    });
  });

  describe("formatting", () => {
    it("formats a zoned time and applies an offset before formatting", () => {
      const zoned = fromDate(new Date("2024-03-08T14:30:00.000Z"), "UTC");
      expect(formatForDateTimeLocalExport(zoned, "UTC")).toBe(
        "2024-03-08T14:30"
      );

      const interval = queue({
        scheduleType: "INTERVAL",
        scheduleConfig: { intervalHours: 2 },
      });
      expect(
        applyOffsetAndFormat("2024-03-08T12:00", 0, interval, {
          timezone: null,
        })
      ).toBe("2024-03-08T12:00");
      expect(
        applyOffsetAndFormat("2024-03-08T12:00", 1, interval, {
          timezone: "UTC",
        })
      ).toBe("2024-03-08T14:00");
    });
  });

  describe("fetchScheduledTime", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      errors.handleErrorSafely.mockClear();
      globalThis.fetch = vi.fn<typeof fetch>();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("returns null without calling the network for an empty queue", async () => {
      await expect(fetchScheduledTime(null, "user-1")).resolves.toBeNull();
      await expect(
        fetchScheduledTime("unassigned", "user-1")
      ).resolves.toBeNull();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("returns the scheduled time from a successful response", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ scheduledTime: "2024-03-08T15:00" }), {
          status: 200,
        })
      );
      await expect(fetchScheduledTime("queue-1", "user-1")).resolves.toBe(
        "2024-03-08T15:00"
      );
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/queue-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueTypeId: "queue-1", userId: "user-1" }),
      });

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ scheduledTime: "2024-03-08T16:00" }), {
          status: 200,
        })
      );
      await fetchScheduledTime("queue-1", undefined);
      expect(vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[1]?.body).toBe(
        JSON.stringify({ queueTypeId: "queue-1" })
      );
    });

    it("returns null for a bad status or a body without a string time", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("no", { status: 500 })
      );
      await expect(fetchScheduledTime("queue-1", "user-1")).resolves.toBeNull();

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("{}", { status: 200 })
      );
      await expect(fetchScheduledTime("queue-1", "user-1")).resolves.toBeNull();

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ scheduledTime: 5 }), { status: 200 })
      );
      await expect(fetchScheduledTime("queue-1", "user-1")).resolves.toBeNull();

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("[]", { status: 200 })
      );
      await expect(fetchScheduledTime("queue-1", "user-1")).resolves.toBeNull();

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("null", { status: 200 })
      );
      await expect(fetchScheduledTime("queue-1", "user-1")).resolves.toBeNull();
    });

    it("logs Error and string failures and returns null", async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("offline"));
      await expect(fetchScheduledTime("queue-1", "user-1")).resolves.toBeNull();
      vi.mocked(globalThis.fetch).mockRejectedValueOnce("offline");
      await expect(fetchScheduledTime("queue-1", "user-1")).resolves.toBeNull();
      expect(errors.handleErrorSafely).toHaveBeenNthCalledWith(
        1,
        new Error("offline"),
        { component: "DraftBulkResume", action: "fetchScheduledTime" }
      );
      expect(errors.handleErrorSafely).toHaveBeenNthCalledWith(2, "offline", {
        component: "DraftBulkResume",
        action: "fetchScheduledTime",
      });

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("not-json", { status: 200 })
      );
      await expect(fetchScheduledTime("queue-1", "user-1")).resolves.toBeNull();
      expect(errors.handleErrorSafely).toHaveBeenCalledTimes(3);
    });
  });
});
