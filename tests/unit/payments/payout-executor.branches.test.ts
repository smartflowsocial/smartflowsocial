import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

interface EnsureCall {
  idempotencyKey: string;
  scope: string;
  userId: string;
  walletMode: string;
  trigger: string;
  contestId: string | null;
  giveawayId: string | null;
  spendCapSats: number | null;
  totalItems: number | null;
  totalSats: number | null;
}

interface RunRow {
  id: string;
  startedAt: Date | null;
  metadataJson?: unknown;
}

interface RunUpdate {
  status?: string;
  startedAt?: Date | null;
  completedAt?: Date | null;
  eligibilityErrorCode?: string | null;
  eligibilityErrorMessage?: string | null;
  totalItems?: number | null;
  totalSats?: number | null;
  metadataJson?: unknown;
}

interface ClaimResult {
  ok: boolean;
  reason?: string;
  message?: string;
  itemId?: string;
  attemptKey?: string;
  attemptNumber?: number;
  paymentHash?: string | null;
  amountSats?: number;
}

interface ClaimCall {
  runId: string;
  winnerPubkey: string;
  amountSats: number;
  idempotencyKey: string;
  invoice: string;
  paymentHash: string;
  invoiceExpiresAt: Date;
  lnAddressSnapshot: string;
  requestedSpendCapSats: number | null;
  requestedWinners: Array<{ winnerPubkey: string; amountSats: number }>;
  resolutionHoldMs: number;
}

interface RecordCall {
  runId: string;
  winnerPubkey: string;
  amountSats: number;
  idempotencyKey: string;
  status: string;
  errorCode: string;
  errorMessage: string;
  lnAddressSnapshot?: string | null;
}

interface SettleCall {
  itemId: string;
  attemptKey?: string;
  outcome: string;
  preimage?: string;
  walletResponse?: unknown;
  errorCode?: string;
  errorMessage?: string;
}

interface PayCall {
  nwcUrl: string;
  invoice: string;
  authorizedSats: number;
  timeoutMs: number;
  reconcileTimeoutMs: number;
}

interface PayResult {
  ok: boolean;
  preimage?: string;
  walletResponse?: unknown;
  paymentHash?: string | null;
  amountSats?: number;
  disposition?: "rejected" | "unknown";
  code?: string;
  message?: string;
}

interface LookupCall {
  nwcUrl: string;
  paymentHash: string;
  authorizedSats: number;
  timeoutMs: number;
}

interface LookupResult {
  kind: "settled" | "failed" | "inconclusive";
  preimage?: string | null;
}

interface InvoiceResult {
  ok: boolean;
  invoice?: string;
  code?: string;
  detail?: string;
}

interface PrimalProfile {
  lud16?: unknown;
}

interface PrimalData {
  profile: PrimalProfile;
}

interface Winner {
  winnerPubkeyHex: string;
  amountSats: number;
  winnerNpub?: string | null;
  lnAddressSnapshot?: string | null;
}

interface BatchInput {
  scope: "CONTEST" | "GIVEAWAY";
  contestId?: string;
  giveawayId?: string;
  creatorUserId: string;
  trigger: "manual_trigger" | "autorun";
  walletMode: "manual" | "nwc_creator";
  spendCapSats?: number | null;
  winners: Winner[];
}

const ledger = vi.hoisted(() => ({
  withPayoutLedgerTransaction: vi.fn(
    async (fn: (tx: unknown) => Promise<unknown>) => fn({})
  ),
  findOrCreatePayoutRunByIdempotencyKey:
    vi.fn<(tx: unknown, args: EnsureCall) => Promise<RunRow>>(),
  findPayoutRunByIdempotencyKey:
    vi.fn<(idempotencyKey: string) => Promise<RunRow | null>>(),
  updatePayoutRun:
    vi.fn<
      (runId: string, data: RunUpdate, tx?: unknown) => Promise<{ id: string }>
    >(),
}));

const claimApi = vi.hoisted(() => ({
  claimCampaignPayoutItem: vi.fn<(args: ClaimCall) => Promise<ClaimResult>>(),
  recordUnpayableCampaignItem: vi.fn<(args: RecordCall) => Promise<void>>(),
  settleCampaignPayoutAttempt:
    vi.fn<(args: SettleCall) => Promise<"updated" | "ignored">>(),
}));

const payApi = vi.hoisted(() => ({
  payAuthorizedBolt11: vi.fn<(args: PayCall) => Promise<PayResult>>(),
  lookupAuthorizedPayment: vi.fn<(args: LookupCall) => Promise<LookupResult>>(),
  nwcTimeouts: vi.fn(() => ({ payMs: 45_000, reconcileMs: 15_000 })),
}));

const profiles = vi.hoisted(() => ({
  fetchPrimalProfileData: vi.fn<(npub: string) => Promise<unknown>>(),
  processPrimalData: vi.fn<(data: unknown) => PrimalData>(),
}));

const users = vi.hoisted(() => ({
  getDecryptedUserNWC: vi.fn<(userId: string) => Promise<string | null>>(),
}));

const invoices = vi.hoisted(() => ({
  fetchLnurlPayInvoice:
    vi.fn<(url: string, amountSats: number) => Promise<InvoiceResult>>(),
}));

const logger = vi.hoisted(() => ({
  logError:
    vi.fn<(error: unknown, context?: Record<string, unknown>) => void>(),
}));

vi.mock(
  "~/features/payments/repositories/payout-ledger-data.server",
  () => ledger
);
vi.mock(
  "~/features/payments/repositories/campaign-payout-claim.server",
  () => claimApi
);
vi.mock("~/features/payments/nwc-authorized-pay.server", () => payApi);
vi.mock("~/features/auth/profile.server", () => profiles);
vi.mock("~/features/user", () => users);
vi.mock("~/features/referral/lnurl-pay.server", () => invoices);
vi.mock("~/lib/error-logger.server", () => logger);

import { freshInvoiceForSats } from "../../helpers/bolt11-fixture";

import {
  executeCampaignPayoutBatch,
  executeCampaignPayoutBatchStep,
} from "~/features/payments/services/payout-executor.server";

const WINNER = "b".repeat(64);
const OTHER = "c".repeat(64);
const HASH = "22".repeat(32);
const NWC = "nostr+walletconnect://test";
const REFUSAL = "Payout was refused before payment";
const RECONCILE =
  "Payment outcome is unknown. Automatic retry is blocked until the wallet is checked.";

function winnerItemKey(
  campaignKey: string,
  pubkey: string,
  amount: number
): string {
  return createHash("sha256")
    .update(`${campaignKey}:winner:${pubkey}:amount:${amount}`)
    .digest("hex");
}

function input(
  overrides: Partial<BatchInput> & { winners: Winner[] }
): BatchInput {
  return {
    scope: "GIVEAWAY",
    giveawayId: "g1",
    creatorUserId: "u1",
    trigger: "manual_trigger",
    walletMode: "nwc_creator",
    winners: overrides.winners,
    ...overrides,
  };
}

function payable(amount = 100, pubkey = WINNER): Winner {
  return {
    winnerPubkeyHex: pubkey,
    amountSats: amount,
    winnerNpub: "npub1test",
    lnAddressSnapshot: "alice@example.com",
  };
}

function withAmount(amountSats: unknown, pubkey = WINNER): Winner {
  return { ...payable(0, pubkey), amountSats: amountSats as number };
}

function useInvoice(amount = 100): string {
  const invoice = freshInvoiceForSats(amount, HASH);
  invoices.fetchLnurlPayInvoice.mockResolvedValue({ ok: true, invoice });
  return invoice;
}

function lastUpdate(): RunUpdate {
  const call = ledger.updatePayoutRun.mock.calls.at(-1);
  if (!call) throw new Error("missing payout run update");
  return call[1];
}

function lastRecord(): RecordCall {
  const call = claimApi.recordUnpayableCampaignItem.mock.calls.at(-1);
  if (!call) throw new Error("missing unpayable record");
  return call[0];
}

function lastSettle(): SettleCall {
  const call = claimApi.settleCampaignPayoutAttempt.mock.calls.at(-1);
  if (!call) throw new Error("missing settle");
  return call[0];
}

describe("executeCampaignPayoutBatch uncovered branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ledger.findOrCreatePayoutRunByIdempotencyKey.mockResolvedValue({
      id: "run_1",
      startedAt: null,
    });
    ledger.findPayoutRunByIdempotencyKey.mockResolvedValue({
      id: "run_1",
      metadataJson: null,
    });
    ledger.updatePayoutRun.mockResolvedValue({ id: "run_1" });
    claimApi.recordUnpayableCampaignItem.mockResolvedValue(undefined);
    claimApi.settleCampaignPayoutAttempt.mockResolvedValue("updated");
    claimApi.claimCampaignPayoutItem.mockResolvedValue({
      ok: false,
      reason: "already_paid",
      itemId: "item_1",
    });
    payApi.lookupAuthorizedPayment.mockResolvedValue({ kind: "inconclusive" });
    payApi.nwcTimeouts.mockReturnValue({ payMs: 45_000, reconcileMs: 15_000 });
    users.getDecryptedUserNWC.mockResolvedValue(NWC);
    invoices.fetchLnurlPayInvoice.mockResolvedValue({
      ok: false,
      code: "invoice_fetch_failed",
      detail: "not stubbed",
    });
    profiles.fetchPrimalProfileData.mockResolvedValue({ raw: true });
    profiles.processPrimalData.mockReturnValue({ profile: {} });
  });

  it("skips a manual wallet before an invalid spend cap is considered", async () => {
    const result = await executeCampaignPayoutBatch(
      input({
        walletMode: "manual",
        spendCapSats: 1.5,
        winners: [payable(), payable(50, OTHER)],
      })
    );

    expect(result).toEqual({
      runId: "run_1",
      walletMode: "manual",
      eligible: false,
      eligibilityErrorCode: "nwc_disabled",
      eligibilityErrorMessage: "Payout method is manual",
      totals: { items: 2, paid: 0, failed: 0, claimNeeded: 0, skipped: 2 },
    });
    expect(users.getDecryptedUserNWC).not.toHaveBeenCalled();
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();
    expect(lastUpdate()).toMatchObject({
      status: "skipped",
      eligibilityErrorCode: "nwc_disabled",
      eligibilityErrorMessage: "Payout method is manual",
    });
    expect(lastUpdate().completedAt).toBeInstanceOf(Date);
    expect(lastUpdate().startedAt).toBeUndefined();
    expect(ledger.updatePayoutRun.mock.calls[0]?.[2]).toEqual({});
  });

  it("records nwc_not_connected when the creator wallet cannot be decrypted", async () => {
    users.getDecryptedUserNWC.mockResolvedValue(null);
    const result = await executeCampaignPayoutBatch(
      input({ scope: "CONTEST", contestId: "c1", winners: [payable()] })
    );

    expect(result.eligible).toBe(false);
    expect(result.eligibilityErrorCode).toBe("nwc_not_connected");
    expect(result.eligibilityErrorMessage).toBe(
      "Creator has no connected NWC wallet"
    );
    expect(result.totals.skipped).toBe(1);
    expect(users.getDecryptedUserNWC).toHaveBeenCalledWith("u1");
    const created = ledger.findOrCreatePayoutRunByIdempotencyKey.mock.calls[0];
    expect(created?.[0]).toEqual({});
    expect(created?.[1]).toEqual({
      idempotencyKey: "contest:c1",
      scope: "CONTEST",
      userId: "u1",
      walletMode: "nwc_creator",
      trigger: "manual_trigger",
      contestId: "c1",
      giveawayId: "g1",
      spendCapSats: null,
      totalItems: 1,
      totalSats: 100,
    });
  });

  it("keeps an existing startedAt and stores an explicit spend cap", async () => {
    const startedAt = new Date("2020-01-01T00:00:00.000Z");
    ledger.findOrCreatePayoutRunByIdempotencyKey.mockResolvedValue({
      id: "run_1",
      startedAt,
    });
    await executeCampaignPayoutBatch(
      input({ spendCapSats: 50, winners: [payable()] })
    );

    expect(ledger.updatePayoutRun.mock.calls[0]?.[1].startedAt).toBe(startedAt);
    expect(ledger.updatePayoutRun.mock.calls[0]?.[1].status).toBe("running");
    expect(
      ledger.findOrCreatePayoutRunByIdempotencyKey.mock.calls[0]?.[1]
        .spendCapSats
    ).toBe(50);
  });

  it("fails the run when the spend cap is not a whole number of sats", async () => {
    const result = await executeCampaignPayoutBatch(
      input({ spendCapSats: -1, winners: [payable(), payable(20, OTHER)] })
    );

    expect(result).toEqual({
      runId: "run_1",
      walletMode: "nwc_creator",
      eligible: true,
      eligibilityErrorCode: "invalid_spend_cap",
      eligibilityErrorMessage:
        "Spend cap must be a whole number of sats, or unset",
      totals: { items: 2, paid: 0, failed: 2, claimNeeded: 0, skipped: 0 },
    });
    expect(
      ledger.findOrCreatePayoutRunByIdempotencyKey.mock.calls[0]?.[1]
        .spendCapSats
    ).toBeNull();
    expect(lastUpdate()).toMatchObject({
      status: "failed",
      eligibilityErrorCode: "invalid_spend_cap",
    });
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();
    expect(invoices.fetchLnurlPayInvoice).not.toHaveBeenCalled();
  });

  it("uses contest and giveaway fallback keys when the campaign id is missing", async () => {
    await executeCampaignPayoutBatch(
      input({
        scope: "CONTEST",
        contestId: undefined,
        giveawayId: undefined,
        winners: [],
      })
    );
    expect(
      ledger.findOrCreatePayoutRunByIdempotencyKey.mock.calls[0]?.[1]
        .idempotencyKey
    ).toBe("contest:unknown");

    await executeCampaignPayoutBatch(
      input({ scope: "GIVEAWAY", giveawayId: undefined, winners: [] })
    );
    expect(
      ledger.findOrCreatePayoutRunByIdempotencyKey.mock.calls[1]?.[1]
        .idempotencyKey
    ).toBe("giveaway:unknown");
  });

  it("finishes an empty batch as partial and a paid batch as complete", async () => {
    const empty = await executeCampaignPayoutBatch(input({ winners: [] }));
    expect(empty.totals).toEqual({
      items: 0,
      paid: 0,
      failed: 0,
      claimNeeded: 0,
      skipped: 0,
    });
    expect(lastUpdate().status).toBe("partial");
    expect(lastUpdate().metadataJson).toEqual({
      paid: 0,
      failed: 0,
      claimNeeded: 0,
      skipped: 0,
    });

    useInvoice();
    claimApi.claimCampaignPayoutItem.mockResolvedValue({
      ok: true,
      itemId: "item_1",
      attemptKey: "attempt_1",
      attemptNumber: 1,
    });
    payApi.payAuthorizedBolt11.mockResolvedValue({
      ok: true,
      preimage: "ab".repeat(32),
      walletResponse: { preimage: "ab".repeat(32) },
      paymentHash: HASH,
      amountSats: 100,
    });
    const paid = await executeCampaignPayoutBatch(
      input({ winners: [payable()] })
    );
    expect(paid.totals.paid).toBe(1);
    expect(lastSettle()).toEqual({
      itemId: "item_1",
      attemptKey: "attempt_1",
      outcome: "paid",
      preimage: "ab".repeat(32),
      walletResponse: { preimage: "ab".repeat(32) },
    });
    expect(lastUpdate().status).toBe("complete");
    expect(logger.logError).not.toHaveBeenCalled();
  });

  it("rejects non-payable amounts and still claims only whole positive winners", async () => {
    useInvoice();
    const result = await executeCampaignPayoutBatch(
      input({
        spendCapSats: 0,
        winners: [
          withAmount(-3, OTHER),
          withAmount(0, "d".repeat(64)),
          withAmount(Number.NaN, "e".repeat(64)),
          withAmount("5"),
          payable(100),
        ],
      })
    );

    expect(result.totals).toEqual({
      items: 5,
      paid: 0,
      failed: 3,
      claimNeeded: 0,
      skipped: 2,
    });
    expect(lastUpdate().status).toBe("failed");
    expect(invoices.fetchLnurlPayInvoice).toHaveBeenCalledTimes(1);
    expect(claimApi.claimCampaignPayoutItem).toHaveBeenCalledTimes(1);
    expect(claimApi.claimCampaignPayoutItem.mock.calls[0]?.[0]).toMatchObject({
      amountSats: 100,
      winnerPubkey: WINNER,
      requestedSpendCapSats: 0,
      requestedWinners: [{ winnerPubkey: WINNER, amountSats: 100 }],
      resolutionHoldMs: 105_000,
      idempotencyKey: winnerItemKey("giveaway:g1", WINNER, 100),
    });
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();
  });

  it("counts zero-only and skipped claims as partial, and paid-plus-failed as partial", async () => {
    const zeros = await executeCampaignPayoutBatch(
      input({ winners: [withAmount(0)] })
    );
    expect(zeros.totals.skipped).toBe(1);
    expect(lastUpdate().status).toBe("partial");

    useInvoice();
    claimApi.claimCampaignPayoutItem.mockResolvedValue({
      ok: false,
      reason: "skipped",
      itemId: "item_1",
    });
    const skipped = await executeCampaignPayoutBatch(
      input({ winners: [payable()] })
    );
    expect(skipped.totals).toEqual({
      items: 1,
      paid: 0,
      failed: 0,
      claimNeeded: 0,
      skipped: 1,
    });
    expect(claimApi.recordUnpayableCampaignItem).not.toHaveBeenCalled();
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();

    claimApi.claimCampaignPayoutItem
      .mockResolvedValueOnce({
        ok: true,
        itemId: "item_1",
        attemptKey: "attempt_1",
        attemptNumber: 1,
      })
      .mockResolvedValueOnce({
        ok: false,
        reason: "not_claimable",
        message: "locked",
      });
    payApi.payAuthorizedBolt11.mockResolvedValue({
      ok: true,
      preimage: "ab".repeat(32),
      walletResponse: { ok: true },
      paymentHash: HASH,
      amountSats: 100,
    });
    const mixed = await executeCampaignPayoutBatch(
      input({ winners: [payable(100), payable(100, OTHER)] })
    );
    expect(mixed.totals.paid).toBe(1);
    expect(mixed.totals.failed).toBe(1);
    expect(lastUpdate().status).toBe("partial");
  });

  it("records a missing npub and maps invoice fetch failures", async () => {
    await executeCampaignPayoutBatch(
      input({
        winners: [
          {
            winnerPubkeyHex: "not-a-pubkey",
            amountSats: 100,
            winnerNpub: "   ",
            lnAddressSnapshot: "alice@example.com",
          },
        ],
      })
    );
    expect(lastRecord()).toMatchObject({
      status: "claim_needed",
      errorCode: "missing_destination",
      errorMessage: "Invalid winner pubkey (cannot derive npub)",
      idempotencyKey: winnerItemKey("giveaway:g1", "not-a-pubkey", 100),
    });
    expect(invoices.fetchLnurlPayInvoice).not.toHaveBeenCalled();

    await executeCampaignPayoutBatch(
      input({
        winners: [
          {
            winnerPubkeyHex: WINNER,
            amountSats: 80,
            winnerNpub: "  npub1test  ",
            lnAddressSnapshot: "  Bob@Wallet.example  ",
          },
        ],
      })
    );
    expect(invoices.fetchLnurlPayInvoice).toHaveBeenCalledWith(
      "https://wallet.example/.well-known/lnurlp/bob",
      80
    );
    expect(profiles.fetchPrimalProfileData).not.toHaveBeenCalled();
    expect(lastRecord()).toMatchObject({
      status: "claim_needed",
      errorCode: "invoice_fetch_failed",
      errorMessage: "not stubbed",
      lnAddressSnapshot: "Bob@Wallet.example",
    });

    invoices.fetchLnurlPayInvoice.mockResolvedValue({
      ok: false,
      code: "invalid_destination",
      detail: "no route",
    });
    await executeCampaignPayoutBatch(input({ winners: [payable(70)] }));
    expect(lastRecord()).toMatchObject({
      status: "claim_needed",
      errorCode: "missing_destination",
      errorMessage: "no route",
      lnAddressSnapshot: "alice@example.com",
    });
  });

  it("loads a profile lud16 and treats lookup failures as a missing destination", async () => {
    profiles.processPrimalData.mockReturnValue({
      profile: { lud16: "  Carol@Pay.example " },
    });
    await executeCampaignPayoutBatch(
      input({
        winners: [{ winnerPubkeyHex: WINNER, amountSats: 90 }],
      })
    );
    expect(profiles.fetchPrimalProfileData).toHaveBeenCalledTimes(1);
    const npub = profiles.fetchPrimalProfileData.mock.calls[0]?.[0];
    expect(npub?.startsWith("npub")).toBe(true);
    expect(profiles.processPrimalData).toHaveBeenCalledWith({ raw: true });
    expect(invoices.fetchLnurlPayInvoice).toHaveBeenCalledWith(
      "https://pay.example/.well-known/lnurlp/carol",
      90
    );

    profiles.fetchPrimalProfileData.mockRejectedValueOnce(new Error("down"));
    await executeCampaignPayoutBatch(
      input({ winners: [{ winnerPubkeyHex: WINNER, amountSats: 90 }] })
    );
    profiles.fetchPrimalProfileData.mockRejectedValueOnce("down");
    await executeCampaignPayoutBatch(
      input({ winners: [{ winnerPubkeyHex: WINNER, amountSats: 90 }] })
    );
    profiles.processPrimalData.mockImplementationOnce(() => {
      throw new Error("bad profile");
    });
    await executeCampaignPayoutBatch(
      input({ winners: [{ winnerPubkeyHex: WINNER, amountSats: 90 }] })
    );
    profiles.processPrimalData.mockReturnValueOnce({
      profile: { lud16: "  " },
    });
    await executeCampaignPayoutBatch(
      input({ winners: [{ winnerPubkeyHex: WINNER, amountSats: 90 }] })
    );
    profiles.processPrimalData.mockReturnValueOnce({ profile: { lud16: 12 } });
    await executeCampaignPayoutBatch(
      input({ winners: [{ winnerPubkeyHex: WINNER, amountSats: 90 }] })
    );

    const messages = claimApi.recordUnpayableCampaignItem.mock.calls.map(
      (call) => call[0].errorMessage
    );
    expect(
      messages.filter(
        (message) => message === "Winner has no Lightning address"
      )
    ).toHaveLength(5);
  });

  it("rejects lightning addresses that are not LUD-16", async () => {
    for (const lnAddressSnapshot of [
      "notaaddress",
      "@wallet.example",
      "alice@",
    ]) {
      claimApi.recordUnpayableCampaignItem.mockClear();
      await executeCampaignPayoutBatch(
        input({
          winners: [{ ...payable(), lnAddressSnapshot }],
        })
      );
      expect(lastRecord()).toMatchObject({
        status: "claim_needed",
        errorCode: "missing_destination",
        errorMessage: "Winner Lightning address is not a LUD-16 address",
        lnAddressSnapshot,
      });
      expect(invoices.fetchLnurlPayInvoice).not.toHaveBeenCalled();
    }
  });

  it("records budget, amount, and duplicate refusals, but not an unclaimable row", async () => {
    useInvoice();
    claimApi.claimCampaignPayoutItem.mockResolvedValueOnce({
      ok: false,
      reason: "amount_mismatch",
    });
    await executeCampaignPayoutBatch(input({ winners: [payable()] }));
    expect(lastRecord()).toMatchObject({
      status: "failed",
      errorCode: "amount_mismatch",
      errorMessage: REFUSAL,
    });

    claimApi.claimCampaignPayoutItem.mockResolvedValueOnce({
      ok: false,
      reason: "duplicate_invoice",
      message: "invoice already used",
    });
    await executeCampaignPayoutBatch(input({ winners: [payable()] }));
    expect(lastRecord()).toMatchObject({
      status: "failed",
      errorCode: "duplicate_invoice",
      errorMessage: "invoice already used",
    });

    claimApi.claimCampaignPayoutItem.mockResolvedValueOnce({
      ok: false,
      reason: "budget_exhausted",
      message: "cap hit",
    });
    await executeCampaignPayoutBatch(input({ winners: [payable()] }));
    expect(lastRecord().errorCode).toBe("budget_exhausted");

    const recorded = claimApi.recordUnpayableCampaignItem.mock.calls.length;
    claimApi.claimCampaignPayoutItem.mockResolvedValueOnce({
      ok: false,
      reason: "not_claimable",
    });
    const refused = await executeCampaignPayoutBatch(
      input({ winners: [payable()] })
    );
    expect(refused.totals.failed).toBe(1);
    expect(claimApi.recordUnpayableCampaignItem).toHaveBeenCalledTimes(
      recorded
    );
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();
  });

  it("treats a failed lookup as unpaid and does not settle an unknown hold", async () => {
    useInvoice();
    claimApi.claimCampaignPayoutItem.mockResolvedValue({
      ok: false,
      reason: "paying",
      itemId: "item_1",
      paymentHash: HASH,
      amountSats: 100,
    });
    payApi.lookupAuthorizedPayment.mockResolvedValue({ kind: "failed" });
    const paying = await executeCampaignPayoutBatch(
      input({ winners: [payable()] })
    );
    expect(paying.totals).toEqual({
      items: 1,
      paid: 0,
      failed: 0,
      claimNeeded: 1,
      skipped: 0,
    });
    expect(payApi.lookupAuthorizedPayment).toHaveBeenCalledWith({
      nwcUrl: NWC,
      paymentHash: HASH,
      authorizedSats: 100,
      timeoutMs: 15_000,
    });
    expect(lastSettle()).toEqual({
      itemId: "item_1",
      outcome: "unknown",
      errorCode: "reconciliation_required",
      errorMessage: RECONCILE,
    });
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();
    expect(lastUpdate().status).toBe("partial");

    claimApi.settleCampaignPayoutAttempt.mockClear();
    claimApi.claimCampaignPayoutItem.mockResolvedValue({
      ok: false,
      reason: "unknown",
      itemId: "item_1",
      paymentHash: HASH,
      amountSats: 100,
    });
    const unknown = await executeCampaignPayoutBatch(
      input({ winners: [payable()] })
    );
    expect(unknown.totals.claimNeeded).toBe(1);
    expect(claimApi.settleCampaignPayoutAttempt).not.toHaveBeenCalled();
  });

  it("marks an unknown hold paid only when lookup returns a preimage", async () => {
    useInvoice();
    claimApi.claimCampaignPayoutItem.mockResolvedValue({
      ok: false,
      reason: "unknown",
      itemId: "item_1",
      paymentHash: HASH,
      amountSats: 100,
    });
    payApi.lookupAuthorizedPayment.mockResolvedValueOnce({
      kind: "settled",
      preimage: null,
    });
    const withoutProof = await executeCampaignPayoutBatch(
      input({ winners: [payable()] })
    );
    expect(withoutProof.totals.paid).toBe(0);
    expect(withoutProof.totals.claimNeeded).toBe(1);
    expect(claimApi.settleCampaignPayoutAttempt).not.toHaveBeenCalled();

    payApi.lookupAuthorizedPayment.mockResolvedValueOnce({
      kind: "settled",
      preimage: "cd".repeat(32),
    });
    const settled = await executeCampaignPayoutBatch(
      input({ winners: [payable()] })
    );
    expect(settled.totals.paid).toBe(1);
    expect(lastSettle()).toEqual({
      itemId: "item_1",
      outcome: "paid",
      preimage: "cd".repeat(32),
    });
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();
  });

  it("does not look up a hold that cannot be reconciled", async () => {
    useInvoice();
    const holds: ClaimResult[] = [
      { ok: false, reason: "paying" },
      { ok: false, reason: "paying", itemId: "item_1", amountSats: 100 },
      {
        ok: false,
        reason: "paying",
        itemId: "item_1",
        paymentHash: HASH,
        amountSats: 0,
      },
      {
        ok: false,
        reason: "paying",
        itemId: "item_1",
        paymentHash: HASH,
        amountSats: 1.5,
      },
    ];
    for (const hold of holds) {
      payApi.lookupAuthorizedPayment.mockClear();
      claimApi.settleCampaignPayoutAttempt.mockClear();
      claimApi.claimCampaignPayoutItem.mockResolvedValue(hold);
      const result = await executeCampaignPayoutBatch(
        input({ winners: [payable()] })
      );
      expect(result.totals.claimNeeded).toBe(1);
      expect(payApi.lookupAuthorizedPayment).not.toHaveBeenCalled();
      expect(claimApi.settleCampaignPayoutAttempt.mock.calls.length).toBe(
        hold.itemId === undefined ? 0 : 1
      );
    }
    expect(lastSettle().outcome).toBe("unknown");
  });

  it("settles a rejected pay as failed and a timeout as unknown", async () => {
    const invoice = useInvoice();
    claimApi.claimCampaignPayoutItem.mockResolvedValue({
      ok: true,
      itemId: "item_1",
      attemptKey: "attempt_1",
      attemptNumber: 1,
    });
    payApi.payAuthorizedBolt11.mockResolvedValueOnce({
      ok: false,
      disposition: "rejected",
      code: "INSUFFICIENT_BALANCE",
      message: "no funds",
      paymentHash: null,
    });
    const rejected = await executeCampaignPayoutBatch(
      input({ scope: "CONTEST", contestId: "c9", winners: [payable()] })
    );
    expect(rejected.totals.failed).toBe(1);
    expect(rejected.totals.claimNeeded).toBe(0);
    expect(lastSettle()).toEqual({
      itemId: "item_1",
      attemptKey: "attempt_1",
      outcome: "failed",
      errorCode: "INSUFFICIENT_BALANCE",
      errorMessage: "no funds",
    });
    const logged = logger.logError.mock.calls[0];
    expect(logged?.[0]).toBeInstanceOf(Error);
    expect((logged?.[0] as Error).message).toBe("no funds");
    expect(logged?.[1]).toEqual({
      message: "Payout payInvoice failed",
      scope: "CONTEST",
      contestId: "c9",
      giveawayId: "g1",
      winnerPubkey: WINNER,
      disposition: "rejected",
    });
    expect(lastUpdate().status).toBe("failed");

    payApi.payAuthorizedBolt11.mockResolvedValueOnce({
      ok: false,
      disposition: "unknown",
      code: "TIMEOUT",
      message: "NWC payInvoice timeout",
      paymentHash: HASH,
    });
    const timedOut = await executeCampaignPayoutBatch(
      input({ winners: [payable()] })
    );
    expect(timedOut.totals.claimNeeded).toBe(1);
    expect(timedOut.totals.failed).toBe(0);
    expect(lastSettle()).toEqual({
      itemId: "item_1",
      attemptKey: "attempt_1",
      outcome: "unknown",
      errorCode: "TIMEOUT",
      errorMessage: "NWC payInvoice timeout",
    });
    expect(payApi.payAuthorizedBolt11).toHaveBeenCalledWith({
      nwcUrl: NWC,
      invoice,
      authorizedSats: 100,
      timeoutMs: 45_000,
      reconcileTimeoutMs: 15_000,
    });
  });
});

describe("executeCampaignPayoutBatchStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ledger.findOrCreatePayoutRunByIdempotencyKey.mockResolvedValue({
      id: "run_1",
      startedAt: null,
    });
    ledger.findPayoutRunByIdempotencyKey.mockResolvedValue({
      id: "run_1",
      metadataJson: null,
    });
    ledger.updatePayoutRun.mockResolvedValue({ id: "run_1" });
    claimApi.recordUnpayableCampaignItem.mockResolvedValue(undefined);
    claimApi.settleCampaignPayoutAttempt.mockResolvedValue("updated");
    users.getDecryptedUserNWC.mockResolvedValue(NWC);
    payApi.nwcTimeouts.mockReturnValue({ payMs: 45_000, reconcileMs: 15_000 });
    payApi.lookupAuthorizedPayment.mockResolvedValue({ kind: "inconclusive" });
  });

  it("rejects an empty batch and an out-of-range step without reading the wallet", async () => {
    const empty = await executeCampaignPayoutBatchStep(
      input({ walletMode: "manual", winners: [] }),
      0
    );
    expect(empty).toEqual({
      runId: null,
      walletMode: "nwc_creator",
      eligible: false,
      eligibilityErrorCode: "nwc_missing",
      eligibilityErrorMessage: "No winners to process",
      totals: { items: 0, paid: 0, failed: 0, claimNeeded: 0, skipped: 0 },
      stepIndex: 0,
      totalSteps: 0,
      done: true,
      nextStep: null,
    });

    const negative = await executeCampaignPayoutBatchStep(
      input({ winners: [payable()] }),
      -4
    );
    expect(negative.stepIndex).toBe(0);
    expect(negative.done).toBe(true);
    expect(negative.eligibilityErrorCode).toBe("nwc_missing");

    const past = await executeCampaignPayoutBatchStep(
      input({ winners: [payable(), payable(40, OTHER)] }),
      2
    );
    expect(past.stepIndex).toBe(2);
    expect(past.totalSteps).toBe(0);
    expect(users.getDecryptedUserNWC).not.toHaveBeenCalled();
    expect(ledger.withPayoutLedgerTransaction).not.toHaveBeenCalled();
  });

  it("stops step 0 when the wallet is ineligible", async () => {
    const startedAt = new Date("2021-05-01T00:00:00.000Z");
    ledger.findOrCreatePayoutRunByIdempotencyKey.mockResolvedValue({
      id: "run_1",
      startedAt,
    });
    users.getDecryptedUserNWC.mockResolvedValue(null);
    const result = await executeCampaignPayoutBatchStep(
      input({ winners: [payable(), payable(40, OTHER)] }),
      0
    );

    expect(result.done).toBe(true);
    expect(result.nextStep).toBeNull();
    expect(result.eligibilityErrorCode).toBe("nwc_not_connected");
    expect(result.totals.skipped).toBe(2);
    const skippedUpdate = ledger.updatePayoutRun.mock.calls[0]?.[1];
    expect(skippedUpdate?.status).toBe("skipped");
    expect(skippedUpdate?.eligibilityErrorCode).toBe("nwc_not_connected");
    expect(skippedUpdate?.startedAt).toBeUndefined();
    expect(skippedUpdate?.completedAt).toBeInstanceOf(Date);
  });

  it("reports a missing later step as not found even when the wallet is manual", async () => {
    ledger.findPayoutRunByIdempotencyKey.mockResolvedValue(null);
    const result = await executeCampaignPayoutBatchStep(
      input({
        walletMode: "manual",
        winners: [payable(), payable(40, OTHER)],
      }),
      1
    );

    expect(result).toEqual({
      runId: null,
      walletMode: "nwc_creator",
      eligible: false,
      eligibilityErrorCode: "nwc_missing",
      eligibilityErrorMessage:
        "Payout run not found  -  start batch from step 0",
      totals: { items: 2, paid: 0, failed: 0, claimNeeded: 0, skipped: 0 },
      stepIndex: 1,
      totalSteps: 2,
      done: true,
      nextStep: null,
    });
    expect(ledger.findPayoutRunByIdempotencyKey).toHaveBeenCalledWith(
      "giveaway:g1"
    );
    expect(ledger.updatePayoutRun).not.toHaveBeenCalled();
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();
  });

  it("stops a later step when the wallet becomes ineligible", async () => {
    users.getDecryptedUserNWC.mockResolvedValue(null);
    const result = await executeCampaignPayoutBatchStep(
      input({ winners: [payable(), payable(40, OTHER)] }),
      1
    );

    expect(result.runId).toBe("run_1");
    expect(result.eligibilityErrorCode).toBe("nwc_not_connected");
    expect(result.totals.skipped).toBe(2);
    expect(result.done).toBe(true);
    expect(ledger.updatePayoutRun).not.toHaveBeenCalled();
  });

  it("fails a step when the spend cap is invalid", async () => {
    const result = await executeCampaignPayoutBatchStep(
      input({
        spendCapSats: 1.5,
        winners: [payable(), payable(40, OTHER)],
      }),
      0
    );

    expect(result.eligibilityErrorCode).toBe("invalid_spend_cap");
    expect(result.eligible).toBe(true);
    expect(result.totals.failed).toBe(2);
    expect(result.done).toBe(true);
    expect(result.nextStep).toBeNull();
    expect(ledger.updatePayoutRun.mock.calls[0]?.[1].status).toBe("running");
    expect(lastUpdate().status).toBe("failed");
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();
  });

  it("accumulates earlier metadata and finishes on the last step", async () => {
    useInvoice(100);
    claimApi.claimCampaignPayoutItem.mockResolvedValue({
      ok: true,
      itemId: "item_1",
      attemptKey: "attempt_1",
      attemptNumber: 1,
    });
    payApi.payAuthorizedBolt11.mockResolvedValue({
      ok: true,
      preimage: "ab".repeat(32),
      walletResponse: { ok: true },
      paymentHash: HASH,
      amountSats: 100,
    });
    const first = await executeCampaignPayoutBatchStep(
      input({ winners: [payable(100), payable(40, OTHER)] }),
      0
    );
    expect(first).toMatchObject({
      done: false,
      nextStep: 1,
      stepIndex: 0,
      totalSteps: 2,
      totals: { items: 2, paid: 1, failed: 0, claimNeeded: 0, skipped: 0 },
    });
    expect(lastUpdate()).toMatchObject({
      status: "running",
      metadataJson: {
        paid: 1,
        failed: 0,
        claimNeeded: 0,
        skipped: 0,
        currentStep: 0,
        totalSteps: 2,
      },
    });

    ledger.findPayoutRunByIdempotencyKey.mockResolvedValue({
      id: "run_1",
      startedAt: null,
      metadataJson: { paid: 1, failed: 1, claimNeeded: 0, skipped: 0 },
    });
    useInvoice(40);
    const second = await executeCampaignPayoutBatchStep(
      input({ winners: [payable(100), payable(40, OTHER)] }),
      1
    );
    expect(second.done).toBe(true);
    expect(second.nextStep).toBeNull();
    expect(second.totals).toEqual({
      items: 2,
      paid: 2,
      failed: 1,
      claimNeeded: 0,
      skipped: 0,
    });
    expect(lastUpdate().status).toBe("partial");
    expect(lastUpdate().completedAt).toBeInstanceOf(Date);
    expect(lastUpdate().metadataJson).toEqual({
      paid: 2,
      failed: 1,
      claimNeeded: 0,
      skipped: 0,
    });
  });

  it("defaults missing metadata counters and closes a failed final step", async () => {
    ledger.findPayoutRunByIdempotencyKey.mockResolvedValue({
      id: "run_1",
      startedAt: null,
      metadataJson: { failed: 2 },
    });
    invoices.fetchLnurlPayInvoice.mockResolvedValue({
      ok: false,
      code: "invoice_fetch_failed",
      detail: "no route",
    });
    const result = await executeCampaignPayoutBatchStep(
      input({ winners: [payable()] }),
      0
    );
    expect(result.totals).toEqual({
      items: 1,
      paid: 0,
      failed: 2,
      claimNeeded: 1,
      skipped: 0,
    });
    expect(result.done).toBe(true);
    expect(lastUpdate().status).toBe("failed");
  });
});
