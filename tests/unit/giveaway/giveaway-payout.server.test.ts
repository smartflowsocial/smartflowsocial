import { describe, expect, it } from "vitest";

import {
  allWinnersPayoutSettled,
  budgetSatsFromGiveawayRow,
  buildInitialPayoutState,
  computeGiveawayPlannedPayoutSats,
  countPayoutCompleted,
  normalizePayoutState,
  resolveWinnerSatsPerWinner,
  totalSatsBudgetFromSnapshot,
  totalSatsPaidFromState,
} from "~/features/giveaway/giveaway-payout.server";
import type { GiveawayWinnerEntry } from "~/features/giveaway/types";

function winner(
  pubkey: string,
  extra?: {
    satsPerWinner?: number;
    engagementType?: GiveawayWinnerEntry["engagementType"];
  }
): GiveawayWinnerEntry {
  return {
    pubkey,
    npub: "npub1",
    qualifyingActions: [],
    ...extra,
  };
}

describe("giveaway-payout.server", () => {
  describe("resolveWinnerSatsPerWinner", () => {
    it("floors an explicit positive amount ahead of config", () => {
      expect(
        resolveWinnerSatsPerWinner(winner("a", { satsPerWinner: 10.9 }), {
          engagementConfig: { _simpleUnified: { satsPerWinner: 99 } },
        })
      ).toBe(10);
    });

    it("falls through explicit zero or negative amounts to unified sats", () => {
      const context = {
        engagementConfig: { _simpleUnified: { satsPerWinner: 4 } },
      };
      expect(
        resolveWinnerSatsPerWinner(winner("a", { satsPerWinner: 0 }), context)
      ).toBe(4);
      expect(
        resolveWinnerSatsPerWinner(winner("a", { satsPerWinner: -3 }), context)
      ).toBe(4);
    });

    it("uses the engagement-type row when unified sats are not positive", () => {
      const context = {
        engagementConfig: {
          _simpleUnified: { satsPerWinner: 0 },
          REACTION: { winnerCount: 1, satsPerWinner: 6.8 },
          ZAP: { winnerCount: 1, satsPerWinner: 0 },
        },
      };
      expect(
        resolveWinnerSatsPerWinner(
          winner("a", { engagementType: "REACTION" }),
          context
        )
      ).toBe(6);
      expect(
        resolveWinnerSatsPerWinner(
          winner("a", { engagementType: "ZAP" }),
          context
        )
      ).toBe(0);
      expect(
        resolveWinnerSatsPerWinner(
          winner("a", { engagementType: "COMMENT" }),
          context
        )
      ).toBe(0);
      expect(resolveWinnerSatsPerWinner(winner("a"), context)).toBe(0);
      expect(
        resolveWinnerSatsPerWinner(winner("a"), { engagementConfig: null })
      ).toBe(0);
    });
  });

  describe("computeGiveawayPlannedPayoutSats", () => {
    it("prefers a positive snapshot sum over the stored plan", () => {
      expect(
        computeGiveawayPlannedPayoutSats({
          winnerSnapshot: [
            winner("a", { satsPerWinner: 10 }),
            winner("b", { satsPerWinner: 5 }),
          ],
          engagementConfig: null,
          plannedPayoutSats: 999,
        })
      ).toBe(15);
    });

    it("uses planned sats when the snapshot does not resolve a positive sum", () => {
      expect(
        computeGiveawayPlannedPayoutSats({
          winnerSnapshot: [winner("a")],
          engagementConfig: null,
          plannedPayoutSats: 33,
        })
      ).toBe(33);
      expect(
        computeGiveawayPlannedPayoutSats({
          winnerSnapshot: null,
          engagementConfig: null,
          plannedPayoutSats: 33,
        })
      ).toBe(33);
      expect(
        computeGiveawayPlannedPayoutSats({
          winnerSnapshot: [],
          engagementConfig: null,
          plannedPayoutSats: 8,
        })
      ).toBe(8);
    });

    it("derives the pool from unified or per-type config", () => {
      expect(
        computeGiveawayPlannedPayoutSats({
          winnerSnapshot: [],
          engagementConfig: { _simpleUnified: { satsPerWinner: 8 } },
          winnerCount: 3,
          plannedPayoutSats: 0,
        })
      ).toBe(24);
      expect(
        computeGiveawayPlannedPayoutSats({
          winnerSnapshot: [],
          engagementConfig: { _simpleUnified: { satsPerWinner: 8 } },
          plannedPayoutSats: -1,
        })
      ).toBe(0);
      expect(
        computeGiveawayPlannedPayoutSats({
          winnerSnapshot: [],
          engagementConfig: {
            REACTION: { winnerCount: 2.9, satsPerWinner: 5.2 },
            ZAP: { winnerCount: -1, satsPerWinner: 9 },
          },
          plannedPayoutSats: null,
        })
      ).toBe(10);
      expect(
        computeGiveawayPlannedPayoutSats({
          winnerSnapshot: [],
          engagementConfig: [],
          plannedPayoutSats: 0,
        })
      ).toBe(0);
      expect(
        computeGiveawayPlannedPayoutSats({
          winnerSnapshot: [winner("a")],
          engagementConfig: "nope",
          plannedPayoutSats: 0,
        })
      ).toBe(0);
    });
  });

  describe("payout state helpers", () => {
    const snapshot = [
      winner("a", { satsPerWinner: 10 }),
      winner("b", { satsPerWinner: 4 }),
      winner("c", { satsPerWinner: 100 }),
      winner("d"),
    ];

    it("starts every snapshot pubkey as pending", () => {
      const state = buildInitialPayoutState(snapshot);
      expect(Object.keys(state)).toEqual(["a", "b", "c", "d"]);
      expect(state["a"]?.status).toBe("pending");
      expect(state["a"]?.updatedAt).toBe(state["d"]?.updatedAt);
      expect(state["a"]?.note).toBeUndefined();
    });

    it("keeps valid stored rows and resets everything else to pending", () => {
      const state = normalizePayoutState(
        {
          a: {
            status: "sent",
            updatedAt: "2024-01-01T00:00:00.000Z",
            note: "ok",
          },
          b: { status: "nope", updatedAt: "2024-01-01T00:00:00.000Z" },
          c: { status: 1, updatedAt: "2024-01-01T00:00:00.000Z" },
          d: "sent",
          extra: { status: "sent", updatedAt: "2024-01-01T00:00:00.000Z" },
        },
        snapshot
      );
      expect(state["a"]).toEqual({
        status: "sent",
        updatedAt: "2024-01-01T00:00:00.000Z",
        note: "ok",
      });
      expect(state["b"]?.status).toBe("pending");
      expect(state["c"]?.status).toBe("pending");
      expect(state["d"]?.status).toBe("pending");
      expect(state["extra"]).toBeUndefined();

      const fallback = normalizePayoutState(
        {
          a: { status: "failed", updatedAt: 5, note: 9 },
          b: { updatedAt: "2024-01-01T00:00:00.000Z" },
        },
        [winner("a"), winner("b")]
      );
      expect(fallback["a"]?.status).toBe("failed");
      expect(fallback["a"]?.note).toBeUndefined();
      expect(typeof fallback["a"]?.updatedAt).toBe("string");
      expect(fallback["a"]?.updatedAt).not.toBe(5);
      expect(fallback["b"]?.status).toBe("pending");

      for (const status of [
        "pending",
        "sent",
        "failed",
        "marked_paid",
        "claim_needed",
        "needs_review",
        "skipped",
      ] as const) {
        const normalized = normalizePayoutState(
          { a: { status, updatedAt: "2024-05-01T00:00:00.000Z" } },
          [winner("a")]
        );
        expect(normalized["a"]?.status).toBe(status);
      }

      expect(normalizePayoutState(null, [winner("a")])["a"]?.status).toBe(
        "pending"
      );
      expect(normalizePayoutState(["a"], [winner("a")])["a"]?.status).toBe(
        "pending"
      );
      expect(normalizePayoutState("raw", [winner("a")])["a"]?.status).toBe(
        "pending"
      );
    });

    it("counts and checks settled winners", () => {
      const state = normalizePayoutState(
        {
          a: { status: "sent", updatedAt: "t" },
          b: { status: "marked_paid", updatedAt: "t" },
          c: { status: "pending", updatedAt: "t" },
        },
        snapshot
      );
      expect(countPayoutCompleted(state, ["a", "b", "c", "missing"])).toBe(2);
      expect(allWinnersPayoutSettled(state, [])).toBe(false);
      expect(allWinnersPayoutSettled(state, [winner("a"), winner("b")])).toBe(
        true
      );
      expect(allWinnersPayoutSettled(state, [winner("a"), winner("c")])).toBe(
        false
      );
      expect(allWinnersPayoutSettled(state, [winner("missing")])).toBe(false);
    });

    it("sums budget and paid sats with or without a payout context", () => {
      expect(totalSatsBudgetFromSnapshot(snapshot)).toBe(114);
      const state = normalizePayoutState(
        {
          a: { status: "sent", updatedAt: "t" },
          b: { status: "marked_paid", updatedAt: "t" },
          c: { status: "pending", updatedAt: "t" },
          d: { status: "sent", updatedAt: "t" },
        },
        snapshot
      );
      expect(totalSatsPaidFromState(snapshot, state)).toBe(14);
      expect(
        totalSatsPaidFromState(snapshot, state, {
          engagementConfig: { _simpleUnified: { satsPerWinner: 7 } },
        })
      ).toBe(21);
      expect(
        budgetSatsFromGiveawayRow({
          winnerSnapshot: [
            winner("a", { satsPerWinner: 10 }),
            winner("b", { satsPerWinner: 5 }),
          ],
          engagementConfig: null,
        })
      ).toBe(15);
    });
  });
});
