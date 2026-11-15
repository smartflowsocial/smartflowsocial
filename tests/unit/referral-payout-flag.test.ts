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

  it("keeps an existing production wallet install on until the flag is set", () => {
    const decision = decideReferralPayouts(undefined, {
      nodeEnv: "production",
      ownerNwc: "nostr+walletconnect://present",
    });
    expect(decision.enabled).toBe(true);
    expect(decision.implicitProduction).toBe(true);
  });

  it("does not use the production compatibility path without a wallet", () => {
    const decision = decideReferralPayouts("   ", {
      nodeEnv: "production",
      ownerNwc: "  ",
    });
    expect(decision.enabled).toBe(false);
    expect(decision.implicitProduction).toBe(false);
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
