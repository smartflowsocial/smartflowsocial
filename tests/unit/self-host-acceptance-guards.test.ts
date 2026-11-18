import { describe, expect, it } from "vitest";

import {
  databaseNameAccepted,
  redisIsolationProblem,
} from "../../scripts/self-host-acceptance-guards.mjs";

describe("self-host acceptance guards", () => {
  it("accepts disposable database names and refuses the development database", () => {
    expect(databaseNameAccepted("cleanroom")).toBe(true);
    expect(databaseNameAccepted("smartflow_test")).toBe(true);
    expect(databaseNameAccepted("postgres")).toBe(false);
    expect(databaseNameAccepted("smartflow")).toBe(false);
  });

  it("refuses the development Redis port unless the caller isolates it", () => {
    expect(redisIsolationProblem("redis://127.0.0.1:6379", {})).toMatch(/6379/);
    expect(redisIsolationProblem("redis://127.0.0.1:6380", {})).toBeNull();
    expect(
      redisIsolationProblem("redis://127.0.0.1:6379", {
        CLEAN_ROOM_REDIS: "isolated",
      })
    ).toBeNull();
    expect(
      redisIsolationProblem("redis://127.0.0.1:6379", { CI: "true" })
    ).toBeNull();
  });
});
