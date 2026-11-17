import { describe, expect, it } from "vitest";

import { decideReferralPayouts } from "~/features/referral/referral-payout-flag";

describe("referral payout flag", () => {
  it("stays off when the flag is missing, even with a wallet", () => {
    expect(
      decideReferralPayouts(undefined, {
        nodeEnv: "development",
        ownerNwc: "nostr+walletconnect://present",
      }).enabled
    ).toBe(false);
    expect(decideReferralPayouts(undefined, { nodeEnv: "test" }).enabled).toBe(
      false
    );
  });

  it("stays off for false, invalid, and conflicting values", () => {
    expect(decideReferralPayouts("false").enabled).toBe(false);
    expect(decideReferralPayouts("no").enabled).toBe(false);
    expect(
      decideReferralPayouts("true ", {
        ownerNwc: "",
      }).enabled
    ).toBe(true);
    expect(
      decideReferralPayouts("maybe", {
        nodeEnv: "production",
        ownerNwc: "nostr+walletconnect://present",
      }).enabled
    ).toBe(false);
  });

  it("stays off in production when the flag is unset, even with a wallet", () => {
    const decision = decideReferralPayouts(undefined, {
      nodeEnv: "production",
      ownerNwc: "nostr+walletconnect://present",
    });
    expect(decision.enabled).toBe(false);
  });

  it("stays off for blank production values", () => {
    const decision = decideReferralPayouts("   ", {
      nodeEnv: "production",
      ownerNwc: "  ",
    });
    expect(decision.enabled).toBe(false);
  });

  it("turns on for the explicit values only", () => {
    expect(decideReferralPayouts("true").enabled).toBe(true);
    expect(decideReferralPayouts("1").enabled).toBe(true);
    expect(decideReferralPayouts("yes").enabled).toBe(true);
    expect(decideReferralPayouts(" TRUE ").enabled).toBe(true);
  });

  it("lets an explicit false override a configured production wallet", () => {
    expect(
      decideReferralPayouts("false", {
        nodeEnv: "production",
        ownerNwc: "nostr+walletconnect://present",
      }).enabled
    ).toBe(false);
  });
});
