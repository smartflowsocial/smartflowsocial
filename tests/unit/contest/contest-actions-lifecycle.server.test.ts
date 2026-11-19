import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const query = () => vi.fn<(...args: unknown[]) => Promise<unknown>>();
  return {
    $transaction:
      vi.fn<
        (callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>
      >(),
    contestWinner: { findMany: query() },
  };
});

const paymentsCharge = vi.hoisted(() => ({
  resolveFinalizationCollection: vi.fn(),
}));

const paymentsData = vi.hoisted(() => ({
  getUserSubscription: vi.fn(),
}));

const planApi = vi.hoisted(() => ({
  getPlanDisplayName: vi.fn(),
  getUserPlanType: vi.fn(),
}));

const feeApi = vi.hoisted(() => ({
  quoteContestFinalization: vi.fn(),
}));

const resolver = vi.hoisted(() => ({
  resolveContestEntries: vi.fn(),
}));

const queries = vi.hoisted(() => ({
  getContestById: vi.fn(),
}));

const dataApi = vi.hoisted(() => ({
  updateContest: vi.fn(),
}));

const finalization = vi.hoisted(() => ({
  expireContestFinalizationByIds: vi.fn(),
  findPaidContestFinalizationForLock: vi.fn(),
  listContestFinalizationRecords: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));
vi.mock(
  "~/features/payments/campaign-finalization-charge",
  () => paymentsCharge
);
vi.mock("~/features/payments/data", () => paymentsData);
vi.mock("~/features/payments/types", () => planApi);
vi.mock("~/features/contest/contest-finalization-fee.server", () => feeApi);
vi.mock("~/features/contest/contest-resolver.server", () => resolver);
vi.mock("~/features/contest/contest-actions-queries.server", () => queries);
vi.mock(
  "~/features/contest/repositories/contest-actions-data.server",
  () => dataApi
);
vi.mock(
  "~/features/contest/repositories/contest-finalization-payment.server",
  () => finalization
);

import {
  asContestJson,
  anyDate,
  buildContest,
  match,
} from "./contest-test-doubles";

import { DEFAULT_TIE_BREAK_RULE } from "~/features/contest/contest-actions-constants.server";
import {
  cancelContest,
  completeContest,
  freezeContestAtDeadline,
  launchContest,
  lockContest,
} from "~/features/contest/contest-actions-lifecycle.server";
import { getContestById } from "~/features/contest/contest-actions-queries.server";
import { quoteContestFinalization } from "~/features/contest/contest-finalization-fee.server";
import { resolveContestEntries } from "~/features/contest/contest-resolver.server";
import type { ContestResolvedEntry } from "~/features/contest/contest-resolver.server";
import { updateContest } from "~/features/contest/repositories/contest-actions-data.server";
import {
  expireContestFinalizationByIds,
  findPaidContestFinalizationForLock,
  listContestFinalizationRecords,
} from "~/features/contest/repositories/contest-finalization-payment.server";
import { resolveFinalizationCollection } from "~/features/payments/campaign-finalization-charge";
import { getUserSubscription } from "~/features/payments/data";
import { getPlanDisplayName, getUserPlanType } from "~/features/payments/types";

const policyQuote = {
  plannedPayoutSats: 2000,
  feeRateBps: 1000,
  feeSats: 200,
  waivedByPlan: false,
  lockConfigHash: "policy-hash",
};

interface EntryCreateArgs {
  data: { entryEventId: string };
}

interface EntryRow {
  entryEventId: string;
  id: string;
}

interface FreezeTx {
  contest: { update: ReturnType<typeof vi.fn> };
  contestEntry: {
    create: ReturnType<
      typeof vi.fn<(args: EntryCreateArgs) => Promise<EntryRow>>
    >;
  };
  contestEventLog: { create: ReturnType<typeof vi.fn> };
  contestSnapshot: { create: ReturnType<typeof vi.fn> };
  contestWinner: {
    create: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
}

function isTxCallback(
  value: unknown
): value is (tx: FreezeTx) => Promise<unknown> {
  return typeof value === "function";
}

function resolved(id: string): ContestResolvedEntry {
  return {
    entryEventId: id,
    authorPubkey: `pk-${id}`,
    createdAtUnix: 20,
    replySnippet: "reply",
    reactionsCount: 1,
    zapCount: 2,
    satsZapped: 3,
    repliesCount: 4,
    repostsCount: 5,
    score: 9,
  };
}

describe("launchContest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(updateContest).mockResolvedValue(buildContest());
  });

  it("returns not found, rejects a live contest, and requires a source note", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(null);
    await expect(launchContest("user-1", "missing")).resolves.toEqual({
      success: false,
      error: "Contest not found",
    });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "LIVE" })
    );
    await expect(launchContest("user-1", "contest-1")).resolves.toEqual({
      success: false,
      error: "Only draft or scheduled-launch contests can be launched",
    });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "DRAFT", sourceNoteId: "   " })
    );
    await expect(launchContest("user-1", "contest-1")).resolves.toEqual({
      success: false,
      error: "Contest needs a source note id before launch",
    });
    expect(updateContest).not.toHaveBeenCalled();
  });

  it("keeps an existing start time and fills one when the draft has none", async () => {
    const start = new Date("2026-06-01T00:00:00.000Z");
    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "SCHEDULED_LAUNCH", contestStartAt: start })
    );
    await expect(launchContest("user-1", "contest-1")).resolves.toEqual({
      success: true,
    });
    expect(updateContest).toHaveBeenCalledWith(
      "contest-1",
      match({
        status: "LIVE",
        contestStartAt: start,
      })
    );

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "DRAFT", contestStartAt: null })
    );
    await launchContest("user-1", "contest-1");
    expect(updateContest).toHaveBeenLastCalledWith(
      "contest-1",
      match({
        status: "LIVE",
        contestStartAt: anyDate(),
      })
    );
  });
});

describe("freezeContestAtDeadline", () => {
  const tx: FreezeTx = {
    contestSnapshot: { create: vi.fn() },
    contestEntry: {
      create: vi.fn(async (args: EntryCreateArgs): Promise<EntryRow> => ({
        id: `entry-${args.data.entryEventId}`,
        entryEventId: args.data.entryEventId,
      })),
    },
    contestWinner: { deleteMany: vi.fn(), create: vi.fn() },
    contest: { update: vi.fn() },
    contestEventLog: { create: vi.fn() },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    tx.contestSnapshot.create.mockResolvedValue({ id: "snap-1" });
    tx.contestEntry.create.mockImplementation(
      async (args: { data: { entryEventId: string } }) => ({
        id: `entry-${args.data.entryEventId}`,
        entryEventId: args.data.entryEventId,
      })
    );
    prismaMock.$transaction.mockImplementation(async (callback) => {
      if (!isTxCallback(callback)) {
        throw new Error("expected transaction callback");
      }
      return callback(tx);
    });
  });

  it("rejects a missing contest, a draft, and a contest with no source note", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(null);
    await expect(freezeContestAtDeadline("user-1", "missing")).resolves.toEqual(
      {
        success: false,
        error: "Contest not found",
      }
    );

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "DRAFT" })
    );
    await expect(
      freezeContestAtDeadline("user-1", "contest-1")
    ).resolves.toEqual({
      success: false,
      error: "Contest is not in a freezeable state",
    });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "LIVE", sourceNoteId: "  " })
    );
    await expect(
      freezeContestAtDeadline("user-1", "contest-1")
    ).resolves.toEqual({
      success: false,
      error: "Contest is missing a source note id.",
    });
  });

  it("propagates a resolver failure", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "LIVE" })
    );
    vi.mocked(resolveContestEntries).mockRejectedValueOnce(
      new Error("relay down")
    );
    await expect(
      freezeContestAtDeadline("user-1", "contest-1")
    ).rejects.toThrow("relay down");
  });

  it("freezes equal rewards, alternates, and a default tie-break", async () => {
    const end = new Date("2026-06-03T00:00:00.000Z");
    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({
        status: "ENDED_REVIEW",
        contestEndAt: end,
        winnerCount: 1,
        prizeMode: "EQUAL",
        equalRewardSats: 800,
        tieBreakRule: null,
        fairnessConfig: { excludeMuted: true },
      })
    );
    vi.mocked(resolveContestEntries).mockResolvedValueOnce([
      resolved("one"),
      resolved("two"),
      resolved("three"),
    ]);

    await expect(
      freezeContestAtDeadline("user-1", "contest-1")
    ).resolves.toEqual({ success: true });
    expect(resolveContestEntries).toHaveBeenCalledWith({
      userId: "user-1",
      sourceNoteId: "note-source-1",
      metric: "ZAPS",
      deadlineUnix: Math.floor(end.getTime() / 1000),
      filters: { excludeMuted: true },
    });
    expect(tx.contestSnapshot.create).toHaveBeenCalledWith({
      data: match({
        tieBreakRule: DEFAULT_TIE_BREAK_RULE,
        totalEntries: 3,
        eligibleEntries: 3,
        excludedEntries: 0,
      }),
    });
    expect(tx.contestWinner.create).toHaveBeenNthCalledWith(1, {
      data: match({
        rank: 1,
        rewardSats: 800,
        isAlternate: false,
        entryId: "entry-one",
      }),
    });
    expect(tx.contestWinner.create).toHaveBeenNthCalledWith(2, {
      data: match({
        rank: 2,
        rewardSats: 0,
        isAlternate: true,
        entryId: "entry-two",
      }),
    });
    expect(tx.contestWinner.create).toHaveBeenCalledTimes(2);
  });

  it("uses zero when equal or ranked rewards are missing and skips unknown entry ids", async () => {
    vi.mocked(getContestById).mockResolvedValue(
      buildContest({
        status: "LIVE",
        prizeMode: "EQUAL",
        equalRewardSats: null,
        winnerCount: 1,
        fairnessConfig: null,
      })
    );
    vi.mocked(resolveContestEntries).mockResolvedValueOnce([resolved("one")]);
    await freezeContestAtDeadline("user-1", "contest-1");
    expect(resolveContestEntries).toHaveBeenCalledWith(
      match({ filters: undefined })
    );
    expect(tx.contestWinner.create).toHaveBeenCalledWith({
      data: match({ rewardSats: 0, isAlternate: false }),
    });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({
        status: "LIVE",
        prizeMode: "RANKED",
        rankRewards: null,
        winnerCount: 1,
      })
    );
    vi.mocked(resolveContestEntries).mockResolvedValueOnce([resolved("one")]);
    await freezeContestAtDeadline("user-1", "contest-1");
    expect(tx.contestWinner.create).toHaveBeenLastCalledWith({
      data: match({ rewardSats: 0 }),
    });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({
        status: "LIVE",
        prizeMode: "RANKED",
        rankRewards: [{ rank: 1, sats: 500 }],
        winnerCount: 2,
      })
    );
    tx.contestEntry.create.mockImplementation(
      async (args: { data: { entryEventId: string } }) => {
        if (args.data.entryEventId === "two") {
          return { id: "entry-mismatch", entryEventId: "someone-else" };
        }
        return {
          id: `entry-${args.data.entryEventId}`,
          entryEventId: args.data.entryEventId,
        };
      }
    );
    vi.mocked(resolveContestEntries).mockResolvedValueOnce([
      resolved("one"),
      resolved("two"),
    ]);
    await freezeContestAtDeadline("user-1", "contest-1");
    expect(tx.contestWinner.create).toHaveBeenCalledWith({
      data: match({
        entryId: "entry-one",
        rewardSats: 500,
        isAlternate: false,
      }),
    });
    expect(tx.contestWinner.create).not.toHaveBeenCalledWith({
      data: match({ entryId: "entry-two" }),
    });
  });

  it("freezes an empty field without creating winners", async () => {
    vi.mocked(getContestById).mockResolvedValue(
      buildContest({ status: "LIVE", winnerCount: 2, equalRewardSats: 10 })
    );
    vi.mocked(resolveContestEntries).mockResolvedValueOnce([]);
    await expect(
      freezeContestAtDeadline("user-1", "contest-1")
    ).resolves.toEqual({ success: true });
    expect(tx.contestWinner.create).not.toHaveBeenCalled();
    expect(tx.contest.update).toHaveBeenCalledWith({
      where: { id: "contest-1" },
      data: match({ status: "ENDED_REVIEW" }),
    });
  });
});

describe("lockContest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getUserSubscription).mockResolvedValue(null);
    vi.mocked(getUserPlanType).mockReturnValue("pro");
    vi.mocked(getPlanDisplayName).mockReturnValue("Pro");
    vi.mocked(quoteContestFinalization).mockReturnValue(policyQuote);
    vi.mocked(listContestFinalizationRecords).mockResolvedValue([]);
    vi.mocked(resolveFinalizationCollection).mockReturnValue({
      kind: "collect",
      quote: policyQuote,
      expireIds: [],
    });
    vi.mocked(findPaidContestFinalizationForLock).mockResolvedValue(true);
    prismaMock.contestWinner.findMany.mockResolvedValue([
      { entry: { authorPubkey: "pk-1" } },
      { entry: { authorPubkey: "pk-2" } },
    ]);
    vi.mocked(updateContest).mockResolvedValue(buildContest());
  });

  it("returns not found, a locked contest, the wrong status, and a missing note", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(null);
    await expect(lockContest("user-1", "missing")).resolves.toEqual({
      success: false,
      error: "Contest not found",
    });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "LOCKED" })
    );
    await expect(lockContest("user-1", "contest-1")).resolves.toEqual({
      success: true,
    });
    expect(getUserSubscription).not.toHaveBeenCalled();

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "LIVE" })
    );
    await expect(lockContest("user-1", "contest-1")).resolves.toEqual({
      success: false,
      error: "Only ended contests can be locked",
    });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "ENDED_REVIEW", sourceNoteId: null })
    );
    await expect(lockContest("user-1", "contest-1")).resolves.toEqual({
      success: false,
      error: "Contest is missing a source note id.",
    });
    expect(updateContest).not.toHaveBeenCalled();
  });

  it("expires waived invoices, rejects a stale preview, and requires a paid fee", async () => {
    vi.mocked(getContestById).mockResolvedValue(
      buildContest({
        status: "ENDED_REVIEW",
        freezeSnapshotAt: new Date("2026-06-03T00:00:00.000Z"),
        rankRewards: [{ rank: 1, sats: 10 }],
      })
    );
    vi.mocked(resolveFinalizationCollection).mockReturnValueOnce({
      kind: "waived",
      quote: { ...policyQuote, feeSats: 0, waivedByPlan: true },
      expireIds: ["fee-1"],
    });
    await lockContest("user-1", "contest-1", { lockConfigHash: "stale" });
    expect(expireContestFinalizationByIds).toHaveBeenCalledWith(["fee-1"]);
    await expect(
      lockContest("user-1", "contest-1", { lockConfigHash: "stale" })
    ).resolves.toEqual({
      success: false,
      error: "Contest preview changed. Refresh before lock.",
    });

    vi.mocked(resolveFinalizationCollection).mockReturnValue({
      kind: "collect",
      quote: policyQuote,
      expireIds: [],
    });
    vi.mocked(findPaidContestFinalizationForLock).mockResolvedValueOnce(false);
    await expect(lockContest("user-1", "contest-1")).resolves.toEqual({
      success: false,
      error: "Pay finalization fee before locking winners.",
    });
    expect(findPaidContestFinalizationForLock).toHaveBeenCalledWith(
      "contest-1",
      "user-1",
      "policy-hash"
    );
  });

  it("locks a paid fee, a waiver, and a zero pool", async () => {
    vi.mocked(getContestById).mockResolvedValue(
      buildContest({ status: "ENDED_REVIEW", freezeSnapshotAt: null })
    );
    await expect(
      lockContest("user-1", "contest-1", { lockConfigHash: "policy-hash" })
    ).resolves.toEqual({ success: true });
    expect(updateContest).toHaveBeenCalledWith(
      "contest-1",
      match({
        status: "LOCKED",
        finalizationFeeStatus: "PAID",
        planAtFinalization: "Pro",
        lockConfigHash: "policy-hash",
        payoutState: match({
          "pk-1": match({ status: "pending" }),
          "pk-2": match({ status: "pending" }),
        }),
      })
    );

    vi.mocked(resolveFinalizationCollection).mockReturnValueOnce({
      kind: "waived",
      quote: {
        ...policyQuote,
        feeSats: 0,
        feeRateBps: 0,
        waivedByPlan: true,
      },
      expireIds: [],
    });
    await lockContest("user-1", "contest-1");
    expect(updateContest).toHaveBeenLastCalledWith(
      "contest-1",
      match({ finalizationFeeStatus: "WAIVED" })
    );
    expect(findPaidContestFinalizationForLock).toHaveBeenCalledTimes(1);

    vi.mocked(resolveFinalizationCollection).mockReturnValueOnce({
      kind: "collect",
      quote: { ...policyQuote, plannedPayoutSats: 0, feeSats: 0 },
      expireIds: [],
    });
    await lockContest("user-1", "contest-1");
    expect(updateContest).toHaveBeenLastCalledWith(
      "contest-1",
      match({ finalizationFeeStatus: "NONE" })
    );
  });
});

describe("completeContest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.contestWinner.findMany.mockResolvedValue([
      { entry: { authorPubkey: "pk-1" } },
    ]);
    vi.mocked(updateContest).mockResolvedValue(buildContest());
  });

  it("returns not found and rejects a contest that is not locked", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(null);
    await expect(completeContest("user-1", "missing")).resolves.toEqual({
      success: false,
      error: "Contest not found",
    });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "LIVE" })
    );
    await expect(completeContest("user-1", "contest-1")).resolves.toEqual({
      success: false,
      error: "Only locked contests can be completed",
    });
  });

  it("requires a 10 character override until every winner is settled", async () => {
    vi.mocked(getContestById).mockResolvedValue(
      buildContest({ status: "LOCKED", payoutState: null })
    );
    await expect(completeContest("user-1", "contest-1")).resolves.toEqual({
      success: false,
      error: "Settle payouts first or provide 10+ character override reason.",
    });
    await expect(
      completeContest("user-1", "contest-1", {
        completeOverrideReason: "  short  ",
      })
    ).resolves.toEqual({
      success: false,
      error: "Settle payouts first or provide 10+ character override reason.",
    });

    await expect(
      completeContest("user-1", "contest-1", {
        completeOverrideReason: "  settled manually  ",
      })
    ).resolves.toEqual({ success: true });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({
        status: "PAYOUT_IN_PROGRESS",
        payoutState: asContestJson({
          "pk-1": { status: "sent", updatedAt: "2026-06-01T00:00:00.000Z" },
        }),
      })
    );
    await expect(completeContest("user-1", "contest-1")).resolves.toEqual({
      success: true,
    });
    expect(updateContest).toHaveBeenCalledWith(
      "contest-1",
      match({
        status: "COMPLETED",
        completedAt: anyDate(),
      })
    );
  });
});

describe("cancelContest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(updateContest).mockResolvedValue(buildContest());
  });

  it("returns not found and refuses a contest that is already locked", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(null);
    await expect(cancelContest("user-1", "missing")).resolves.toEqual({
      success: false,
      error: "Contest not found",
    });

    for (const status of [
      "LOCKED",
      "PAYOUT_IN_PROGRESS",
      "COMPLETED",
    ] as const) {
      vi.mocked(getContestById).mockResolvedValueOnce(buildContest({ status }));
      await expect(cancelContest("user-1", "contest-1")).resolves.toEqual({
        success: false,
        error: "Cannot cancel after lock",
      });
    }
    expect(updateContest).not.toHaveBeenCalled();
  });

  it("stores a trimmed reason and clears a blank reason", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "LIVE" })
    );
    await expect(
      cancelContest("user-1", "contest-1", "  changed plans  ")
    ).resolves.toEqual({ success: true });
    expect(updateContest).toHaveBeenCalledWith(
      "contest-1",
      match({
        status: "CANCELLED",
        cancellationReason: "changed plans",
      })
    );

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "DRAFT" })
    );
    await cancelContest("user-1", "contest-1", "   ");
    expect(updateContest).toHaveBeenLastCalledWith(
      "contest-1",
      match({ cancellationReason: null })
    );
  });
});
