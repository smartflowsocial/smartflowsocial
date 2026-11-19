import { describe, expect, it } from "vitest";

import { appendGiveawayActivityLog } from "~/features/giveaway/giveaway-activity-log.server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function entries(value: unknown): Array<Record<string, unknown>> {
  if (!isUnknownArray(value)) return [];
  return value.filter(isRecord);
}

describe("appendGiveawayActivityLog", () => {
  it("starts a log when the stored value is not an array", () => {
    const created = entries(
      appendGiveawayActivityLog({ not: "array" }, "created", { id: "1" })
    );
    expect(created).toHaveLength(1);
    expect(created[0]?.["type"]).toBe("created");
    expect(created[0]?.["payload"]).toEqual({ id: "1" });
    expect(typeof created[0]?.["at"]).toBe("string");
    expect(String(created[0]?.["at"])).toContain("T");

    const fromNull = entries(appendGiveawayActivityLog(null, "created"));
    expect(fromNull).toHaveLength(1);
    expect(fromNull[0]?.["type"]).toBe("created");
    expect(fromNull[0]?.["payload"]).toBeUndefined();
  });

  it("appends to an existing array", () => {
    const first = appendGiveawayActivityLog(null, "created", { id: "1" });
    const next = entries(appendGiveawayActivityLog(first, "locked"));
    expect(next.map((entry) => entry["type"])).toEqual(["created", "locked"]);
    expect(next[1]?.["payload"]).toBeUndefined();
  });
});
