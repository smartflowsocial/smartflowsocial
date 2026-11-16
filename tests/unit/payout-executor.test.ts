import { beforeEach, describe, expect, it, vi } from "vitest";

const ledger = vi.hoisted(() => ({
  withPayoutLedgerTransaction: vi.fn(
    async (fn: (tx: unknown) => Promise<unknown>) => fn({})
  ),
  findOrCreatePayoutRunByIdempotencyKey: vi.fn(),
  findPayoutRunByIdempotencyKey: vi.fn(),
  updatePayoutRun: vi.fn(),
}));

const claimApi = vi.hoisted(() => ({
  claimCampaignPayoutItem: vi.fn(),
  recordUnpayableCampaignItem: vi.fn(),
  settleCampaignPayoutAttempt: vi.fn(),
}));

const payApi = vi.hoisted(() => ({
  payAuthorizedBolt11: vi.fn(),
  lookupAuthorizedPayment: vi.fn(),
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
vi.mock("~/features/user", () => ({
  getDecryptedUserNWC: vi.fn(),
}));
vi.mock("~/features/auth/profile.server", () => ({
  fetchPrimalProfileData: vi.fn(),
  processPrimalData: vi.fn(),
}));
vi.mock("~/features/referral/lnurl-pay.server", () => ({
  fetchLnurlPayInvoice: vi.fn(),
}));

import { freshInvoiceForSats } from "../helpers/bolt11-fixture";

import { executeCampaignPayoutBatch } from "~/features/payments/services/payout-executor.server";
import { fetchLnurlPayInvoice } from "~/features/referral/lnurl-pay.server";
import { getDecryptedUserNWC } from "~/features/user";

const WINNER = "b".repeat(64);
const HASH = "22".repeat(32);

function input(amountSats: number, spendCapSats?: number) {
  return {
    scope: "GIVEAWAY" as const,
    giveawayId: "g1",
    creatorUserId: "u1",
    trigger: "manual_trigger" as const,
    walletMode: "nwc_creator" as const,
    spendCapSats,
    winners: [
      {
        winnerPubkeyHex: WINNER,
        amountSats,
        winnerNpub: "npub1test",
        lnAddressSnapshot: "alice@example.com",
      },
    ],
  };
}

describe("executeCampaignPayoutBatch", () => {
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
    payApi.lookupAuthorizedPayment.mockResolvedValue({ kind: "inconclusive" });
    vi.mocked(getDecryptedUserNWC).mockResolvedValue(
      "nostr+walletconnect://test"
    );
  });

  it("creates a run and skips when the creator has no NWC", async () => {
    vi.mocked(getDecryptedUserNWC).mockResolvedValue(null);
    const res = await executeCampaignPayoutBatch({
      ...input(100),
      scope: "CONTEST",
      contestId: "c1",
      trigger: "autorun",
    });
    expect(res.eligible).toBe(false);
    expect(res.runId).toBe("run_1");
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();
    expect(claimApi.claimCampaignPayoutItem).not.toHaveBeenCalled();
  });

  it("pays one matching invoice and marks the item paid", async () => {
    const invoice = freshInvoiceForSats(123, HASH);
    vi.mocked(fetchLnurlPayInvoice).mockResolvedValue({ ok: true, invoice });
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
      amountSats: 123,
    });

    const res = await executeCampaignPayoutBatch(input(123));
    expect(res.totals.paid).toBe(1);
    expect(payApi.payAuthorizedBolt11).toHaveBeenCalledWith(
      expect.objectContaining({ invoice, authorizedSats: 123 })
    );
    expect(claimApi.settleCampaignPayoutAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "paid", itemId: "item_1" })
    );
  });

  it("does not pay an invoice one sat above or below the winner amount", async () => {
    vi.mocked(fetchLnurlPayInvoice).mockResolvedValue({
      ok: true,
      invoice: freshInvoiceForSats(101, HASH),
    });
    const above = await executeCampaignPayoutBatch(input(100));
    expect(above.totals.paid).toBe(0);
    expect(above.totals.failed).toBe(1);
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();
    expect(claimApi.claimCampaignPayoutItem).not.toHaveBeenCalled();

    vi.mocked(fetchLnurlPayInvoice).mockResolvedValue({
      ok: true,
      invoice: freshInvoiceForSats(99, HASH),
    });
    const below = await executeCampaignPayoutBatch(input(100));
    expect(below.totals.failed).toBe(1);
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();
  });

  it("does not pay an amountless or corrupt invoice", async () => {
    vi.mocked(fetchLnurlPayInvoice).mockResolvedValue({
      ok: false,
      code: "invoice_rejected",
      detail: "Amountless BOLT11 invoices cannot be paid",
    });
    const res = await executeCampaignPayoutBatch(input(100));
    expect(res.totals.paid).toBe(0);
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();
    expect(claimApi.recordUnpayableCampaignItem).toHaveBeenCalled();
  });

  it("does not pay when the campaign budget is exhausted", async () => {
    vi.mocked(fetchLnurlPayInvoice).mockResolvedValue({
      ok: true,
      invoice: freshInvoiceForSats(100, HASH),
    });
    claimApi.claimCampaignPayoutItem.mockResolvedValue({
      ok: false,
      reason: "budget_exhausted",
      message: "Invoice amount exceeds the campaign's remaining budget",
    });
    const res = await executeCampaignPayoutBatch(input(100, 0));
    expect(res.totals.paid).toBe(0);
    expect(res.totals.failed).toBe(1);
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();
  });

  it("does not pay a winner who is already paid", async () => {
    vi.mocked(fetchLnurlPayInvoice).mockResolvedValue({
      ok: true,
      invoice: freshInvoiceForSats(100, HASH),
    });
    claimApi.claimCampaignPayoutItem.mockResolvedValue({
      ok: false,
      reason: "already_paid",
      itemId: "item_1",
    });
    const res = await executeCampaignPayoutBatch(input(100));
    expect(res.totals.paid).toBe(0);
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();
  });

  it("marks a timeout unknown and does not pay it again", async () => {
    vi.mocked(fetchLnurlPayInvoice).mockResolvedValue({
      ok: true,
      invoice: freshInvoiceForSats(100, HASH),
    });
    claimApi.claimCampaignPayoutItem
      .mockResolvedValueOnce({
        ok: true,
        itemId: "item_1",
        attemptKey: "attempt_1",
        attemptNumber: 1,
      })
      .mockResolvedValueOnce({
        ok: false,
        reason: "unknown",
        itemId: "item_1",
        paymentHash: HASH,
        amountSats: 100,
      });
    payApi.payAuthorizedBolt11.mockResolvedValue({
      ok: false,
      disposition: "unknown",
      code: "UNCONFIRMED",
      message: "NWC payInvoice timeout",
      paymentHash: HASH,
    });
    payApi.lookupAuthorizedPayment.mockResolvedValue({ kind: "inconclusive" });

    const first = await executeCampaignPayoutBatch(input(100));
    expect(first.totals.claimNeeded).toBe(1);
    expect(claimApi.settleCampaignPayoutAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "unknown" })
    );

    const second = await executeCampaignPayoutBatch(input(100));
    expect(second.totals.paid).toBe(0);
    expect(payApi.payAuthorizedBolt11).toHaveBeenCalledTimes(1);
    expect(payApi.lookupAuthorizedPayment).toHaveBeenCalled();
  });

  it("marks a held payout paid when lookup shows it settled", async () => {
    vi.mocked(fetchLnurlPayInvoice).mockResolvedValue({
      ok: true,
      invoice: freshInvoiceForSats(100, HASH),
    });
    claimApi.claimCampaignPayoutItem.mockResolvedValue({
      ok: false,
      reason: "paying",
      itemId: "item_1",
      paymentHash: HASH,
      amountSats: 100,
    });
    payApi.lookupAuthorizedPayment.mockResolvedValue({
      kind: "settled",
      preimage: "ab".repeat(32),
    });
    const res = await executeCampaignPayoutBatch(input(100));
    expect(res.totals.paid).toBe(1);
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();
    expect(claimApi.settleCampaignPayoutAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "paid" })
    );
  });

  it("rejects a fractional winner amount without calling the wallet", async () => {
    const res = await executeCampaignPayoutBatch(input(1.5));
    expect(res.totals.failed).toBe(1);
    expect(payApi.payAuthorizedBolt11).not.toHaveBeenCalled();
    expect(vi.mocked(fetchLnurlPayInvoice)).not.toHaveBeenCalled();
  });
});
