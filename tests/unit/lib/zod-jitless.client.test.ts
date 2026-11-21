import { afterAll, describe, expect, it } from "vitest";
import { config } from "zod";

import "~/lib/zod-jitless.client";

describe("zod jitless client", () => {
  afterAll(() => {
    config({ jitless: false });
  });

  it("disables the Function() schema compiler before hydration", () => {
    expect(config().jitless).toBe(true);
  });
});
