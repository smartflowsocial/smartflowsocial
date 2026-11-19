import { beforeEach, describe, expect, it, vi } from "vitest";

const entitlements = vi.hoisted(() => ({
  getEffectiveBroadcastPlanLimits: vi.fn(),
  getEffectivePlanEntitlements: vi.fn(),
}));

vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => entitlements
);

import {
  getBroadcastMessageLintWarnings,
  largeAudienceWarningThreshold,
  looksSpammyMessage,
  shouldPauseForFailureRate,
} from "~/features/broadcast/broadcast-guardrails.server";

describe("looksSpammyMessage", () => {
  it("rejects short bodies before counting words", () => {
    expect(looksSpammyMessage("too short")).toBe(false);
    expect(looksSpammyMessage("   hi   ")).toBe(false);
  });

  it("rejects long bodies that still have fewer than six words", () => {
    expect(looksSpammyMessage("abcdefghij klmnopqrst uvwxyz")).toBe(false);
  });

  it("ignores repeated words shorter than four characters", () => {
    expect(looksSpammyMessage("the the the the the the the and and and")).toBe(
      false
    );
  });

  it("flags a word of at least four characters repeated five times", () => {
    expect(looksSpammyMessage("Spam spam SPAM sPaM spam extra")).toBe(true);
  });

  it("allows a long message whose words are not repeated five times", () => {
    expect(looksSpammyMessage("spam spam spam spam other words here now")).toBe(
      false
    );
    expect(
      looksSpammyMessage(
        "alpha bravo charlie delta echo foxtrot golf hotel india"
      )
    ).toBe(false);
  });
});

describe("largeAudienceWarningThreshold", () => {
  beforeEach(() => {
    entitlements.getEffectiveBroadcastPlanLimits.mockReset();
  });

  it("uses 500 when the plan has no recipient cap", () => {
    entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue({
      maxRecipientsPerCampaign: null,
    });

    expect(largeAudienceWarningThreshold("pro")).toBe(500);
    expect(entitlements.getEffectiveBroadcastPlanLimits).toHaveBeenCalledWith(
      "pro"
    );
  });

  it("floors half the numeric cap and never goes below 50", () => {
    entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue({
      maxRecipientsPerCampaign: 75,
    });
    expect(largeAudienceWarningThreshold("starter")).toBe(50);

    entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue({
      maxRecipientsPerCampaign: 201,
    });
    expect(largeAudienceWarningThreshold("founder")).toBe(100);
    expect(entitlements.getEffectiveBroadcastPlanLimits).toHaveBeenCalledWith(
      "founder"
    );
  });
});

describe("shouldPauseForFailureRate", () => {
  it("does not pause before ten attempts", () => {
    expect(
      shouldPauseForFailureRate({
        attempted: 9,
        failed: 9,
        thresholdPercent: 1,
      })
    ).toBe(false);
  });

  it("does not pause when the failure rate is below the threshold", () => {
    expect(
      shouldPauseForFailureRate({
        attempted: 10,
        failed: 4,
        thresholdPercent: 50,
      })
    ).toBe(false);
  });

  it("pauses when the failure rate is exactly the threshold", () => {
    expect(
      shouldPauseForFailureRate({
        attempted: 10,
        failed: 5,
        thresholdPercent: 50,
      })
    ).toBe(true);
  });
});

describe("getBroadcastMessageLintWarnings re-export", () => {
  it("returns lint warnings from the real helper", () => {
    expect(getBroadcastMessageLintWarnings("")).toEqual([]);
    expect(getBroadcastMessageLintWarnings("hi")).toEqual([
      {
        level: "warning",
        message:
          "This message is very short and may feel low-context to recipients.",
      },
      {
        level: "warning",
        message:
          "This message is mostly a link or nearly empty - recipients may not understand why you wrote.",
      },
    ]);
  });
});
