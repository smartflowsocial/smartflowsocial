import { describe, expect, it } from "vitest";

import {
  buildContestFairnessProofLines,
  buildContestPublicSummaryLines,
  buildContestReceiptSummaryLine,
} from "~/features/contest/contest-proof-share.server";
import { poweredByBrand } from "~/lib/brand";

describe("buildContestFairnessProofLines", () => {
  it("prints a null eligible count and a missing tie-break as dashes", () => {
    expect(
      buildContestFairnessProofLines({
        title: "Zap race",
        eligibleEntries: null,
        tieBreakRule: null,
        entryType: "REPLY_DIRECT",
        lockedOrCompletedAt: "Jun 1, 2026",
      })
    ).toEqual([
      "Fairness · Zap race",
      "Eligible entries (frozen snapshot):  - ",
      "Entry type: REPLY_DIRECT",
      "Tie-break:  - ",
      "Locked / completed: Jun 1, 2026",
      "",
      poweredByBrand,
    ]);
  });

  it("treats an omitted eligible count and a blank tie-break as missing", () => {
    expect(
      buildContestFairnessProofLines({
        title: "Zap race",
        tieBreakRule: "",
        entryType: "REPLY_DIRECT",
        lockedOrCompletedAt: "Jun 1, 2026",
      })
    ).toEqual([
      "Fairness · Zap race",
      "Eligible entries (frozen snapshot):  - ",
      "Entry type: REPLY_DIRECT",
      "Tie-break:  - ",
      "Locked / completed: Jun 1, 2026",
      "",
      poweredByBrand,
    ]);
  });

  it("prints a zero eligible count and the tie-break rule", () => {
    expect(
      buildContestFairnessProofLines({
        title: "Zap race",
        eligibleEntries: 0,
        tieBreakRule: "earlier reply",
        entryType: "REPLY_DIRECT",
        lockedOrCompletedAt: "Jun 1, 2026",
      })
    ).toEqual([
      "Fairness · Zap race",
      "Eligible entries (frozen snapshot): 0",
      "Entry type: REPLY_DIRECT",
      "Tie-break: earlier reply",
      "Locked / completed: Jun 1, 2026",
      "",
      poweredByBrand,
    ]);
  });
});

describe("buildContestReceiptSummaryLine", () => {
  it("summarizes the note prefix, metric, winners, and amounts", () => {
    const planned = 3000;
    const fee = 150;
    expect(
      buildContestReceiptSummaryLine({
        sourceNoteId: "note123456789abcdef",
        rankingMetric: "ZAPS",
        winnerCount: 2,
        plannedPayoutSats: planned,
        finalizationFeeSats: fee,
        completedAtLabel: "Jun 1, 2026, 3:04 PM",
      })
    ).toBe(
      `Completed contest on note12345678... by zaps with 2 winner(s), ${planned.toLocaleString()} sats planned, ${fee.toLocaleString()} sats fee, completed Jun 1, 2026, 3:04 PM.`
    );
  });
});

describe("buildContestPublicSummaryLines", () => {
  it("omits the completed timestamp when no label is provided", () => {
    const planned = 2000;
    expect(
      buildContestPublicSummaryLines({
        title: "Zap race",
        rankingMetric: "SATS_ZAPPED",
        winnerCount: 1,
        plannedPayoutSats: planned,
        durationLabel: "2 day(s)",
      })
    ).toEqual([
      "Completed Zap race",
      "Top 1 replies ranked by sats_zapped over 2 day(s).",
      `Planned payout: ${planned.toLocaleString()} sats.`,
      "Results are based on the frozen snapshot captured at contest end.",
      "",
      poweredByBrand,
    ]);
  });

  it("appends the completed timestamp when a label is provided", () => {
    const lines = buildContestPublicSummaryLines({
      title: "Zap race",
      rankingMetric: "ZAPS",
      winnerCount: 3,
      plannedPayoutSats: 0,
      durationLabel: "the contest window",
      completedAtLabel: "Jun 2, 2026",
    });
    expect(lines).toContain("");
    expect(lines).toContain("Completed: Jun 2, 2026");
    expect(lines.at(-1)).toBe(poweredByBrand);
    expect(lines).toContain(
      "Top 3 replies ranked by zaps over the contest window."
    );
  });
});
