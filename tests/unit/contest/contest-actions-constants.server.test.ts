import { describe, expect, it } from "vitest";

import { DEFAULT_TIE_BREAK_RULE } from "~/features/contest/contest-actions-constants.server";

describe("DEFAULT_TIE_BREAK_RULE", () => {
  it("orders by metric, earlier reply, then event id", () => {
    expect(DEFAULT_TIE_BREAK_RULE).toBe(
      "primary metric desc, earlier reply timestamp asc, entry event id lexicographic asc"
    );
  });
});
