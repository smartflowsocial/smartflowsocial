import { describe, expect, it } from "vitest";

import {
  ACTIVE_PAYOUT_RESOLUTION_HOLD_MS,
  unpaidResolutionAllowed,
} from "~/features/payments/campaign-payout-resolution";

const NOW = 1_800_000_000_000;

describe("manual payout resolution", () => {
  it("refuses to release a payment that is still inside the wallet timeout", () => {
    expect(
      unpaidResolutionAllowed({
        status: "paying",
        attemptStartedAtMs: NOW - 1_000,
        nowMs: NOW,
      }).ok
    ).toBe(false);
    expect(
      unpaidResolutionAllowed({
        status: "unknown",
        attemptStartedAtMs: NOW - ACTIVE_PAYOUT_RESOLUTION_HOLD_MS + 1,
        nowMs: NOW,
      }).ok
    ).toBe(false);
  });

  it("allows a stale unknown attempt to be marked unpaid", () => {
    expect(
      unpaidResolutionAllowed({
        status: "unknown",
        attemptStartedAtMs: NOW - ACTIVE_PAYOUT_RESOLUTION_HOLD_MS,
        nowMs: NOW,
      })
    ).toEqual({ ok: true });
  });

  it("does not resolve a payout that is already paid or failed", () => {
    expect(
      unpaidResolutionAllowed({
        status: "paid",
        attemptStartedAtMs: NOW - ACTIVE_PAYOUT_RESOLUTION_HOLD_MS * 2,
        nowMs: NOW,
      }).ok
    ).toBe(false);
  });
});
