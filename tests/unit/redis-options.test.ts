import { describe, expect, it } from "vitest";

import {
  redisConnectionOptions,
  redisErrorsAreIgnored,
} from "~/infra/queue/redis-options";

describe("redis connection options", () => {
  it("fails fast only for unit tests", () => {
    const unit = redisConnectionOptions({ nodeEnv: "test" });
    expect(unit.connectTimeout).toBe(200);
    expect(unit.retryStrategy?.()).toBeNull();
    expect(redisErrorsAreIgnored({ nodeEnv: "test" })).toBe(true);
  });

  it("uses a normal timeout for e2e even when NODE_ENV is test", () => {
    const e2e = redisConnectionOptions({
      nodeEnv: "test",
      e2eTest: "true",
    });
    expect(e2e.connectTimeout).toBe(10_000);
    expect(e2e.retryStrategy).toBeUndefined();
    expect(redisErrorsAreIgnored({ nodeEnv: "test", e2eTest: "true" })).toBe(
      false
    );
  });

  it("uses a normal timeout in development and production", () => {
    expect(
      redisConnectionOptions({ nodeEnv: "development" }).connectTimeout
    ).toBe(10_000);
    expect(
      redisConnectionOptions({ nodeEnv: "production" }).connectTimeout
    ).toBe(10_000);
  });
});
