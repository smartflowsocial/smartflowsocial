import { describe, expect, it } from "vitest";

import type { ContestDetailPageData } from "~/features/contest/contest-detail.types";
import { buildContestEntriesCsv } from "~/features/contest/contest-export-csv.server";

function csvPage(
  winners: ContestDetailPageData["winners"]
): ContestDetailPageData {
  const data = { winners };
  return data as ContestDetailPageData;
}

describe("buildContestEntriesCsv", () => {
  it("returns only the header when there are no winners", () => {
    expect(buildContestEntriesCsv(csvPage([]))).toBe(
      "rank,authorPubkey,entryEventId,score,rewardSats,isAlternate,replySnippet"
    );
  });

  it("escapes quotes, maps alternate flags, and treats a null snippet as empty", () => {
    const csv = buildContestEntriesCsv(
      csvPage([
        {
          id: "w1",
          rank: 1,
          rewardSats: 500,
          isAlternate: false,
          score: 9,
          authorPubkey: "pk-primary",
          entryEventId: "evt-1",
          replySnippet: 'say "hi"',
          payoutStatus: "pending",
        },
        {
          id: "w2",
          rank: 2,
          rewardSats: 0,
          isAlternate: true,
          score: 4,
          authorPubkey: "pk-alt",
          entryEventId: "evt-2",
          replySnippet: null,
          payoutStatus: "pending",
        },
      ])
    );

    expect(csv).toBe(
      [
        "rank,authorPubkey,entryEventId,score,rewardSats,isAlternate,replySnippet",
        '1,pk-primary,evt-1,9,500,no,"say ""hi"""',
        '2,pk-alt,evt-2,4,0,yes,""',
      ].join("\n")
    );
  });
});
