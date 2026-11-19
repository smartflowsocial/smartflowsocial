import { beforeEach, describe, expect, it, vi } from "vitest";

const detailQueries = vi.hoisted(() => ({
  findContestWinnersWithEntries: vi.fn(),
}));

vi.mock(
  "~/features/contest/repositories/contest-detail-queries.server",
  () => detailQueries
);

import { asReturn } from "./contest-test-doubles";

import { summarizeContestProofSettlement } from "~/features/contest/contest-proof-settlement.server";
import { findContestWinnersWithEntries } from "~/features/contest/repositories/contest-detail-queries.server";

function winner(input: {
  pubkey: string;
  rewardSats: number;
  isAlternate?: boolean;
}) {
  return {
    isAlternate: input.isAlternate ?? false,
    rewardSats: input.rewardSats,
    entry: { authorPubkey: input.pubkey },
  };
}

describe("summarizeContestProofSettlement", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns zeros when the contest has no winners", async () => {
    vi.mocked(findContestWinnersWithEntries).mockResolvedValueOnce(
      asReturn([])
    );
    await expect(
      summarizeContestProofSettlement("contest-1", null)
    ).resolves.toEqual({
      paidViaWalletCount: 0,
      paidManuallyCount: 0,
      unresolvedCount: 0,
      satsPaid: 0,
    });
  });

  it("counts wallet and manual payouts and ignores alternates", async () => {
    vi.mocked(findContestWinnersWithEntries).mockResolvedValueOnce(
      asReturn([
        winner({ pubkey: "pk-sent", rewardSats: 10.9 }),
        winner({ pubkey: "pk-manual", rewardSats: -4 }),
        winner({ pubkey: "pk-open", rewardSats: 50 }),
        winner({ pubkey: "pk-alt", rewardSats: 999, isAlternate: true }),
      ])
    );

    await expect(
      summarizeContestProofSettlement("contest-1", {
        "pk-sent": { status: "sent", updatedAt: "2026-06-01T00:00:00.000Z" },
        "pk-manual": {
          status: "marked_paid",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
        "pk-open": { status: "failed", updatedAt: "2026-06-01T00:00:00.000Z" },
      })
    ).resolves.toEqual({
      paidViaWalletCount: 1,
      paidManuallyCount: 1,
      unresolvedCount: 1,
      satsPaid: 10,
    });
  });
});
