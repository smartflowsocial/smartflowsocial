import { beforeEach, describe, expect, it, vi } from "vitest";

interface WinnerShape {
  pubkey: string;
  npub: string;
  qualifyingActions: Array<{ kind: number; eventId: string }>;
  satsPerWinner?: number;
  engagementType?: "REACTION" | "REPOST" | "COMMENT" | "ZAP";
}

interface GiveawayShape {
  status: string;
  winnerSnapshot: WinnerShape[] | null;
  payoutState: unknown;
  engagementConfig: unknown;
  winnerCount: number;
  plannedPayoutSats: number | null;
  activityLog: unknown;
}

interface Totals {
  items: number;
  paid: number;
  failed: number;
  claimNeeded: number;
  skipped: number;
}

interface BatchResult {
  runId: string | null;
  walletMode: "nwc_creator";
  eligible: boolean;
  eligibilityErrorCode?: string;
  totals: Totals;
}

interface StepResult extends BatchResult {
  stepIndex: number;
  totalSteps: number;
  done: boolean;
  nextStep: number | null;
}

interface BatchArg {
  scope: string;
  giveawayId?: string;
  creatorUserId: string;
  trigger: string;
  walletMode: string;
  spendCapSats?: number | null;
  winners: Array<{
    winnerPubkeyHex: string;
    amountSats: number;
    winnerNpub?: string | null;
  }>;
}

interface LedgerItem {
  winnerPubkey: string;
  status: string;
  errorMessage: string | null;
}

const UNKNOWN_NOTE =
  "Payment outcome is unknown. Automatic retry is blocked until the wallet is checked.";

function batchResult(overrides: Partial<BatchResult> = {}): BatchResult {
  return {
    runId: "run_1",
    walletMode: "nwc_creator",
    eligible: true,
    totals: { items: 1, paid: 0, failed: 0, claimNeeded: 0, skipped: 0 },
    ...overrides,
  };
}

function stepResult(overrides: Partial<StepResult> = {}): StepResult {
  return {
    ...batchResult(),
    stepIndex: 0,
    totalSteps: 2,
    done: false,
    nextStep: 1,
    ...overrides,
  };
}

function winner(
  pubkey: string,
  sats?: number,
  engagementType?: WinnerShape["engagementType"]
): WinnerShape {
  return {
    pubkey,
    npub: `npub-${pubkey}`,
    qualifyingActions: [{ kind: 7, eventId: "e1" }],
    ...(sats === undefined ? {} : { satsPerWinner: sats }),
    ...(engagementType === undefined ? {} : { engagementType }),
  };
}

function giveaway(overrides: Partial<GiveawayShape> = {}): GiveawayShape {
  return {
    status: "LOCKED",
    winnerSnapshot: [winner("pk-a", 21)],
    payoutState: null,
    engagementConfig: null,
    winnerCount: 1,
    plannedPayoutSats: 21,
    activityLog: [],
    ...overrides,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

const crud = vi.hoisted(() => ({
  getGiveawayById: vi.fn(
    async (_id: string, _userId: string): Promise<GiveawayShape | null> => null
  ),
}));

const repo = vi.hoisted(() => ({
  updateGiveaway: vi.fn(
    async (_id: string, _data: Record<string, unknown>) => ({ id: "g1" })
  ),
}));

const ledger = vi.hoisted(() => ({
  listPayoutItemsByRunId: vi.fn(
    async (_runId: string): Promise<LedgerItem[]> => []
  ),
}));

const executor = vi.hoisted(() => ({
  executeCampaignPayoutBatch: vi.fn(
    async (_input: BatchArg): Promise<BatchResult> => batchResult()
  ),
  executeCampaignPayoutBatchStep: vi.fn(
    async (_input: BatchArg, _stepIndex: number): Promise<StepResult> =>
      stepResult()
  ),
}));

vi.mock("~/features/giveaway/giveaway-actions-crud.server", () => crud);
vi.mock(
  "~/features/giveaway/repositories/giveaway-actions-data.server",
  () => repo
);
vi.mock(
  "~/features/payments/repositories/payout-ledger-data.server",
  () => ledger
);
vi.mock("~/features/payments/services/payout-executor.server", () => executor);

import {
  runGiveawayPayoutBatchStepWithNwc,
  runGiveawayPayoutBatchWithNwc,
  setGiveawayWinnerPayoutStatus,
  updateGiveawayPayoutSettings,
} from "~/features/giveaway/giveaway-actions-payout.server";
import {
  PAYOUT_SKIP_NOTE_PAYOUT_UNAVAILABLE,
  PAYOUT_SKIP_NOTE_WALLET_NOT_CONNECTED,
} from "~/features/payments/payout-skip-messages.server";

function lastUpdate(): Record<string, unknown> {
  const data = repo.updateGiveaway.mock.calls[0]?.[1];
  if (!data) throw new Error("update was not called");
  return data;
}

function payoutEntry(
  data: Record<string, unknown>,
  pubkey: string
): Record<string, unknown> | undefined {
  const state = data["payoutState"];
  if (!isRecord(state)) return undefined;
  const entry = state[pubkey];
  return isRecord(entry) ? entry : undefined;
}

function lastActivity(
  data: Record<string, unknown>
): Record<string, unknown> | undefined {
  const log = data["activityLog"];
  if (!isUnknownArray(log) || log.length === 0) return undefined;
  const last = log[log.length - 1];
  return isRecord(last) ? last : undefined;
}

describe("giveaway-actions-payout.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crud.getGiveawayById.mockResolvedValue(null);
    executor.executeCampaignPayoutBatch.mockResolvedValue(batchResult());
    executor.executeCampaignPayoutBatchStep.mockResolvedValue(stepResult());
    ledger.listPayoutItemsByRunId.mockResolvedValue([]);
    repo.updateGiveaway.mockResolvedValue({ id: "g1" });
  });

  describe("setGiveawayWinnerPayoutStatus", () => {
    it("returns not found when the giveaway is missing", async () => {
      const result = await setGiveawayWinnerPayoutStatus(
        "u1",
        "g1",
        "pk-a",
        "sent"
      );
      expect(result).toEqual({ success: false, error: "Giveaway not found" });
      expect(repo.updateGiveaway).not.toHaveBeenCalled();
    });

    it.each(["DRAFT", "PREVIEWED", "PAID_OUT", "CANCELLED"])(
      "rejects status changes while the giveaway is %s",
      async (status) => {
        crud.getGiveawayById.mockResolvedValue(
          giveaway({ status, winnerSnapshot: [winner("pk-a", 21)] })
        );
        const result = await setGiveawayWinnerPayoutStatus(
          "u1",
          "g1",
          "pk-a",
          "sent",
          "note"
        );
        expect(result).toEqual({
          success: false,
          error:
            "Payout status can only be changed while the giveaway is locked",
        });
        expect(repo.updateGiveaway).not.toHaveBeenCalled();
      }
    );

    it("rejects a pubkey that is not in the locked snapshot", async () => {
      crud.getGiveawayById.mockResolvedValue(
        giveaway({ winnerSnapshot: null })
      );
      const missingSnapshot = await setGiveawayWinnerPayoutStatus(
        "u1",
        "g1",
        "pk-a",
        "failed"
      );
      expect(missingSnapshot).toEqual({
        success: false,
        error: "Winner not in locked set",
      });

      crud.getGiveawayById.mockResolvedValue(
        giveaway({ winnerSnapshot: [winner("other", 5)] })
      );
      const missingWinner = await setGiveawayWinnerPayoutStatus(
        "u1",
        "g1",
        "pk-a",
        "failed"
      );
      expect(missingWinner).toEqual({
        success: false,
        error: "Winner not in locked set",
      });
      expect(repo.updateGiveaway).not.toHaveBeenCalled();
    });

    it.each([
      { note: undefined, stored: undefined },
      { note: null, stored: undefined },
      { note: "   ", stored: undefined },
      { note: "  paid by hand  ", stored: "paid by hand" },
    ])("stores $note as $stored", async ({ note, stored }) => {
      crud.getGiveawayById.mockResolvedValue(
        giveaway({ winnerSnapshot: [winner("pk-a", 21)] })
      );
      const result = await setGiveawayWinnerPayoutStatus(
        "u1",
        "g1",
        "pk-a",
        "marked_paid",
        note
      );
      expect(result).toEqual({ success: true });
      expect(crud.getGiveawayById).toHaveBeenCalledWith("g1", "u1");
      const entry = payoutEntry(lastUpdate(), "pk-a");
      expect(entry?.["status"]).toBe("marked_paid");
      expect(typeof entry?.["updatedAt"]).toBe("string");
      expect(entry?.["note"]).toBe(stored);
    });
  });

  describe("runGiveawayPayoutBatchWithNwc", () => {
    it("returns not found, unlocked, and empty snapshot failures", async () => {
      expect(await runGiveawayPayoutBatchWithNwc("u1", "g1")).toEqual({
        success: false,
        error: "Giveaway not found",
      });

      for (const status of ["DRAFT", "PREVIEWED", "PAID_OUT", "CANCELLED"]) {
        crud.getGiveawayById.mockResolvedValue(giveaway({ status }));
        const unlocked = await runGiveawayPayoutBatchWithNwc("u1", "g1");
        expect(unlocked).toEqual({
          success: false,
          error: "Giveaway must be locked to run payouts",
        });
      }

      crud.getGiveawayById.mockResolvedValue(
        giveaway({ winnerSnapshot: null })
      );
      expect(await runGiveawayPayoutBatchWithNwc("u1", "g1")).toEqual({
        success: false,
        error: "No winners to pay",
      });
      crud.getGiveawayById.mockResolvedValue(giveaway({ winnerSnapshot: [] }));
      expect(await runGiveawayPayoutBatchWithNwc("u1", "g1")).toEqual({
        success: false,
        error: "No winners to pay",
      });
      expect(executor.executeCampaignPayoutBatch).not.toHaveBeenCalled();
    });

    it("passes trigger, spend cap, and resolved sats into the executor", async () => {
      crud.getGiveawayById.mockResolvedValue(
        giveaway({
          winnerSnapshot: [
            winner("explicit", 10.9),
            winner("from-config", undefined, "ZAP"),
          ],
          winnerCount: 2,
          engagementConfig: {
            ZAP: { winnerCount: 1, satsPerWinner: 8.2 },
          },
          plannedPayoutSats: null,
        })
      );
      executor.executeCampaignPayoutBatch.mockResolvedValue(
        batchResult({ runId: "run_cap" })
      );
      const result = await runGiveawayPayoutBatchWithNwc("u1", "g1", {
        trigger: "autorun",
        spendCapSats: 40,
      });
      expect(result).toEqual({ success: true, runId: "run_cap" });
      const input = executor.executeCampaignPayoutBatch.mock.calls[0]?.[0];
      expect(input?.scope).toBe("GIVEAWAY");
      expect(input?.giveawayId).toBe("g1");
      expect(input?.creatorUserId).toBe("u1");
      expect(input?.trigger).toBe("autorun");
      expect(input?.walletMode).toBe("nwc_creator");
      expect(input?.spendCapSats).toBe(40);
      expect(input?.winners).toEqual([
        {
          winnerPubkeyHex: "explicit",
          amountSats: 10,
          winnerNpub: "npub-explicit",
        },
        {
          winnerPubkeyHex: "from-config",
          amountSats: 8,
          winnerNpub: "npub-from-config",
        },
      ]);
    });

    it("defaults the trigger to manual and the spend cap to null", async () => {
      crud.getGiveawayById.mockResolvedValue(giveaway());
      await runGiveawayPayoutBatchWithNwc("u1", "g1");
      const input = executor.executeCampaignPayoutBatch.mock.calls[0]?.[0];
      expect(input?.trigger).toBe("manual_trigger");
      expect(input?.spendCapSats).toBeNull();
      expect(input?.winners[0]?.amountSats).toBe(21);
    });

    it("syncs every ledger status and leaves unknown rows unchanged", async () => {
      const rows: Array<{
        pubkey: string;
        status: string;
        errorMessage: string | null;
        expectStatus: string;
        expectNote: string | undefined;
      }> = [
        {
          pubkey: "paid",
          status: "paid",
          errorMessage: "ignored",
          expectStatus: "sent",
          expectNote: undefined,
        },
        {
          pubkey: "failed-msg",
          status: "failed",
          errorMessage: "no route",
          expectStatus: "failed",
          expectNote: "no route",
        },
        {
          pubkey: "failed-null",
          status: "failed",
          errorMessage: null,
          expectStatus: "failed",
          expectNote: undefined,
        },
        {
          pubkey: "claim-msg",
          status: "claim_needed",
          errorMessage: "need ln",
          expectStatus: "claim_needed",
          expectNote: "need ln",
        },
        {
          pubkey: "claim-null",
          status: "claim_needed",
          errorMessage: null,
          expectStatus: "claim_needed",
          expectNote: "Winner needs claim",
        },
        {
          pubkey: "unknown-null",
          status: "unknown",
          errorMessage: null,
          expectStatus: "needs_review",
          expectNote: UNKNOWN_NOTE,
        },
        {
          pubkey: "paying-msg",
          status: "paying",
          errorMessage: "still paying",
          expectStatus: "needs_review",
          expectNote: "still paying",
        },
        {
          pubkey: "skipped-null",
          status: "skipped",
          errorMessage: null,
          expectStatus: "skipped",
          expectNote: undefined,
        },
        {
          pubkey: "skipped-msg",
          status: "skipped",
          errorMessage: "cap",
          expectStatus: "skipped",
          expectNote: "cap",
        },
      ];
      crud.getGiveawayById.mockResolvedValue(
        giveaway({
          winnerSnapshot: [
            ...rows.map((row) => winner(row.pubkey, 5)),
            winner("queued", 5),
            winner("missing", 5),
          ],
          payoutState: {
            queued: {
              status: "sent",
              updatedAt: "2020-01-01T00:00:00.000Z",
              note: "keep",
            },
            missing: {
              status: "pending",
              updatedAt: "2020-01-01T00:00:00.000Z",
            },
          },
        })
      );
      const totals: Totals = {
        items: 11,
        paid: 1,
        failed: 2,
        claimNeeded: 2,
        skipped: 2,
      };
      executor.executeCampaignPayoutBatch.mockResolvedValue(
        batchResult({ totals, eligibilityErrorCode: undefined })
      );
      ledger.listPayoutItemsByRunId.mockResolvedValue([
        ...rows.map((row) => ({
          winnerPubkey: row.pubkey,
          status: row.status,
          errorMessage: row.errorMessage,
        })),
        {
          winnerPubkey: "queued",
          status: "queued",
          errorMessage: "ignore",
        },
      ]);

      const result = await runGiveawayPayoutBatchWithNwc("u1", "g1");
      expect(result).toEqual({ success: true, runId: "run_1" });
      expect(ledger.listPayoutItemsByRunId).toHaveBeenCalledWith("run_1");
      const data = lastUpdate();
      for (const row of rows) {
        const entry = payoutEntry(data, row.pubkey);
        expect(entry?.["status"]).toBe(row.expectStatus);
        expect(entry?.["note"]).toBe(row.expectNote);
      }
      expect(payoutEntry(data, "queued")).toEqual({
        status: "sent",
        updatedAt: "2020-01-01T00:00:00.000Z",
        note: "keep",
      });
      expect(payoutEntry(data, "missing")?.["status"]).toBe("pending");
      const activity = lastActivity(data);
      expect(activity?.["type"]).toBe("payout_batch_executed");
      const payload = activity?.["payload"];
      if (!isRecord(payload)) throw new Error("missing payload");
      expect(payload["runId"]).toBe("run_1");
      expect(payload["eligible"]).toBe(true);
      expect(payload["walletMode"]).toBe("nwc_creator");
      expect(payload["totals"]).toEqual(totals);
      expect(payload["eligibilityErrorCode"]).toBeUndefined();
    });

    it("skips pending and claim-needed winners when the wallet is not connected", async () => {
      crud.getGiveawayById.mockResolvedValue(
        giveaway({
          winnerSnapshot: [
            winner("pending-pk", 5),
            winner("claim-pk", 5),
            winner("sent-pk", 5),
            winner("failed-pk", 5),
            winner("skipped-pk", 5),
            winner("review-pk", 5),
          ],
          payoutState: {
            "claim-pk": {
              status: "claim_needed",
              updatedAt: "2020-01-01T00:00:00.000Z",
            },
          },
        })
      );
      executor.executeCampaignPayoutBatch.mockResolvedValue(
        batchResult({
          eligible: false,
          eligibilityErrorCode: "nwc_not_connected",
          runId: "run_skip",
          totals: {
            items: 6,
            paid: 0,
            failed: 0,
            claimNeeded: 0,
            skipped: 6,
          },
        })
      );
      ledger.listPayoutItemsByRunId.mockResolvedValue([
        { winnerPubkey: "sent-pk", status: "paid", errorMessage: null },
        { winnerPubkey: "failed-pk", status: "failed", errorMessage: "nope" },
        { winnerPubkey: "skipped-pk", status: "skipped", errorMessage: "cap" },
        { winnerPubkey: "review-pk", status: "unknown", errorMessage: null },
      ]);
      const result = await runGiveawayPayoutBatchWithNwc("u1", "g1");
      expect(result).toEqual({
        success: false,
        error: PAYOUT_SKIP_NOTE_WALLET_NOT_CONNECTED,
        code: "nwc_not_connected",
        runId: "run_skip",
      });
      const data = lastUpdate();
      expect(payoutEntry(data, "pending-pk")?.["status"]).toBe("skipped");
      expect(payoutEntry(data, "pending-pk")?.["note"]).toBe(
        PAYOUT_SKIP_NOTE_WALLET_NOT_CONNECTED
      );
      expect(payoutEntry(data, "claim-pk")?.["status"]).toBe("skipped");
      expect(payoutEntry(data, "claim-pk")?.["note"]).toBe(
        PAYOUT_SKIP_NOTE_WALLET_NOT_CONNECTED
      );
      expect(payoutEntry(data, "sent-pk")?.["status"]).toBe("sent");
      expect(payoutEntry(data, "failed-pk")?.["status"]).toBe("failed");
      expect(payoutEntry(data, "skipped-pk")?.["status"]).toBe("skipped");
      expect(payoutEntry(data, "skipped-pk")?.["note"]).toBe("cap");
      expect(payoutEntry(data, "review-pk")?.["status"]).toBe("needs_review");
    });

    it("uses the unavailable note for other eligibility failures and skips the ledger when runId is empty", async () => {
      crud.getGiveawayById.mockResolvedValue(
        giveaway({ winnerSnapshot: [winner("pk-a", 5)] })
      );
      executor.executeCampaignPayoutBatch.mockResolvedValue(
        batchResult({
          eligible: false,
          eligibilityErrorCode: "nwc_missing",
          runId: null,
        })
      );
      const coded = await runGiveawayPayoutBatchWithNwc("u1", "g1");
      expect(coded).toEqual({
        success: false,
        error: PAYOUT_SKIP_NOTE_PAYOUT_UNAVAILABLE,
        code: "nwc_missing",
        runId: null,
      });
      expect(ledger.listPayoutItemsByRunId).not.toHaveBeenCalled();
      expect(payoutEntry(lastUpdate(), "pk-a")?.["note"]).toBe(
        PAYOUT_SKIP_NOTE_PAYOUT_UNAVAILABLE
      );

      repo.updateGiveaway.mockClear();
      executor.executeCampaignPayoutBatch.mockResolvedValue(
        batchResult({ eligible: false, runId: "run_plain" })
      );
      const plain = await runGiveawayPayoutBatchWithNwc("u1", "g1");
      expect(plain).toEqual({
        success: false,
        error: PAYOUT_SKIP_NOTE_PAYOUT_UNAVAILABLE,
        code: undefined,
        runId: "run_plain",
      });
      expect(payoutEntry(lastUpdate(), "pk-a")?.["note"]).toBe(
        PAYOUT_SKIP_NOTE_PAYOUT_UNAVAILABLE
      );
    });

    it("leaves winners pending when the batch is eligible but has no run id", async () => {
      crud.getGiveawayById.mockResolvedValue(giveaway());
      executor.executeCampaignPayoutBatch.mockResolvedValue(
        batchResult({ runId: null })
      );
      const result = await runGiveawayPayoutBatchWithNwc("u1", "g1");
      expect(result).toEqual({ success: true, runId: null });
      expect(ledger.listPayoutItemsByRunId).not.toHaveBeenCalled();
      expect(payoutEntry(lastUpdate(), "pk-a")?.["status"]).toBe("pending");
    });
  });

  describe("runGiveawayPayoutBatchStepWithNwc", () => {
    it("returns the same guard errors as a full batch", async () => {
      expect(await runGiveawayPayoutBatchStepWithNwc("u1", "g1", 0)).toEqual({
        success: false,
        error: "Giveaway not found",
      });
      crud.getGiveawayById.mockResolvedValue(giveaway({ status: "DRAFT" }));
      expect(await runGiveawayPayoutBatchStepWithNwc("u1", "g1", 1)).toEqual({
        success: false,
        error: "Giveaway must be locked to run payouts",
      });
      crud.getGiveawayById.mockResolvedValue(giveaway({ winnerSnapshot: [] }));
      expect(await runGiveawayPayoutBatchStepWithNwc("u1", "g1", 0)).toEqual({
        success: false,
        error: "No winners to pay",
      });
      expect(executor.executeCampaignPayoutBatchStep).not.toHaveBeenCalled();
    });

    it("returns the step result and writes the ledger status before the batch is done", async () => {
      crud.getGiveawayById.mockResolvedValue(giveaway());
      executor.executeCampaignPayoutBatchStep.mockResolvedValue(
        stepResult({
          stepIndex: 1,
          totalSteps: 3,
          done: false,
          nextStep: 2,
          runId: "run_step",
        })
      );
      ledger.listPayoutItemsByRunId.mockResolvedValue([
        { winnerPubkey: "pk-a", status: "paid", errorMessage: null },
      ]);
      const result = await runGiveawayPayoutBatchStepWithNwc("u1", "g1", 1, {
        trigger: "autorun",
        spendCapSats: 12,
      });
      expect(result.success).toBe(true);
      if (!result.success) throw new Error("expected success");
      expect(result.done).toBe(false);
      expect(result.stepIndex).toBe(1);
      expect(result.nextStep).toBe(2);
      expect(result.runId).toBe("run_step");
      const input = executor.executeCampaignPayoutBatchStep.mock.calls[0];
      expect(input?.[1]).toBe(1);
      expect(input?.[0].trigger).toBe("autorun");
      expect(input?.[0].spendCapSats).toBe(12);
      expect(input?.[0].winners[0]?.amountSats).toBe(21);
      const data = lastUpdate();
      expect(data["activityLog"]).toBeUndefined();
      expect(payoutEntry(data, "pk-a")?.["status"]).toBe("sent");
    });

    it("appends a stepped activity entry when the last step finishes", async () => {
      crud.getGiveawayById.mockResolvedValue(giveaway());
      const totals: Totals = {
        items: 1,
        paid: 1,
        failed: 0,
        claimNeeded: 0,
        skipped: 0,
      };
      executor.executeCampaignPayoutBatchStep.mockResolvedValue(
        stepResult({ done: true, nextStep: null, totals, runId: "run_done" })
      );
      const result = await runGiveawayPayoutBatchStepWithNwc("u1", "g1", 0);
      expect(result.success).toBe(true);
      const activity = lastActivity(lastUpdate());
      expect(activity?.["type"]).toBe("payout_batch_executed");
      const payload = activity?.["payload"];
      if (!isRecord(payload)) throw new Error("missing payload");
      expect(payload["stepped"]).toBe(true);
      expect(payload["runId"]).toBe("run_done");
      expect(payload["totals"]).toEqual(totals);
    });

    it("still logs a finished ineligible step and returns only the error", async () => {
      crud.getGiveawayById.mockResolvedValue(
        giveaway({ winnerSnapshot: [winner("pk-a", 5)] })
      );
      executor.executeCampaignPayoutBatchStep.mockResolvedValue(
        stepResult({
          eligible: false,
          eligibilityErrorCode: "nwc_not_connected",
          done: true,
          nextStep: null,
          runId: "run_bad",
        })
      );
      const connected = await runGiveawayPayoutBatchStepWithNwc("u1", "g1", 0);
      expect(connected).toEqual({
        success: false,
        error: PAYOUT_SKIP_NOTE_WALLET_NOT_CONNECTED,
      });
      expect(payoutEntry(lastUpdate(), "pk-a")?.["note"]).toBe(
        PAYOUT_SKIP_NOTE_WALLET_NOT_CONNECTED
      );
      expect(lastActivity(lastUpdate())?.["type"]).toBe(
        "payout_batch_executed"
      );

      repo.updateGiveaway.mockClear();
      ledger.listPayoutItemsByRunId.mockClear();
      executor.executeCampaignPayoutBatchStep.mockResolvedValue(
        stepResult({
          eligible: false,
          eligibilityErrorCode: "invalid_spend_cap",
          done: false,
          nextStep: null,
          runId: null,
        })
      );
      const other = await runGiveawayPayoutBatchStepWithNwc("u1", "g1", 2);
      expect(other).toEqual({
        success: false,
        error: PAYOUT_SKIP_NOTE_PAYOUT_UNAVAILABLE,
      });
      expect(ledger.listPayoutItemsByRunId).not.toHaveBeenCalled();
      const data = lastUpdate();
      expect(data["activityLog"]).toBeUndefined();
      expect(payoutEntry(data, "pk-a")?.["note"]).toBe(
        PAYOUT_SKIP_NOTE_PAYOUT_UNAVAILABLE
      );
    });
  });

  describe("updateGiveawayPayoutSettings", () => {
    it("returns not found when the giveaway is missing", async () => {
      const result = await updateGiveawayPayoutSettings("u1", "g1", {
        payoutWalletMode: "manual",
      });
      expect(result).toEqual({ success: false, error: "Giveaway not found" });
      expect(repo.updateGiveaway).not.toHaveBeenCalled();
    });

    it.each(["PAID_OUT", "CANCELLED"])(
      "rejects settings changes when status is %s",
      async (status) => {
        crud.getGiveawayById.mockResolvedValue(giveaway({ status }));
        const result = await updateGiveawayPayoutSettings("u1", "g1", {
          payoutAutoRunEnabled: true,
        });
        expect(result).toEqual({
          success: false,
          error: "Cannot change payout settings after completion/cancel",
        });
        expect(repo.updateGiveaway).not.toHaveBeenCalled();
      }
    );

    it.each(["DRAFT", "PREVIEWED", "LOCKED"])(
      "updates settings while status is %s",
      async (status) => {
        crud.getGiveawayById.mockResolvedValue(
          giveaway({ status, activityLog: [{ at: "t", type: "old" }] })
        );
        const result = await updateGiveawayPayoutSettings("u1", "g1", {
          payoutWalletMode: "nwc_creator",
          payoutAutoRunEnabled: true,
          payoutAutoRunSpendCapSats: 80,
        });
        expect(result).toEqual({ success: true });
        const data = lastUpdate();
        expect(data["payoutWalletMode"]).toBe("nwc_creator");
        expect(data["payoutAutoRunEnabled"]).toBe(true);
        expect(data["payoutAutoRunSpendCapSats"]).toBe(80);
        const activity = lastActivity(data);
        expect(activity?.["type"]).toBe("payout_settings_updated");
      }
    );

    it("forces auto-run off for manual mode unless the caller sets it again", async () => {
      crud.getGiveawayById.mockResolvedValue(giveaway());
      await updateGiveawayPayoutSettings("u1", "g1", {
        payoutWalletMode: "manual",
      });
      expect(lastUpdate()["payoutAutoRunEnabled"]).toBe(false);
      expect(lastUpdate()["payoutWalletMode"]).toBe("manual");

      repo.updateGiveaway.mockClear();
      await updateGiveawayPayoutSettings("u1", "g1", {
        payoutWalletMode: "manual",
        payoutAutoRunEnabled: true,
      });
      expect(lastUpdate()["payoutWalletMode"]).toBe("manual");
      expect(lastUpdate()["payoutAutoRunEnabled"]).toBe(true);
    });

    it("writes a null spend cap or an auto-run flag on their own", async () => {
      crud.getGiveawayById.mockResolvedValue(giveaway());
      await updateGiveawayPayoutSettings("u1", "g1", {
        payoutAutoRunSpendCapSats: null,
      });
      expect(lastUpdate()["payoutAutoRunSpendCapSats"]).toBeNull();
      expect(lastUpdate()["payoutWalletMode"]).toBeUndefined();

      repo.updateGiveaway.mockClear();
      await updateGiveawayPayoutSettings("u1", "g1", {
        payoutAutoRunEnabled: false,
      });
      expect(lastUpdate()["payoutAutoRunEnabled"]).toBe(false);
    });

    it("returns success without writing when no settings were provided", async () => {
      crud.getGiveawayById.mockResolvedValue(giveaway({ status: "DRAFT" }));
      const result = await updateGiveawayPayoutSettings("u1", "g1", {});
      expect(result).toEqual({ success: true });
      expect(repo.updateGiveaway).not.toHaveBeenCalled();
    });
  });
});
