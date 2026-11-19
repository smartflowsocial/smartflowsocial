import { describe, expect, it } from "vitest";

import { appendContestActivityLog } from "~/features/contest/contest-activity-log.server";

interface ActivityEvent {
  at: string;
  type: string;
  payload?: Record<string, unknown>;
}

function asEvents(value: unknown): ActivityEvent[] {
  if (!Array.isArray(value)) {
    throw new Error("expected activity log array");
  }
  return value as ActivityEvent[];
}

describe("appendContestActivityLog", () => {
  it("starts a log from a non-array and drops entries that are not objects", () => {
    const events = asEvents(
      appendContestActivityLog(
        [null, "skip", 4, { type: "kept", at: "then" }, ["nested"]],
        "created"
      )
    );

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: "kept", at: "then" });
    expect(Array.isArray(events[1])).toBe(true);
    expect(events[2]?.type).toBe("created");
    expect(events[2]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(events[2]).not.toHaveProperty("payload");
  });

  it("appends a payload when one is provided and ignores a non-array current log", () => {
    const events = asEvents(
      appendContestActivityLog("nope", "paid", { sats: 25 })
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("paid");
    expect(events[0]?.payload).toEqual({ sats: 25 });
  });
});
