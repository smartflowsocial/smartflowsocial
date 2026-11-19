import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  broadcastCampaign: {
    findMany: vi.fn(),
  },
}));

const entitlements = vi.hoisted(() => ({
  getEffectiveBroadcastPlanLimits: vi.fn(),
  getEffectivePlanEntitlements: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));
vi.mock(
  "~/features/payments/entitlements/deployment-mode.server",
  () => entitlements
);

import { getBroadcastReviewWarnings } from "~/features/broadcast/broadcast-review-warnings.server";

const MESSAGE = "Thanks for following along with this weekly update today.";

function input(
  overrides?: Partial<Parameters<typeof getBroadcastReviewWarnings>[0]>
) {
  return {
    userId: "user-1",
    campaignId: "camp-1",
    messageBody: MESSAGE,
    audienceType: "MUTUALS",
    totalRecipients: 10,
    suppressedCount: 0,
    invalidCustomEstimate: 0,
    planType: "pro" as const,
    ...overrides,
  };
}

describe("getBroadcastReviewWarnings", () => {
  beforeEach(() => {
    prismaMock.broadcastCampaign.findMany.mockReset();
    entitlements.getEffectiveBroadcastPlanLimits.mockReset();
    entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue({
      maxRecipientsPerCampaign: 1000,
    });
    prismaMock.broadcastCampaign.findMany.mockResolvedValue([]);
  });

  it("returns no warnings for a small unique send", async () => {
    prismaMock.broadcastCampaign.findMany
      .mockResolvedValueOnce([{ messageBody: "a completely different note" }])
      .mockResolvedValueOnce([
        { totalRecipients: 10 },
        { totalRecipients: 12 },
      ]);

    const warnings = await getBroadcastReviewWarnings(
      input({ messageBody: "hi" })
    );

    expect(warnings).toEqual([]);
    expect(entitlements.getEffectiveBroadcastPlanLimits).toHaveBeenCalledWith(
      "pro"
    );
  });

  it("warns for size, suppression, invalid lines, repeats, and median jumps", async () => {
    prismaMock.broadcastCampaign.findMany
      .mockResolvedValueOnce([
        { messageBody: `  ${MESSAGE.toUpperCase()}  ` },
        { messageBody: MESSAGE },
      ])
      .mockResolvedValueOnce([
        { totalRecipients: 40 },
        { totalRecipients: 10 },
        { totalRecipients: 20 },
      ]);

    const warnings = await getBroadcastReviewWarnings(
      input({
        totalRecipients: 2000,
        suppressedCount: 2,
        invalidCustomEstimate: 3,
      })
    );

    expect(warnings).toEqual([
      {
        level: "warning",
        message:
          "Large send (2000 recipients). Double-check message tone and audience.",
      },
      {
        level: "info",
        message:
          "2 recipient(s) excluded by your suppression list or self-send rules.",
      },
      {
        level: "warning",
        message:
          "3 custom list line(s) were invalid and skipped during resolution.",
      },
      {
        level: "warning",
        message:
          "This message matches a recent broadcast verbatim. Consider varying content to reduce fatigue.",
      },
      {
        level: "warning",
        message:
          "This audience (2000 recipients) is much larger than your typical recent broadcast (median ~20). Confirm intent and message tone.",
      },
    ]);
  });

  it("skips the median warning when the median is zero or the send is typical", async () => {
    entitlements.getEffectiveBroadcastPlanLimits.mockReturnValue({
      maxRecipientsPerCampaign: null,
    });
    prismaMock.broadcastCampaign.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { totalRecipients: 0 },
        { totalRecipients: 0 },
        { totalRecipients: 0 },
      ]);

    const zeroMedian = await getBroadcastReviewWarnings(
      input({ totalRecipients: 10, planType: "starter" })
    );
    expect(zeroMedian).toEqual([]);

    prismaMock.broadcastCampaign.findMany
      .mockResolvedValueOnce([{ messageBody: "not the same broadcast text" }])
      .mockResolvedValueOnce([
        { totalRecipients: 100 },
        { totalRecipients: 100 },
        { totalRecipients: 100 },
      ]);
    const typical = await getBroadcastReviewWarnings(
      input({ totalRecipients: 200 })
    );
    expect(typical).toEqual([]);
    expect(entitlements.getEffectiveBroadcastPlanLimits).toHaveBeenCalledWith(
      "starter"
    );
  });
});
