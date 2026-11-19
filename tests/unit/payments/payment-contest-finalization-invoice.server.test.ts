import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface ContestRow {
  status: string;
  sourceNoteId: string | null;
  rankingMetric: string;
  contestEndAt: Date;
  prizeMode: string;
  winnerCount: number;
  equalRewardSats: number | null;
  rankRewards: unknown;
  fairnessConfig: unknown;
  tieBreakRule: string | null;
  freezeSnapshotAt: Date | null;
}

interface FeeQuote {
  plannedPayoutSats: number;
  feeRateBps: number;
  feeSats: number;
  waivedByPlan: boolean;
  lockConfigHash: string;
}

interface StoredInvoice {
  invoice: string;
  paymentHash: string;
  amount: number;
  expiresAt: Date;
  paymentId: string;
}

interface AcceptedInvoice {
  ok: true;
  invoice: string;
  paymentHash: string;
  amountSats: number;
  expiresAtMs: number;
}

interface RejectedInvoice {
  ok: false;
  error: string;
}

interface WalletListeners {
  paid: Array<() => void>;
  timeouts: Array<{ seconds: number; callback: () => void }>;
}

interface CreatedInvoice {
  response: StoredInvoice & { lockConfigHash: string };
  attach: () => void;
}

interface TxClient {
  payment: {
    create: ReturnType<
      typeof vi.fn<
        (args: { data: Record<string, unknown> }) => Promise<unknown>
      >
    >;
  };
  contestFinalizationPayment: {
    create: ReturnType<
      typeof vi.fn<
        (args: { data: Record<string, unknown> }) => Promise<unknown>
      >
    >;
  };
}

const contests = vi.hoisted(() => ({
  getContestById:
    vi.fn<(contestId: string, userId: string) => Promise<ContestRow | null>>(),
  appendContestEventLog:
    vi.fn<
      (
        userId: string,
        contestId: string,
        action: string,
        message: string,
        data: Record<string, unknown>
      ) => Promise<void>
    >(),
}));

const quotes = vi.hoisted(() => ({
  quoteContestFinalization:
    vi.fn<
      (input: {
        planType: string;
        contest: Record<string, unknown>;
      }) => FeeQuote
    >(),
}));

const records = vi.hoisted(() => ({
  listContestFinalizationRecords:
    vi.fn<(contestId: string, userId: string) => Promise<unknown[]>>(),
  findReusableContestFinalizationInvoice:
    vi.fn<(paymentId: string) => Promise<unknown>>(),
  expireContestFinalizationByIds: vi.fn<(ids: string[]) => Promise<void>>(),
}));

const collectionApi = vi.hoisted(() => ({
  resolveFinalizationCollection: vi.fn<
    (input: { current: FeeQuote; records: unknown[]; nowMs: number }) => {
      kind: string;
      quote: FeeQuote;
      expireIds?: string[];
      paymentId?: string;
      recordId?: string;
    }
  >(),
}));

const guard = vi.hoisted(() => ({
  acceptFinalizationWalletInvoice:
    vi.fn<
      (args: {
        request: unknown;
        authorizedSats: number;
      }) => AcceptedInvoice | RejectedInvoice
    >(),
  acceptedStoredFinalizationInvoice:
    vi.fn<
      (existing: unknown, authorizedSats: number) => StoredInvoice | null
    >(),
}));

const plans = vi.hoisted(() => ({
  getUserPlanType: vi.fn<(subscription: unknown) => string>(),
  getPlanDisplayName: vi.fn<(subscription: unknown) => string>(),
}));

const envState = vi.hoisted(() => ({
  OWNER_NWC: "nostr+walletconnect://owner?relay=wss%3A%2F%2Frelay.example",
  OWNER_NWC_RELAY: undefined as string | undefined,
  OWNER_NWC_RELAYS: undefined as string | undefined,
}));

const logger = vi.hoisted(() => ({
  logError:
    vi.fn<(error: unknown, context?: Record<string, unknown>) => void>(),
}));

const subscriptions = vi.hoisted(() => ({
  getUserSubscription: vi.fn<(userId: string) => Promise<unknown>>(),
}));

const handlers = vi.hoisted(() => ({
  handlePaymentCompleted:
    vi.fn<
      (paymentId: string, userId: string, planId: string) => Promise<void>
    >(),
  handlePaymentTimeout: vi.fn<(paymentId: string) => Promise<void>>(),
}));

const locks = vi.hoisted(() => ({
  runLockedFinalizationCreate:
    vi.fn<
      (
        lockKey: string,
        run: (tx: TxClient) => Promise<CreatedInvoice>
      ) => Promise<CreatedInvoice>
    >(),
  isUniqueConstraintError: (error: unknown): boolean =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002",
}));

const wallet = vi.hoisted(() => ({
  urls: [] as string[],
  requestPayment: vi.fn<(amount: { amount: number }) => Promise<unknown>>(),
}));

vi.mock("~/features/contest/contest-actions-queries.server", () => ({
  getContestById: contests.getContestById,
}));
vi.mock("~/features/contest/contest-actions-crud.server", () => ({
  appendContestEventLog: contests.appendContestEventLog,
}));
vi.mock("~/features/contest/contest-finalization-fee.server", () => quotes);
vi.mock(
  "~/features/contest/repositories/contest-finalization-payment.server",
  () => records
);
vi.mock(
  "~/features/payments/campaign-finalization-charge",
  () => collectionApi
);
vi.mock("~/features/payments/finalization-invoice-guard", () => guard);
vi.mock("~/features/payments/types", () => plans);
vi.mock("~/lib/env.server", () => ({ env: envState }));
vi.mock("~/lib/error-logger.server", () => logger);
vi.mock("~/features/payments/data/payment.queries.server", () => subscriptions);
vi.mock("~/features/payments/data/payment.handlers.server", () => handlers);
vi.mock(
  "~/features/payments/data/finalization-invoice-lock.server",
  () => locks
);
interface OwnerWalletTimeoutModule {
  OWNER_NWC_MISSING: string;
  withOwnerWalletInvoiceRequestTimeout: <T>(promise: Promise<T>) => Promise<T>;
}

vi.mock(
  "~/features/payments/data/payment-owner-wallet-invoice-timeout.server",
  async () => {
    const actual = await vi.importActual<OwnerWalletTimeoutModule>(
      "~/features/payments/data/payment-owner-wallet-invoice-timeout.server"
    );
    return {
      ...actual,
      withOwnerWalletInvoiceRequestTimeout: (promise: Promise<unknown>) =>
        promise,
    };
  }
);
vi.mock("@getalby/sdk/lnclient", () => ({
  LN: class LN {
    constructor(url: string) {
      wallet.urls.push(url);
    }

    requestPayment(amount: { amount: number }): Promise<unknown> {
      return wallet.requestPayment(amount);
    }
  },
  SATS: (amount: number) => ({ amount }),
}));

import { createContestFinalizationInvoice } from "~/features/payments/data/payment-contest-finalization-invoice.server";
import { ExternalServiceError } from "~/lib/errors";

const NO_FEE = "No finalization fee is due for this contest";
const ALREADY_PAID = "The finalization fee for this preview is already paid";
const USER = "user-1";
const CONTEST = "contest-1";

const quote: FeeQuote = {
  plannedPayoutSats: 1_000,
  feeRateBps: 500,
  feeSats: 50,
  waivedByPlan: false,
  lockConfigHash: "hash-1",
};

const tx: TxClient = {
  payment: {
    create:
      vi.fn<(args: { data: Record<string, unknown> }) => Promise<unknown>>(),
  },
  contestFinalizationPayment: {
    create:
      vi.fn<(args: { data: Record<string, unknown> }) => Promise<unknown>>(),
  },
};

function contest(overrides: Partial<ContestRow> = {}): ContestRow {
  return {
    status: "ENDED_REVIEW",
    sourceNoteId: "  note-1  ",
    rankingMetric: "zaps",
    contestEndAt: new Date("2024-01-01T00:00:00.000Z"),
    prizeMode: "equal",
    winnerCount: 1,
    equalRewardSats: 1_000,
    rankRewards: [{ rank: 1, amountSats: 10 }],
    fairnessConfig: { floor: 1 },
    tieBreakRule: "oldest",
    freezeSnapshotAt: new Date("2024-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

function listeners(): WalletListeners {
  const paid: Array<() => void> = [];
  const timeouts: Array<{ seconds: number; callback: () => void }> = [];
  wallet.requestPayment.mockResolvedValue({
    onPaid(callback: () => void) {
      paid.push(callback);
      return {
        onTimeout(seconds: number, callbackTimeout: () => void) {
          timeouts.push({ seconds, callback: callbackTimeout });
        },
      };
    },
  });
  return { paid, timeouts };
}

function collect(fee: FeeQuote = quote, expireIds: string[] = ["old-1"]) {
  return { kind: "collect", quote: fee, expireIds };
}

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

describe("createContestFinalizationInvoice", () => {
  const subscription = { id: "sub-1", planId: "starter" };

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    envState.OWNER_NWC =
      "nostr+walletconnect://owner?relay=wss%3A%2F%2Frelay.example";
    wallet.urls.length = 0;
    contests.getContestById.mockResolvedValue(contest());
    contests.appendContestEventLog.mockResolvedValue(undefined);
    quotes.quoteContestFinalization.mockReturnValue(quote);
    records.listContestFinalizationRecords.mockResolvedValue([]);
    records.findReusableContestFinalizationInvoice.mockResolvedValue({
      id: "stored",
    });
    records.expireContestFinalizationByIds.mockResolvedValue(undefined);
    collectionApi.resolveFinalizationCollection.mockReturnValue(collect());
    guard.acceptedStoredFinalizationInvoice.mockReturnValue(null);
    guard.acceptFinalizationWalletInvoice.mockReturnValue({
      ok: true,
      invoice: "lnbc50",
      paymentHash: "ab".repeat(32),
      amountSats: 50,
      expiresAtMs: Date.now() + 10 * 60 * 1000,
    });
    plans.getUserPlanType.mockReturnValue("starter");
    plans.getPlanDisplayName.mockReturnValue("Starter");
    subscriptions.getUserSubscription.mockResolvedValue(subscription);
    handlers.handlePaymentCompleted.mockResolvedValue(undefined);
    handlers.handlePaymentTimeout.mockResolvedValue(undefined);
    tx.payment.create.mockResolvedValue({ id: "payment" });
    tx.contestFinalizationPayment.create.mockResolvedValue({ id: "fee" });
    locks.runLockedFinalizationCreate.mockImplementation(async (_key, run) =>
      run(tx)
    );
    listeners();
  });

  it("rejects a missing contest, the wrong status, a blank note, and a stale hash", async () => {
    contests.getContestById.mockResolvedValueOnce(null);
    await expect(
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    ).rejects.toThrow("Contest not found");

    contests.getContestById.mockResolvedValueOnce(
      contest({ status: "ACTIVE" })
    );
    await expect(
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    ).rejects.toThrow("Only contests in review can pay a finalization fee");

    contests.getContestById.mockResolvedValueOnce(
      contest({ sourceNoteId: "   " })
    );
    await expect(
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    ).rejects.toThrow("Contest is missing a source note id.");

    await expect(
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "stale",
      })
    ).rejects.toThrow(
      "This preview changed after the fee was quoted. Refresh and try again."
    );
    expect(records.listContestFinalizationRecords).not.toHaveBeenCalled();
    const quoted = quotes.quoteContestFinalization.mock.calls[0]?.[0];
    expect(quoted?.planType).toBe("starter");
    expect(quoted?.contest["sourceNoteId"]).toBe("note-1");
    expect(quoted?.contest["snapshotId"]).toBe("2024-06-01T00:00:00.000Z");
    expect(plans.getUserPlanType).toHaveBeenCalledWith(subscription);
  });

  it("expires a waived quote and a zero-fee collect before asking the wallet", async () => {
    collectionApi.resolveFinalizationCollection.mockReturnValueOnce({
      kind: "waived",
      quote: { ...quote, feeSats: 0 },
      expireIds: ["old-a", "old-b"],
    });
    await expect(
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    ).rejects.toThrow(NO_FEE);
    expect(records.expireContestFinalizationByIds).toHaveBeenCalledWith([
      "old-a",
      "old-b",
    ]);

    collectionApi.resolveFinalizationCollection.mockReturnValueOnce({
      kind: "collect",
      quote: { ...quote, feeSats: 0 },
      expireIds: ["ignored"],
    });
    await expect(
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    ).rejects.toThrow(NO_FEE);
    expect(records.expireContestFinalizationByIds).toHaveBeenLastCalledWith([]);
    expect(wallet.requestPayment).not.toHaveBeenCalled();
  });

  it("refuses a settled quote and reuses an open invoice", async () => {
    collectionApi.resolveFinalizationCollection.mockReturnValueOnce({
      kind: "settled",
      quote,
      paymentId: "paid-1",
    });
    await expect(
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    ).rejects.toThrow(ALREADY_PAID);

    const stored: StoredInvoice = {
      invoice: "lnbc40",
      paymentHash: "cd".repeat(32),
      amount: 40,
      expiresAt: new Date("2026-02-02T00:00:00.000Z"),
      paymentId: "pay-open",
    };
    collectionApi.resolveFinalizationCollection.mockReturnValueOnce({
      kind: "honor_pending",
      quote: { ...quote, feeSats: 40, lockConfigHash: "hash-open" },
      paymentId: "pay-open",
      recordId: "rec-open",
    });
    guard.acceptedStoredFinalizationInvoice.mockReturnValueOnce(stored);
    await expect(
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    ).resolves.toEqual({ ...stored, lockConfigHash: "hash-open" });
    expect(records.findReusableContestFinalizationInvoice).toHaveBeenCalledWith(
      "pay-open"
    );
    expect(locks.runLockedFinalizationCreate).not.toHaveBeenCalled();
  });

  it("expires an unusable open invoice and creates a capped replacement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const openQuote = { ...quote, feeSats: 40, lockConfigHash: "hash-open" };
    collectionApi.resolveFinalizationCollection
      .mockReturnValueOnce({
        kind: "honor_pending",
        quote: openQuote,
        paymentId: "pay-open",
        recordId: "rec-open",
      })
      .mockReturnValueOnce(collect(openQuote, ["inside"]));
    guard.acceptedStoredFinalizationInvoice.mockReturnValue(null);
    guard.acceptFinalizationWalletInvoice.mockReturnValue({
      ok: true,
      invoice: "lnbc40",
      paymentHash: "ef".repeat(32),
      amountSats: 40,
      expiresAtMs: Date.parse("2026-01-01T02:00:00.000Z"),
    });
    const hooked = listeners();
    const result = await createContestFinalizationInvoice({
      contestId: CONTEST,
      userId: USER,
      lockConfigHash: "hash-1",
    });

    expect(records.expireContestFinalizationByIds).toHaveBeenNthCalledWith(1, [
      "rec-open",
    ]);
    expect(records.expireContestFinalizationByIds).toHaveBeenNthCalledWith(2, [
      "inside",
    ]);
    expect(wallet.urls).toEqual([
      "nostr+walletconnect://owner?relay=wss%3A%2F%2Frelay.example",
    ]);
    expect(wallet.requestPayment).toHaveBeenCalledWith({ amount: 40 });
    expect(locks.runLockedFinalizationCreate.mock.calls[0]?.[0]).toBe(
      "contest-finalization:contest-1:hash-open"
    );
    expect(result.expiresAt.toISOString()).toBe("2026-01-01T00:30:00.000Z");
    expect(result.amount).toBe(40);
    expect(result.invoice).toBe("lnbc40");
    expect(result.lockConfigHash).toBe("hash-open");
    expect(result.paymentId).toMatch(/^cf_contest-1_\d+_user-1$/);
    expect(tx.payment.create.mock.calls[0]?.[0].data).toMatchObject({
      id: result.paymentId,
      userId: USER,
      amount: 40,
      amountUsd: null,
      invoice: "lnbc40",
      paymentHash: "ef".repeat(32),
      status: "PENDING",
      purpose: "CONTEST_FINALIZATION",
      description: "Contest finalization: contest-1",
      expiresAt: result.expiresAt,
    });
    expect(
      tx.contestFinalizationPayment.create.mock.calls[0]?.[0].data
    ).toEqual({
      contestId: CONTEST,
      userId: USER,
      planName: "Starter",
      feeRateBps: 500,
      plannedPayoutSats: 1_000,
      feeSats: 40,
      lockConfigHash: "hash-open",
      status: "PENDING",
      paymentId: result.paymentId,
    });
    expect(contests.appendContestEventLog).toHaveBeenCalledWith(
      USER,
      CONTEST,
      "fee_quoted",
      "Finalization fee invoice created",
      { feeSats: 40, feeRateBps: 500 }
    );
    expect(hooked.timeouts[0]?.seconds).toBe(1_800);
    hooked.paid[0]?.();
    hooked.timeouts[0]?.callback();
    expect(handlers.handlePaymentCompleted).toHaveBeenCalledWith(
      result.paymentId,
      USER,
      ""
    );
    expect(handlers.handlePaymentTimeout).toHaveBeenCalledWith(
      result.paymentId
    );
  });

  it("returns the open invoice found inside the lock without attaching listeners", async () => {
    const stored: StoredInvoice = {
      invoice: "lnbc50",
      paymentHash: "ab".repeat(32),
      amount: 50,
      expiresAt: new Date("2026-03-03T00:00:00.000Z"),
      paymentId: "pay-locked",
    };
    collectionApi.resolveFinalizationCollection
      .mockReturnValueOnce(collect())
      .mockReturnValueOnce({
        kind: "honor_pending",
        quote,
        paymentId: "pay-locked",
        recordId: "rec-locked",
      });
    guard.acceptedStoredFinalizationInvoice.mockReturnValueOnce(stored);
    const result = await createContestFinalizationInvoice({
      contestId: CONTEST,
      userId: USER,
      lockConfigHash: "hash-1",
    });
    expect(result).toEqual({ ...stored, lockConfigHash: "hash-1" });
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(wallet.requestPayment).not.toHaveBeenCalled();
  });

  it("refuses to create when the locked quote is no longer collectable", async () => {
    collectionApi.resolveFinalizationCollection
      .mockReturnValueOnce(collect())
      .mockReturnValueOnce({ kind: "settled", quote, paymentId: "paid" });
    await expect(
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    ).rejects.toThrow(ALREADY_PAID);
    expect(logger.logError).toHaveBeenCalled();

    logger.logError.mockClear();
    collectionApi.resolveFinalizationCollection
      .mockReturnValueOnce(collect())
      .mockReturnValueOnce({
        kind: "honor_pending",
        quote,
        paymentId: "pay-stale",
        recordId: "rec-stale",
      });
    guard.acceptedStoredFinalizationInvoice.mockReturnValue(null);
    await expect(
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    ).rejects.toThrow(NO_FEE);

    collectionApi.resolveFinalizationCollection
      .mockReturnValueOnce(collect())
      .mockReturnValueOnce(collect({ ...quote, feeSats: 10 }));
    await expect(
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    ).rejects.toThrow(NO_FEE);
  });

  it("rethrows an invalid wallet invoice and a missing owner wallet", async () => {
    envState.OWNER_NWC = undefined;
    await expect(
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    ).rejects.toThrow("Owner NWC credentials not configured");
    expect(logger.logError).not.toHaveBeenCalled();

    envState.OWNER_NWC = "nostr+walletconnect://owner";
    guard.acceptFinalizationWalletInvoice.mockReturnValue({
      ok: false,
      error: "bad hash",
    });
    const invalid = await caught(() =>
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    );
    expect(invalid).toBeInstanceOf(Error);
    expect((invalid as Error).message).toBe(
      "Invalid response from payment provider - bad hash"
    );
    expect(logger.logError).toHaveBeenCalled();
  });

  it("recovers a unique-constraint race and otherwise wraps the failure", async () => {
    const stored: StoredInvoice = {
      invoice: "lnbc50",
      paymentHash: "ab".repeat(32),
      amount: 50,
      expiresAt: new Date("2026-04-04T00:00:00.000Z"),
      paymentId: "pay-race",
    };
    const unique = new Error("unique");
    (unique as Error & { code: string }).code = "P2002";
    locks.runLockedFinalizationCreate.mockRejectedValueOnce(unique);
    collectionApi.resolveFinalizationCollection
      .mockReturnValueOnce(collect())
      .mockReturnValueOnce({
        kind: "honor_pending",
        quote,
        paymentId: "pay-race",
        recordId: "rec-race",
      });
    guard.acceptedStoredFinalizationInvoice.mockReturnValueOnce(stored);
    await expect(
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    ).resolves.toEqual({ ...stored, lockConfigHash: "hash-1" });
    expect(logger.logError).not.toHaveBeenCalled();

    locks.runLockedFinalizationCreate.mockRejectedValueOnce({ code: "P2002" });
    collectionApi.resolveFinalizationCollection
      .mockReturnValueOnce(collect())
      .mockReturnValueOnce({ kind: "collect", quote, expireIds: [] });
    const wrapped = await caught(() =>
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    );
    expect(wrapped).toBeInstanceOf(ExternalServiceError);
    expect((wrapped as ExternalServiceError).statusCode).toBe(502);
    expect((wrapped as ExternalServiceError).message).toBe(
      "Failed to create payment invoice. Please try again later."
    );

    const relay = new Error("timeout talking to relay");
    locks.runLockedFinalizationCreate.mockRejectedValueOnce(relay);
    const unavailable = await caught(() =>
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    );
    expect(unavailable).toBeInstanceOf(ExternalServiceError);
    expect((unavailable as ExternalServiceError).statusCode).toBe(503);
    expect((unavailable as ExternalServiceError).message).toContain(
      "temporarily unavailable"
    );

    const upstream = new ExternalServiceError("upstream", 504);
    locks.runLockedFinalizationCreate.mockRejectedValueOnce(upstream);
    await expect(
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    ).rejects.toBe(upstream);

    locks.runLockedFinalizationCreate.mockRejectedValueOnce("wallet string");
    const fromString = await caught(() =>
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    );
    expect(fromString).toBeInstanceOf(ExternalServiceError);
    expect((fromString as ExternalServiceError).statusCode).toBe(502);

    locks.runLockedFinalizationCreate.mockRejectedValueOnce(
      new Error("Contest changed")
    );
    await expect(
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    ).rejects.toThrow("Contest changed");
  });

  it("wraps a listener failure after the invoice row is created", async () => {
    locks.runLockedFinalizationCreate.mockResolvedValueOnce({
      response: {
        invoice: "lnbc50",
        paymentHash: "ab".repeat(32),
        amount: 50,
        expiresAt: new Date("2026-05-05T00:00:00.000Z"),
        paymentId: "pay-attach",
        lockConfigHash: "hash-1",
      },
      attach() {
        throw new Error("wallet listener failed");
      },
    });
    const error = await caught(() =>
      createContestFinalizationInvoice({
        contestId: CONTEST,
        userId: USER,
        lockConfigHash: "hash-1",
      })
    );
    expect(error).toBeInstanceOf(ExternalServiceError);
    expect((error as ExternalServiceError).statusCode).toBe(502);
    expect(logger.logError).toHaveBeenCalled();
  });

  it("uses a one-second timeout when the wallet expiry is already past", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    guard.acceptFinalizationWalletInvoice.mockReturnValue({
      ok: true,
      invoice: "lnbc50",
      paymentHash: "ab".repeat(32),
      amountSats: 50,
      expiresAtMs: Date.parse("2025-12-31T23:00:00.000Z"),
    });
    const hooked = listeners();
    const result = await createContestFinalizationInvoice({
      contestId: CONTEST,
      userId: USER,
      lockConfigHash: "hash-1",
    });
    expect(result.expiresAt.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(hooked.timeouts[0]?.seconds).toBe(1);
  });
});
