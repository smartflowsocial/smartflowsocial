import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  contestWinner: {
    findMany: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  },
}));

const ledger = vi.hoisted(() => ({
  listPayoutItemsByRunId: vi.fn(),
}));

const queries = vi.hoisted(() => ({
  getContestById: vi.fn(),
}));

const dataApi = vi.hoisted(() => ({
  updateContest: vi.fn(),
}));

const executor = vi.hoisted(() => ({
  executeCampaignPayoutBatch: vi.fn(),
  executeCampaignPayoutBatchStep: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));
vi.mock(
  "~/features/payments/repositories/payout-ledger-data.server",
  () => ledger
);
vi.mock("~/features/contest/contest-actions-queries.server", () => queries);
vi.mock(
  "~/features/contest/repositories/contest-actions-data.server",
  () => dataApi
);
vi.mock("~/features/payments/services/payout-executor.server", () => executor);

import {
  anything,
  asReturn,
  buildContest,
  listIncluding,
  match,
  omitMatch,
} from "./contest-test-doubles";

import {
  runContestPayoutBatchStepWithNwc,
  runContestPayoutBatchWithNwc,
  setContestWinnerPayoutStatus,
  updateContestPayoutSettings,
} from "~/features/contest/contest-actions-payout.server";
import { getContestById } from "~/features/contest/contest-actions-queries.server";
import { updateContest } from "~/features/contest/repositories/contest-actions-data.server";
import {
  PAYOUT_SKIP_NOTE_PAYOUT_UNAVAILABLE,
  PAYOUT_SKIP_NOTE_WALLET_NOT_CONNECTED,
} from "~/features/payments/payout-skip-messages.server";
import { listPayoutItemsByRunId } from "~/features/payments/repositories/payout-ledger-data.server";
import {
  executeCampaignPayoutBatch,
  executeCampaignPayoutBatchStep,
} from "~/features/payments/services/payout-executor.server";

function winner(
  pubkey: string,
  rewardSats = 100,
  authorNpub: string | null = null
) {
  return {
    rewardSats,
    entry: { authorPubkey: pubkey, authorNpub },
  };
}

function batch(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    walletMode: "nwc_creator" as const,
    eligible: true,
    totals: { items: 1, paid: 0, failed: 0, claimNeeded: 0, skipped: 0 },
    ...overrides,
  };
}

describe("setContestWinnerPayoutStatus", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.contestWinner.findMany.mockResolvedValue([
      winner("pk-1"),
      winner("pk-2"),
    ]);
    vi.mocked(updateContest).mockResolvedValue(buildContest());
  });

  it("returns not found, the wrong status, and an unknown winner", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(null);
    await expect(
      setContestWinnerPayoutStatus("user-1", "missing", "pk-1", "sent")
    ).resolves.toEqual({ success: false, error: "Contest not found" });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "LIVE" })
    );
    await expect(
      setContestWinnerPayoutStatus("user-1", "contest-1", "pk-1", "sent")
    ).resolves.toEqual({
      success: false,
      error: "Contest is not in payout state",
    });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "LOCKED" })
    );
    await expect(
      setContestWinnerPayoutStatus("user-1", "contest-1", "pk-x", "sent")
    ).resolves.toEqual({
      success: false,
      error: "Winner not found in locked set",
    });
    expect(updateContest).not.toHaveBeenCalled();
  });

  it("stores a trimmed note and omits a blank note", async () => {
    vi.mocked(getContestById).mockResolvedValue(
      buildContest({ status: "PAYOUT_IN_PROGRESS" })
    );
    await expect(
      setContestWinnerPayoutStatus(
        "user-1",
        "contest-1",
        "pk-1",
        "marked_paid",
        "  paid outside  "
      )
    ).resolves.toEqual({ success: true });
    expect(updateContest).toHaveBeenCalledWith(
      "contest-1",
      match({
        status: "PAYOUT_IN_PROGRESS",
        payoutState: match({
          "pk-1": match({
            status: "marked_paid",
            note: "paid outside",
          }),
        }),
        eventLogs: {
          create: match({
            eventType: "payout_status_updated",
            message: "Payout status updated (marked_paid)",
          }),
        },
      })
    );

    await setContestWinnerPayoutStatus(
      "user-1",
      "contest-1",
      "pk-2",
      "failed",
      "   "
    );
    expect(updateContest).toHaveBeenLastCalledWith(
      "contest-1",
      match({
        payoutState: match({
          "pk-2": omitMatch({ note: anything() }),
        }),
      })
    );
  });
});

describe("runContestPayoutBatchWithNwc", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getContestById).mockResolvedValue(
      buildContest({ status: "LOCKED" })
    );
    vi.mocked(updateContest).mockResolvedValue(buildContest());
    vi.mocked(listPayoutItemsByRunId).mockResolvedValue(asReturn([]));
  });

  it("returns not found and rejects a contest that is not paying", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(null);
    await expect(
      runContestPayoutBatchWithNwc("user-1", "missing")
    ).resolves.toEqual({ success: false, error: "Contest not found" });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "DRAFT" })
    );
    await expect(
      runContestPayoutBatchWithNwc("user-1", "contest-1")
    ).resolves.toEqual({
      success: false,
      error: "Contest is not in payout state",
    });
    expect(executeCampaignPayoutBatch).not.toHaveBeenCalled();
  });

  it("syncs every ledger status and passes the default trigger", async () => {
    prismaMock.contestWinner.findMany.mockResolvedValue([
      winner("pk-paid", 10, "npub1paid"),
      winner("pk-failed"),
      winner("pk-failed-null"),
      winner("pk-claim"),
      winner("pk-claim-null"),
      winner("pk-unknown"),
      winner("pk-paying"),
      winner("pk-skipped"),
      winner("pk-skipped-null"),
      winner("pk-other"),
      winner("pk-missing"),
    ]);
    vi.mocked(executeCampaignPayoutBatch).mockResolvedValue(
      asReturn(batch({ runId: "run-1" }))
    );
    vi.mocked(listPayoutItemsByRunId).mockResolvedValue(
      asReturn([
        { winnerPubkey: "pk-paid", status: "paid", errorMessage: null },
        {
          winnerPubkey: "pk-failed",
          status: "failed",
          errorMessage: "no route",
        },
        {
          winnerPubkey: "pk-failed-null",
          status: "failed",
          errorMessage: null,
        },
        {
          winnerPubkey: "pk-claim",
          status: "claim_needed",
          errorMessage: "invoice",
        },
        {
          winnerPubkey: "pk-claim-null",
          status: "claim_needed",
          errorMessage: null,
        },
        { winnerPubkey: "pk-unknown", status: "unknown", errorMessage: null },
        {
          winnerPubkey: "pk-paying",
          status: "paying",
          errorMessage: "checking",
        },
        { winnerPubkey: "pk-skipped", status: "skipped", errorMessage: "cap" },
        {
          winnerPubkey: "pk-skipped-null",
          status: "skipped",
          errorMessage: null,
        },
        { winnerPubkey: "pk-other", status: "queued", errorMessage: "later" },
      ])
    );

    await expect(
      runContestPayoutBatchWithNwc("user-1", "contest-1")
    ).resolves.toEqual({ success: true, runId: "run-1" });

    expect(executeCampaignPayoutBatch).toHaveBeenCalledWith({
      scope: "CONTEST",
      contestId: "contest-1",
      creatorUserId: "user-1",
      trigger: "manual_trigger",
      walletMode: "nwc_creator",
      spendCapSats: null,
      winners: listIncluding([
        { winnerPubkeyHex: "pk-paid", amountSats: 10, winnerNpub: "npub1paid" },
        { winnerPubkeyHex: "pk-missing", amountSats: 100, winnerNpub: null },
      ]),
    });
    expect(updateContest).toHaveBeenCalledWith(
      "contest-1",
      match({
        payoutState: match({
          "pk-paid": match({ status: "sent" }),
          "pk-failed": match({
            status: "failed",
            note: "no route",
          }),
          "pk-failed-null": match({ status: "failed" }),
          "pk-claim": match({
            status: "claim_needed",
            note: "invoice",
          }),
          "pk-claim-null": match({
            status: "claim_needed",
            note: "Winner needs claim",
          }),
          "pk-unknown": match({ status: "needs_review" }),
          "pk-paying": match({
            status: "needs_review",
            note: "checking",
          }),
          "pk-skipped": match({
            status: "skipped",
            note: "cap",
          }),
          "pk-skipped-null": match({ status: "skipped" }),
          "pk-missing": match({ status: "pending" }),
        }),
        eventLogs: {
          create: match({
            message: "Batch payout executed via NWC",
          }),
        },
      })
    );
  });

  it("skips pending winners when the wallet is not connected and when payout is unavailable", async () => {
    prismaMock.contestWinner.findMany.mockResolvedValue([
      winner("pk-open"),
      winner("pk-claim"),
      winner("pk-sent"),
    ]);
    vi.mocked(executeCampaignPayoutBatch).mockResolvedValueOnce(
      asReturn(
        batch({
          eligible: false,
          runId: "run-1",
          walletMode: "manual",
          eligibilityErrorCode: "nwc_not_connected",
        })
      )
    );
    vi.mocked(listPayoutItemsByRunId).mockResolvedValueOnce(
      asReturn([
        { winnerPubkey: "pk-sent", status: "paid", errorMessage: null },
        {
          winnerPubkey: "pk-claim",
          status: "claim_needed",
          errorMessage: null,
        },
      ])
    );

    await expect(
      runContestPayoutBatchWithNwc("user-1", "contest-1", {
        trigger: "autorun",
        spendCapSats: 50,
      })
    ).resolves.toEqual({
      success: false,
      error: PAYOUT_SKIP_NOTE_WALLET_NOT_CONNECTED,
      code: "nwc_not_connected",
      runId: "run-1",
    });
    expect(executeCampaignPayoutBatch).toHaveBeenCalledWith(
      match({ trigger: "autorun", spendCapSats: 50 })
    );
    expect(updateContest).toHaveBeenCalledWith(
      "contest-1",
      match({
        payoutState: match({
          "pk-open": match({
            status: "skipped",
            note: PAYOUT_SKIP_NOTE_WALLET_NOT_CONNECTED,
          }),
          "pk-claim": match({
            status: "skipped",
            note: PAYOUT_SKIP_NOTE_WALLET_NOT_CONNECTED,
          }),
          "pk-sent": match({ status: "sent" }),
        }),
        eventLogs: {
          create: match({
            message: "Batch payout skipped (NWC not available)",
          }),
        },
      })
    );

    vi.mocked(executeCampaignPayoutBatch).mockResolvedValueOnce(
      asReturn(
        batch({
          eligible: false,
          runId: null,
          eligibilityErrorCode: "nwc_missing",
        })
      )
    );
    await expect(
      runContestPayoutBatchWithNwc("user-1", "contest-1")
    ).resolves.toEqual({
      success: false,
      error: PAYOUT_SKIP_NOTE_PAYOUT_UNAVAILABLE,
      code: "nwc_missing",
      runId: null,
    });
    expect(listPayoutItemsByRunId).toHaveBeenCalledTimes(1);
  });
});

describe("runContestPayoutBatchStepWithNwc", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getContestById).mockResolvedValue(
      buildContest({ status: "PAYOUT_IN_PROGRESS" })
    );
    prismaMock.contestWinner.findMany.mockResolvedValue([winner("pk-1")]);
    vi.mocked(updateContest).mockResolvedValue(buildContest());
    vi.mocked(listPayoutItemsByRunId).mockResolvedValue(asReturn([]));
  });

  it("returns not found and the wrong status", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(null);
    await expect(
      runContestPayoutBatchStepWithNwc("user-1", "missing", 0)
    ).resolves.toEqual({ success: false, error: "Contest not found" });

    vi.mocked(getContestById).mockResolvedValueOnce(
      buildContest({ status: "COMPLETED" })
    );
    await expect(
      runContestPayoutBatchStepWithNwc("user-1", "contest-1", 0)
    ).resolves.toEqual({
      success: false,
      error: "Contest is not in payout state",
    });
  });

  it("returns the step result and writes the log only when the batch is done", async () => {
    vi.mocked(executeCampaignPayoutBatchStep).mockResolvedValueOnce(
      asReturn({
        ...batch({ runId: "run-1" }),
        stepIndex: 0,
        totalSteps: 2,
        done: false,
        nextStep: 1,
      })
    );
    await expect(
      runContestPayoutBatchStepWithNwc("user-1", "contest-1", 0, {
        trigger: "autorun",
        spendCapSats: 20,
      })
    ).resolves.toMatchObject({ success: true, done: false, nextStep: 1 });
    expect(executeCampaignPayoutBatchStep).toHaveBeenCalledWith(
      match({ trigger: "autorun", spendCapSats: 20 }),
      0
    );
    expect(updateContest).toHaveBeenCalledWith(
      "contest-1",
      omitMatch({ eventLogs: anything() })
    );

    vi.mocked(executeCampaignPayoutBatchStep).mockResolvedValueOnce(
      asReturn({
        ...batch(),
        stepIndex: 1,
        totalSteps: 2,
        done: true,
        nextStep: null,
      })
    );
    await runContestPayoutBatchStepWithNwc("user-1", "contest-1", 1);
    expect(updateContest).toHaveBeenLastCalledWith(
      "contest-1",
      match({
        eventLogs: {
          create: match({
            message: "Batch payout executed via NWC",
            metadata: match({ stepped: true }),
          }),
        },
      })
    );
  });

  it("returns the wallet and unavailable errors without a run id", async () => {
    vi.mocked(executeCampaignPayoutBatchStep).mockResolvedValueOnce(
      asReturn({
        ...batch({
          eligible: false,
          runId: "run-1",
          eligibilityErrorCode: "nwc_not_connected",
        }),
        stepIndex: 0,
        totalSteps: 1,
        done: true,
        nextStep: null,
      })
    );
    await expect(
      runContestPayoutBatchStepWithNwc("user-1", "contest-1", 0)
    ).resolves.toEqual({
      success: false,
      error: PAYOUT_SKIP_NOTE_WALLET_NOT_CONNECTED,
    });
    expect(updateContest).toHaveBeenCalledWith(
      "contest-1",
      match({
        eventLogs: {
          create: match({
            message: "Batch payout skipped (NWC not available)",
          }),
        },
      })
    );

    vi.mocked(executeCampaignPayoutBatchStep).mockResolvedValueOnce(
      asReturn({
        ...batch({
          eligible: false,
          runId: null,
          eligibilityErrorCode: "nwc_missing",
        }),
        stepIndex: 0,
        totalSteps: 1,
        done: false,
        nextStep: null,
      })
    );
    await expect(
      runContestPayoutBatchStepWithNwc("user-1", "contest-1", 0)
    ).resolves.toEqual({
      success: false,
      error: PAYOUT_SKIP_NOTE_PAYOUT_UNAVAILABLE,
    });
  });
});

describe("updateContestPayoutSettings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getContestById).mockResolvedValue(
      buildContest({ status: "LOCKED" })
    );
    vi.mocked(updateContest).mockResolvedValue(buildContest());
  });

  it("returns not found and rejects a finished contest", async () => {
    vi.mocked(getContestById).mockResolvedValueOnce(null);
    await expect(
      updateContestPayoutSettings("user-1", "missing", {})
    ).resolves.toEqual({ success: false, error: "Contest not found" });

    for (const status of ["COMPLETED", "CANCELLED"] as const) {
      vi.mocked(getContestById).mockResolvedValueOnce(buildContest({ status }));
      await expect(
        updateContestPayoutSettings("user-1", "contest-1", {
          payoutAutoRunEnabled: true,
        })
      ).resolves.toEqual({
        success: false,
        error: "Cannot change payout settings after completion/cancel",
      });
    }
    expect(updateContest).not.toHaveBeenCalled();
  });

  it("no-ops an empty patch and applies wallet, autorun, and cap changes", async () => {
    await expect(
      updateContestPayoutSettings("user-1", "contest-1", {})
    ).resolves.toEqual({ success: true });
    expect(updateContest).not.toHaveBeenCalled();

    await updateContestPayoutSettings("user-1", "contest-1", {
      payoutWalletMode: "manual",
    });
    expect(updateContest).toHaveBeenCalledWith(
      "contest-1",
      match({
        payoutWalletMode: "manual",
        payoutAutoRunEnabled: false,
      })
    );

    await updateContestPayoutSettings("user-1", "contest-1", {
      payoutWalletMode: "manual",
      payoutAutoRunEnabled: true,
      payoutAutoRunSpendCapSats: null,
    });
    expect(updateContest).toHaveBeenLastCalledWith(
      "contest-1",
      match({
        payoutWalletMode: "manual",
        payoutAutoRunEnabled: true,
        payoutAutoRunSpendCapSats: null,
      })
    );

    await updateContestPayoutSettings("user-1", "contest-1", {
      payoutWalletMode: "nwc_creator",
      payoutAutoRunSpendCapSats: 40,
    });
    expect(updateContest).toHaveBeenLastCalledWith(
      "contest-1",
      match({
        payoutWalletMode: "nwc_creator",
        payoutAutoRunSpendCapSats: 40,
      })
    );
  });
});
