import { describe, expect, it } from "vitest";

import {
  buildGiveawayFairnessProofLines,
  buildGiveawayPublicSummaryLines,
  buildGiveawayReceiptSummaryLine,
} from "~/features/giveaway/giveaway-proof-share.server";

describe("giveaway-proof-share.server", () => {
  it("builds public summary lines from the paid-out card", () => {
    const lines = buildGiveawayPublicSummaryLines({
      title: "Spring drops",
      scopeLine: "Last 7 days",
      winnerCount: 2,
      budgetSats: 1000,
      completedAtLabel: "May 1",
    });
    expect(lines[0]).toBe("Giveaway complete");
    expect(lines).toContain(`${(1000).toLocaleString()} - sats distributed`);
    expect(lines).toContain("Spring drops");
    expect(lines).toContain("Last 7 days");
    expect(lines).toContain("Status: Paid out");
    expect(lines).toContain("Winners: 2");
    expect(lines).toContain("Scope: Last 7 days");
    expect(lines).toContain("Completed: May 1");
  });

  it("builds a one-line receipt for one or many winners and a missing plan", () => {
    expect(
      buildGiveawayReceiptSummaryLine({
        scopeSummaryLabel: "Queue Memes",
        winnerCount: 1,
        plannedPayoutSats: 100,
        finalizationFeeSats: 10,
        planAtFinalization: "  Pro  ",
        completedAtLabel: "May 3",
      })
    ).toBe(
      `Queue Memes · 1 winner · ${(100).toLocaleString()} sats planned · ${(10).toLocaleString()} sats finalization fee · Plan: Pro · Completed May 3`
    );
    expect(
      buildGiveawayReceiptSummaryLine({
        scopeSummaryLabel: "Followers",
        winnerCount: 2,
        plannedPayoutSats: 0,
        finalizationFeeSats: 0,
        planAtFinalization: null,
        completedAtLabel: "May 4",
      })
    ).toContain("2 winners");
    expect(
      buildGiveawayReceiptSummaryLine({
        scopeSummaryLabel: "Followers",
        winnerCount: 2,
        plannedPayoutSats: 0,
        finalizationFeeSats: 0,
        planAtFinalization: "   ",
        completedAtLabel: "May 4",
      })
    ).toContain("Plan: —");
    expect(
      buildGiveawayReceiptSummaryLine({
        scopeSummaryLabel: "Followers",
        winnerCount: 2,
        plannedPayoutSats: 0,
        finalizationFeeSats: 0,
        planAtFinalization: "",
        completedAtLabel: "May 4",
      })
    ).toContain("Plan: —");
  });

  it("builds fairness lines for weighted and unique selection", () => {
    const weighted = buildGiveawayFairnessProofLines({
      title: "Fair",
      eligiblePoolSize: 12,
      selectionModeLabel: "Weighted by engagement",
      lockedOrCompletedAt: "May 2",
    });
    expect(weighted).toContain("Fairness proof");
    expect(weighted).toContain("Fair");
    expect(weighted).toContain("Eligible (last preview): 12");
    expect(weighted).toContain("Selection: Weighted by engagement");
    expect(weighted).toContain("Winners: 0");
    expect(weighted).toContain("Status: Selection finalized");
    expect(weighted).toContain("May 2");

    const unique = buildGiveawayFairnessProofLines({
      title: "Plain",
      selectionModeLabel: "Unique user",
      lockedOrCompletedAt: "May 5",
    });
    expect(unique).toContain("Eligible (last preview): —");
    expect(unique).toContain("Selection: Unique user");
  });
});
