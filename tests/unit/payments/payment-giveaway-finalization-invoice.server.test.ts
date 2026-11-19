import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FeeQuote {
  plannedPayoutSats: number;
  feeRateBps: number;
  feeSats: number;
  waivedByPlan: boolean;
  lockConfigHash: string;
  dueNowSats: number;
}

interface Collection {
  kind: "waived" | "settled" | "honor_pending" | "collect";
  quote: FeeQuote;
  expireIds: string[];
  paymentId: string | null;
  recordId: string;
}

interface GiveawayRow {
  id: string;
  status: string;
  winnerSnapshot: unknown;
  engagementConfig: unknown;
  winnerCount: number;
  plannedPayoutSats: number | null;
  selectionMode: string;
  scopeType: string;
  scopeReference: unknown;
  engagementTypes: unknown;
  filters: unknown;
  engagementWeights: unknown;
  activityLog: unknown;
}

interface StoredInvoice {
  invoice: string;
  paymentHash: string;
  amount: number;
  expiresAt: Date;
  paymentId: string;
}

interface WalletCapture {
  onPaid: (() => void) | null;
  onTimeout: (() => void) | null;
  timeoutSeconds: number | null;
}

const NOW = 1_700_000_000_000;
const HASH = "hash-1";

const envState = vi.hoisted(() => {
  const env: { OWNER_NWC?: string } = {
    OWNER_NWC: "nostr+walletconnect://owner",
  };
  return { env };
});

const giveaways = vi.hoisted(() => ({
  findGiveawayByIdAndUser: vi.fn(
    async (_id: string, _userId: string): Promise<GiveawayRow | null> => null
  ),
}));

const quotes = vi.hoisted(() => ({
  quoteGiveawayFinalization: vi.fn(
    (_input: {
      giveaway: Record<string, unknown>;
      planType: string;
    }): FeeQuote => ({
      plannedPayoutSats: 10_000,
      feeRateBps: 500,
      feeSats: 1000,
      waivedByPlan: false,
      lockConfigHash: "hash-1",
      dueNowSats: 1000,
    })
  ),
}));

const records = vi.hoisted(() => ({
  expireGiveawayFinalizationByIds: vi.fn(
    async (_ids: string[]): Promise<void> => undefined
  ),
  findReusableGiveawayFinalizationInvoice: vi.fn(
    async (_paymentId: string): Promise<unknown> => null
  ),
  listGiveawayFinalizationRecords: vi.fn(
    async (_giveawayId: string, _userId: string): Promise<unknown[]> => []
  ),
}));

const collections = vi.hoisted(() => ({
  resolveFinalizationCollection: vi.fn(
    (input: {
      current: FeeQuote;
      records: unknown[];
      nowMs: number;
    }): Collection => ({
      kind: "collect",
      quote: input.current,
      expireIds: [],
      paymentId: null,
      recordId: "",
    })
  ),
}));

const guards = vi.hoisted(() => ({
  acceptFinalizationWalletInvoice: vi.fn(
    (_args: {
      request: unknown;
      authorizedSats: number;
    }): {
      ok: boolean;
      invoice?: string;
      paymentHash?: string;
      amountSats?: number;
      expiresAtMs?: number;
      error?: string;
    } => ({
      ok: true,
      invoice: "lnbc1pay",
      paymentHash: "ph",
      amountSats: 1000,
      expiresAtMs: 1_700_000_120_000,
    })
  ),
  acceptedStoredFinalizationInvoice: vi.fn(
    (_existing: unknown, _authorizedSats: number): StoredInvoice | null => null
  ),
}));

const locks = vi.hoisted(() => ({
  isUniqueConstraintError: (error: unknown): boolean => {
    if (typeof error !== "object" || error === null || !("code" in error)) {
      return false;
    }
    return error["code"] === "P2002";
  },
  runLockedFinalizationCreate: vi.fn(
    async (
      _key: string,
      _run: (tx: unknown) => Promise<unknown>
    ): Promise<unknown> => {
      throw new Error("finalization lock was not armed");
    }
  ),
}));

const wallet = vi.hoisted(() => ({
  getOwnerNwcWithRelayOverrides: vi.fn(
    (ownerNwc: string): { credentials: string; relays: string[] } => ({
      credentials: `${ownerNwc}&relay=wss://relay.example`,
      relays: ["wss://relay.example"],
    })
  ),
  isLikelyWebsocketRelayError: vi.fn((message: string): boolean =>
    message.toLowerCase().includes("failed to connect to any relay")
  ),
}));

const handlers = vi.hoisted(() => ({
  handlePaymentCompleted: vi.fn(
    async (
      _paymentId: string,
      _userId: string,
      _preimage: string
    ): Promise<void> => undefined
  ),
  handlePaymentTimeout: vi.fn(
    async (_paymentId: string): Promise<void> => undefined
  ),
}));

const queries = vi.hoisted(() => ({
  getUserSubscription: vi.fn(
    async (
      _userId: string
    ): Promise<{
      planId: string;
      status: string;
      currentPeriodEnd?: Date | null;
      Plan?: { name: string; id: string };
    } | null> => null
  ),
}));

const logger = vi.hoisted(() => ({
  logError: vi.fn(
    (_error: unknown, _context?: Record<string, unknown>): void => undefined
  ),
}));

const tx = vi.hoisted(() => ({
  payment: {
    create: vi.fn(async (_args: { data: Record<string, unknown> }) => ({})),
  },
  giveawayFinalizationPayment: {
    create: vi.fn(async (_args: { data: Record<string, unknown> }) => ({})),
  },
  giveaway: {
    update: vi.fn(
      async (_args: {
        where: { id: string };
        data: { activityLog: unknown };
      }) => ({})
    ),
  },
}));

const ln = vi.hoisted(() => {
  const constructed: string[] = [];
  const requestPayment = vi.fn(
    async (_amount: { amount: number }): Promise<unknown> => {
      throw new Error("requestPayment was not armed");
    }
  );
  class FakeLN {
    readonly requestPayment = requestPayment;

    constructor(credentials: string) {
      constructed.push(credentials);
    }
  }
  return {
    constructed,
    requestPayment,
    FakeLN,
    SATS: vi.fn((amount: number): { amount: number } => ({ amount })),
  };
});

vi.mock("@getalby/sdk/lnclient", () => ({
  LN: ln.FakeLN,
  SATS: ln.SATS,
}));
vi.mock("~/features/giveaway/giveaway-finalization-fee.server", () => quotes);
vi.mock(
  "~/features/giveaway/repositories/giveaway-actions-data.server",
  () => giveaways
);
vi.mock(
  "~/features/giveaway/repositories/giveaway-finalization-payment.server",
  () => records
);
vi.mock("~/features/payments/campaign-finalization-charge", () => collections);
vi.mock("~/features/payments/finalization-invoice-guard", () => guards);
vi.mock(
  "~/features/payments/data/finalization-invoice-lock.server",
  () => locks
);
vi.mock("~/features/payments/data/payment-shared.server", () => wallet);
vi.mock("~/features/payments/data/payment.handlers.server", () => handlers);
vi.mock("~/features/payments/data/payment.queries.server", () => queries);
vi.mock("~/lib/env.server", () => ({ env: envState.env }));
vi.mock("~/lib/error-logger.server", () => logger);

import { createGiveawayFinalizationInvoice } from "~/features/payments/data/payment-giveaway-finalization-invoice.server";
import { ExternalServiceError } from "~/lib/errors";

const capture: WalletCapture = {
  onPaid: null,
  onTimeout: null,
  timeoutSeconds: null,
};

function quote(feeSats = 1000, lockConfigHash = HASH): FeeQuote {
  return {
    plannedPayoutSats: 10_000,
    feeRateBps: 500,
    feeSats,
    waivedByPlan: feeSats <= 0,
    lockConfigHash,
    dueNowSats: feeSats,
  };
}

function collection(
  kind: Collection["kind"],
  overrides: Partial<Collection> = {}
): Collection {
  return {
    kind,
    quote: quote(),
    expireIds: [],
    paymentId: kind === "honor_pending" ? "pay-open" : null,
    recordId: kind === "honor_pending" ? "rec-1" : "",
    ...overrides,
  };
}

function giveawayRow(status = "PREVIEWED"): GiveawayRow {
  return {
    id: "giveaway-1",
    status,
    winnerSnapshot: [{ pubkey: "winner" }],
    engagementConfig: { REACTION: { winnerCount: 1, satsPerWinner: 100 } },
    winnerCount: 1,
    plannedPayoutSats: 100,
    selectionMode: "UNIQUE_USER",
    scopeType: "PERIOD",
    scopeReference: { days: 7 },
    engagementTypes: ["REACTION"],
    filters: { excludeMuted: true },
    engagementWeights: { REACTION: 1 },
    activityLog: [{ type: "previewed" }],
  };
}

function storedInvoice(): StoredInvoice {
  return {
    invoice: "lnbc1stored",
    paymentHash: "stored-hash",
    amount: 1000,
    expiresAt: new Date(NOW + 60_000),
    paymentId: "pay-stored",
  };
}

async function create(lockConfigHash = HASH) {
  return createGiveawayFinalizationInvoice({
    giveawayId: "giveaway-1",
    userId: "user-1",
    lockConfigHash,
  });
}

async function serviceError(
  run: () => Promise<unknown>
): Promise<ExternalServiceError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ExternalServiceError) return error;
    throw error;
  }
  throw new Error("expected ExternalServiceError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function lastRecord(value: unknown): Record<string, unknown> | null {
  if (!isUnknownArray(value)) return null;
  const entry = value[value.length - 1];
  return isRecord(entry) ? entry : null;
}

function paidSubscription() {
  return {
    planId: "pro",
    status: "ACTIVE",
    currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
    Plan: { name: "Pro", id: "pro" },
  };
}

describe("createGiveawayFinalizationInvoice", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.clearAllMocks();
    envState.env.OWNER_NWC = "nostr+walletconnect://owner";
    ln.constructed.length = 0;
    capture.onPaid = null;
    capture.onTimeout = null;
    capture.timeoutSeconds = null;
    giveaways.findGiveawayByIdAndUser.mockResolvedValue(giveawayRow());
    queries.getUserSubscription.mockResolvedValue(paidSubscription());
    quotes.quoteGiveawayFinalization.mockReturnValue(quote());
    records.listGiveawayFinalizationRecords.mockResolvedValue([]);
    records.expireGiveawayFinalizationByIds.mockResolvedValue(undefined);
    records.findReusableGiveawayFinalizationInvoice.mockResolvedValue(null);
    collections.resolveFinalizationCollection.mockImplementation((input) =>
      collection("collect", { quote: input.current })
    );
    guards.acceptedStoredFinalizationInvoice.mockReturnValue(null);
    guards.acceptFinalizationWalletInvoice.mockReturnValue({
      ok: true,
      invoice: "lnbc1pay",
      paymentHash: "ph",
      amountSats: 1000,
      expiresAtMs: NOW + 120_000,
    });
    wallet.getOwnerNwcWithRelayOverrides.mockImplementation((ownerNwc) => ({
      credentials: `${ownerNwc}&relay=wss://relay.example`,
      relays: ["wss://relay.example"],
    }));
    wallet.isLikelyWebsocketRelayError.mockImplementation((message) =>
      message.toLowerCase().includes("failed to connect to any relay")
    );
    ln.requestPayment.mockImplementation(async () => ({
      onPaid: (callback: () => void) => {
        capture.onPaid = callback;
        return {
          onTimeout: (seconds: number, timeoutCallback: () => void) => {
            capture.timeoutSeconds = seconds;
            capture.onTimeout = timeoutCallback;
          },
        };
      },
      onTimeout: () => undefined,
    }));
    locks.runLockedFinalizationCreate.mockImplementation(
      async (_key: string, run: (client: typeof tx) => Promise<unknown>) =>
        run(tx)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a missing or unpreviewed giveaway before quoting", async () => {
    giveaways.findGiveawayByIdAndUser.mockResolvedValueOnce(null);
    await expect(create()).rejects.toThrow("Giveaway not found");
    giveaways.findGiveawayByIdAndUser.mockResolvedValueOnce(
      giveawayRow("DRAFT")
    );
    await expect(create()).rejects.toThrow(
      "Only previewed giveaways can pay a finalization fee"
    );
    expect(queries.getUserSubscription).not.toHaveBeenCalled();
    expect(quotes.quoteGiveawayFinalization).not.toHaveBeenCalled();
  });

  it("rejects a stale preview hash after quoting the caller's plan", async () => {
    queries.getUserSubscription.mockResolvedValueOnce(null);
    await expect(create("stale")).rejects.toThrow(
      "This preview changed after the fee was quoted. Refresh and try again."
    );
    expect(quotes.quoteGiveawayFinalization).toHaveBeenCalledWith({
      giveaway: {
        winnerSnapshot: [{ pubkey: "winner" }],
        engagementConfig: { REACTION: { winnerCount: 1, satsPerWinner: 100 } },
        winnerCount: 1,
        plannedPayoutSats: 100,
        selectionMode: "UNIQUE_USER",
        scopeType: "PERIOD",
        scopeReference: { days: 7 },
        engagementTypes: ["REACTION"],
        filters: { excludeMuted: true },
        engagementWeights: { REACTION: 1 },
      },
      planType: "free",
    });
    expect(records.listGiveawayFinalizationRecords).not.toHaveBeenCalled();
  });

  it("expires waived ids, and no ids when a collect quote is already zero", async () => {
    collections.resolveFinalizationCollection.mockReturnValueOnce(
      collection("waived", { quote: quote(0), expireIds: ["a", "b"] })
    );
    await expect(create()).rejects.toThrow(
      "No finalization fee is due for this giveaway"
    );
    expect(records.expireGiveawayFinalizationByIds).toHaveBeenCalledWith([
      "a",
      "b",
    ]);

    collections.resolveFinalizationCollection.mockReturnValueOnce(
      collection("collect", { quote: quote(0), expireIds: ["keep"] })
    );
    await expect(create()).rejects.toThrow(
      "No finalization fee is due for this giveaway"
    );
    expect(records.expireGiveawayFinalizationByIds).toHaveBeenLastCalledWith(
      []
    );
    expect(locks.runLockedFinalizationCreate).not.toHaveBeenCalled();
  });

  it("refuses a settled preview and reuses an open invoice", async () => {
    collections.resolveFinalizationCollection.mockReturnValueOnce(
      collection("settled", { paymentId: "pay-paid" })
    );
    await expect(create()).rejects.toThrow(
      "The finalization fee for this preview is already paid"
    );
    expect(records.expireGiveawayFinalizationByIds).not.toHaveBeenCalled();

    const existing = storedInvoice();
    collections.resolveFinalizationCollection.mockReturnValueOnce(
      collection("honor_pending", {
        quote: quote(1000, "hash-honored"),
        paymentId: "pay-open",
        recordId: "rec-1",
      })
    );
    records.findReusableGiveawayFinalizationInvoice.mockResolvedValueOnce({
      id: "pay-open",
    });
    guards.acceptedStoredFinalizationInvoice.mockReturnValueOnce(existing);
    await expect(create()).resolves.toEqual({
      ...existing,
      amountUsd: null,
      lockConfigHash: "hash-honored",
    });
    expect(guards.acceptedStoredFinalizationInvoice).toHaveBeenCalledWith(
      { id: "pay-open" },
      1000
    );
    expect(locks.runLockedFinalizationCreate).not.toHaveBeenCalled();
  });

  it("expires a stale open invoice and then creates a replacement", async () => {
    collections.resolveFinalizationCollection
      .mockReturnValueOnce(
        collection("honor_pending", {
          expireIds: ["ignored"],
          recordId: "rec-1",
        })
      )
      .mockImplementation((input) =>
        collection("collect", { quote: input.current, expireIds: ["old"] })
      );
    const created = await create();
    expect(records.expireGiveawayFinalizationByIds).toHaveBeenNthCalledWith(1, [
      "rec-1",
    ]);
    expect(records.expireGiveawayFinalizationByIds).toHaveBeenNthCalledWith(2, [
      "old",
    ]);
    expect(created.paymentId).toBe(`gf_giveaway-1_${NOW}_user-1`);
    expect(created.amount).toBe(1000);
  });

  it("throws when the owner wallet is not configured", async () => {
    envState.env.OWNER_NWC = undefined;
    await expect(create()).rejects.toThrow(
      "Owner NWC credentials not configured"
    );
    expect(ln.FakeLN).toBeTruthy();
    expect(ln.constructed).toEqual([]);
    expect(locks.runLockedFinalizationCreate).not.toHaveBeenCalled();
  });

  it("creates the payment, logs the quote, and subscribes to paid and timeout", async () => {
    const created = await create();
    expect(locks.runLockedFinalizationCreate).toHaveBeenCalledWith(
      `giveaway-finalization:giveaway-1:${HASH}`,
      expect.any(Function)
    );
    expect(wallet.getOwnerNwcWithRelayOverrides).toHaveBeenCalledWith(
      "nostr+walletconnect://owner"
    );
    expect(ln.constructed).toEqual([
      "nostr+walletconnect://owner&relay=wss://relay.example",
    ]);
    expect(ln.SATS).toHaveBeenCalledWith(1000);
    expect(ln.requestPayment).toHaveBeenCalledWith({ amount: 1000 });
    expect(created).toEqual({
      invoice: "lnbc1pay",
      paymentHash: "ph",
      amount: 1000,
      amountUsd: null,
      expiresAt: new Date(NOW + 120_000),
      paymentId: `gf_giveaway-1_${NOW}_user-1`,
      lockConfigHash: HASH,
    });
    expect(capture.timeoutSeconds).toBe(120);
    expect(tx.payment.create).toHaveBeenCalledWith({
      data: {
        id: created.paymentId,
        userId: "user-1",
        amount: 1000,
        amountUsd: null,
        invoice: "lnbc1pay",
        paymentHash: "ph",
        status: "PENDING",
        purpose: "GIVEAWAY_FINALIZATION",
        description: "Giveaway finalization: giveaway-1",
        expiresAt: new Date(NOW + 120_000),
      },
    });
    expect(tx.giveawayFinalizationPayment.create).toHaveBeenCalledWith({
      data: {
        giveawayId: "giveaway-1",
        userId: "user-1",
        planName: "Pro",
        feeRateBps: 500,
        plannedPayoutSats: 10_000,
        feeSats: 1000,
        lockConfigHash: HASH,
        status: "PENDING",
        paymentId: created.paymentId,
      },
    });
    const activity = tx.giveaway.update.mock.calls[0]?.[0].data.activityLog;
    const entry = lastRecord(activity);
    if (!entry) throw new Error("expected activity log");
    expect(entry["type"]).toBe("fee_quoted");
    expect(entry["payload"]).toEqual({
      feeSats: 1000,
      feeRateBps: 500,
      plannedPayoutSats: 10_000,
      planName: "Pro",
      lockConfigHash: HASH,
    });

    capture.onPaid?.();
    capture.onTimeout?.();
    expect(handlers.handlePaymentCompleted).toHaveBeenCalledWith(
      created.paymentId,
      "user-1",
      ""
    );
    expect(handlers.handlePaymentTimeout).toHaveBeenCalledWith(
      created.paymentId
    );
  });

  it("caps the invoice lifetime at 30 minutes and never waits less than a second", async () => {
    guards.acceptFinalizationWalletInvoice.mockReturnValueOnce({
      ok: true,
      invoice: "lnbc1pay",
      paymentHash: "ph",
      amountSats: 1000,
      expiresAtMs: NOW + 60 * 60 * 1000,
    });
    const capped = await create();
    expect(capped.expiresAt).toEqual(new Date(NOW + 30 * 60 * 1000));
    expect(capture.timeoutSeconds).toBe(30 * 60);

    guards.acceptFinalizationWalletInvoice.mockReturnValueOnce({
      ok: true,
      invoice: "lnbc1pay",
      paymentHash: "ph",
      amountSats: 1000,
      expiresAtMs: NOW - 5_000,
    });
    await create();
    expect(capture.timeoutSeconds).toBe(1);
  });

  it("stores Free when the caller has no active subscription", async () => {
    queries.getUserSubscription.mockResolvedValueOnce(null);
    await create();
    expect(quotes.quoteGiveawayFinalization).toHaveBeenCalledWith(
      expect.objectContaining({ planType: "free" })
    );
    expect(
      tx.giveawayFinalizationPayment.create.mock.calls[0]?.[0].data
    ).toMatchObject({
      planName: "Free",
    });
  });

  it("returns an invoice discovered again inside the lock without attaching listeners", async () => {
    const existing = storedInvoice();
    collections.resolveFinalizationCollection
      .mockReturnValueOnce(collection("collect"))
      .mockReturnValueOnce(
        collection("honor_pending", {
          quote: quote(1000, "hash-locked"),
          paymentId: "pay-open",
        })
      );
    guards.acceptedStoredFinalizationInvoice.mockReturnValueOnce(existing);
    await expect(create()).resolves.toEqual({
      ...existing,
      amountUsd: null,
      lockConfigHash: "hash-locked",
    });
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(handlers.handlePaymentCompleted).not.toHaveBeenCalled();
  });

  it("wraps a changed quote inside the lock as a provider failure", async () => {
    collections.resolveFinalizationCollection
      .mockReturnValueOnce(collection("collect"))
      .mockReturnValueOnce(collection("settled"));
    const settled = await serviceError(() => create());
    expect(settled.statusCode).toBe(502);
    expect(settled.message).toBe(
      "Failed to create payment invoice. Please try again later."
    );
    expect(settled.context).toMatchObject({
      giveawayId: "giveaway-1",
      userId: "user-1",
      ownerRelays: ["wss://relay.example"],
      originalError: "The finalization fee for this preview is already paid",
    });

    collections.resolveFinalizationCollection
      .mockReturnValueOnce(collection("collect", { quote: quote(1000) }))
      .mockReturnValueOnce(collection("collect", { quote: quote(900) }));
    const changed = await serviceError(() => create());
    expect(changed.context).toMatchObject({
      originalError: "No finalization fee is due for this giveaway",
    });

    collections.resolveFinalizationCollection
      .mockReturnValueOnce(collection("collect"))
      .mockReturnValueOnce(collection("waived"));
    const waived = await serviceError(() => create());
    expect(waived.context).toMatchObject({
      originalError: "No finalization fee is due for this giveaway",
    });
  });

  it("wraps an invalid wallet response and a rejected wallet request", async () => {
    guards.acceptFinalizationWalletInvoice.mockReturnValueOnce({
      ok: false,
      error: "amount mismatch",
    });
    const invalid = await serviceError(() => create());
    expect(invalid.context).toMatchObject({
      originalError: "Invalid response from payment provider - amount mismatch",
    });

    ln.requestPayment.mockRejectedValueOnce(
      new ExternalServiceError("too slow", 504)
    );
    const slow = await serviceError(() => create());
    expect(slow).toBeInstanceOf(ExternalServiceError);
    expect(slow.statusCode).toBe(504);
    expect(slow.message).toBe("too slow");
    expect(logger.logError).toHaveBeenCalledWith(
      slow,
      expect.objectContaining({
        message: "Failed to create giveaway finalization invoice",
        ownerRelays: ["wss://relay.example"],
      })
    );

    ln.requestPayment.mockRejectedValueOnce(
      new Error("failed to connect to any relay")
    );
    const relay = await serviceError(() => create());
    expect(relay.statusCode).toBe(503);
    expect(relay.message).toContain("cannot reach the Lightning relay");
    expect(relay.context).toMatchObject({
      originalError: "failed to connect to any relay",
    });

    ln.requestPayment.mockRejectedValueOnce("wallet string");
    const text = await serviceError(() => create());
    expect(text.statusCode).toBe(502);
    expect(text.context).toMatchObject({ originalError: "wallet string" });
  });

  it("returns the stored invoice after a unique constraint and wraps the rest", async () => {
    const unique = new Error("duplicate");
    Object.assign(unique, { code: "P2002" });
    const existing = storedInvoice();
    locks.runLockedFinalizationCreate.mockRejectedValueOnce(unique);
    collections.resolveFinalizationCollection
      .mockReturnValueOnce(collection("collect"))
      .mockReturnValueOnce(
        collection("honor_pending", {
          quote: quote(1000, "hash-unique"),
          paymentId: "pay-open",
        })
      );
    guards.acceptedStoredFinalizationInvoice.mockReturnValueOnce(existing);
    await expect(create()).resolves.toEqual({
      ...existing,
      amountUsd: null,
      lockConfigHash: "hash-unique",
    });

    locks.runLockedFinalizationCreate.mockRejectedValueOnce(unique);
    collections.resolveFinalizationCollection
      .mockReturnValueOnce(collection("collect"))
      .mockReturnValueOnce(collection("settled"));
    const wrapped = await serviceError(() => create());
    expect(wrapped.statusCode).toBe(502);
    expect(wrapped.context).toMatchObject({ originalError: "duplicate" });

    locks.runLockedFinalizationCreate.mockRejectedValueOnce({ code: "P2003" });
    const other = await serviceError(() => create());
    expect(other.statusCode).toBe(502);
    expect(other.context).toMatchObject({ originalError: "[object Object]" });
  });

  it("propagates lookup failures that happen before invoice creation", async () => {
    giveaways.findGiveawayByIdAndUser.mockRejectedValueOnce(
      new Error("db down")
    );
    await expect(create()).rejects.toThrow("db down");
    giveaways.findGiveawayByIdAndUser.mockRejectedValueOnce("db string");
    await expect(create()).rejects.toBe("db string");
  });
});
