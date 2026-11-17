import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeBolt11 } from "../helpers/bolt11-fixture";

const { payInvoice, getInfo, getBudget, close } = vi.hoisted(() => ({
  payInvoice: vi.fn(),
  getInfo: vi.fn(),
  getBudget: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@getalby/sdk", () => ({
  NWCClient: class {
    payInvoice = payInvoice;
    getInfo = getInfo;
    getBudget = getBudget;
    close = close;
    constructor(_opts?: unknown) {}
  },
}));

import {
  assertUserNwcCanPay,
  classifyNwcPayError,
  NwcChargeError,
  nwcChargeFailureNotice,
  payBolt11WithUserNwc,
} from "~/features/payments/services/nwc-user-pay.server";

const USER_PREIMAGE = "ab".repeat(32);
const USER_HASH = createHash("sha256")
  .update(Buffer.from(USER_PREIMAGE, "hex"))
  .digest("hex");

function payableInvoice(): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return makeBolt11({
    amountSats: 100,
    paymentHashHex: USER_HASH,
    timestampSeconds: nowSeconds - 30,
    expirySeconds: 3600,
  });
}

describe("nwc user pay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInfo.mockResolvedValue({ methods: ["pay_invoice", "get_budget"] });
    getBudget.mockResolvedValue({});
    payInvoice.mockResolvedValue({ preimage: USER_PREIMAGE });
  });

  it("requires a matching preimage before treating a wallet payment as successful", async () => {
    payInvoice.mockResolvedValue({ fees_paid: 1, preimage: "cd".repeat(32) });

    await expect(
      payBolt11WithUserNwc("nwc://user", payableInvoice())
    ).rejects.toEqual(
      expect.objectContaining({
        name: "NwcChargeError",
        kind: "unconfirmed",
      })
    );
    expect(payInvoice).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
  });

  it("returns the preimage and closes the client", async () => {
    await expect(
      payBolt11WithUserNwc("nwc://user", payableInvoice())
    ).resolves.toBe(USER_PREIMAGE);
    expect(close).toHaveBeenCalled();
  });

  it("classifies a pay timeout as unconfirmed", async () => {
    payInvoice.mockImplementation(() => new Promise(() => undefined));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = payBolt11WithUserNwc("nwc://user", payableInvoice());
      const assertion = expect(pending).rejects.toBeInstanceOf(NwcChargeError);
      await vi.advanceTimersByTimeAsync(55_000);
      await assertion;
      await expect(pending).rejects.toMatchObject({ kind: "unconfirmed" });
    } finally {
      vi.useRealTimers();
    }
    expect(close).toHaveBeenCalled();
  });

  it("does not treat a generic payment failed message as a wallet rejection", () => {
    expect(classifyNwcPayError(new Error("payment failed"))).toBe(
      "unconfirmed"
    );
  });

  it("classifies quota errors as a wallet rejection", () => {
    const error = new Error("Quota exceeded");
    error.name = "Nip47WalletError";
    Object.assign(error, { code: "QUOTA_EXCEEDED" });
    expect(classifyNwcPayError(error)).toBe("wallet_rejected");
    expect(nwcChargeFailureNotice("wallet_rejected")).toContain("budget");
  });

  it("does not create a charge when the wallet cannot be reached", async () => {
    getInfo.mockRejectedValue(new Error("websocket closed"));

    await expect(assertUserNwcCanPay("nwc://user")).rejects.toMatchObject({
      kind: "connection_dead",
    });
    expect(nwcChargeFailureNotice("connection_dead")).toContain("Reconnect");
  });

  it("stops before payment when the spending budget is used up", async () => {
    getBudget.mockResolvedValue({
      total_budget: 1000,
      used_budget: 1000,
      renewal_period: "monthly",
    });

    await expect(assertUserNwcCanPay("nwc://user")).rejects.toMatchObject({
      kind: "wallet_rejected",
    });
  });

  it("continues when the wallet does not report a budget", async () => {
    getBudget.mockRejectedValue(new Error("NOT_IMPLEMENTED"));
    await expect(assertUserNwcCanPay("nwc://user")).resolves.toBeUndefined();
  });

  it("rejects a connection that cannot pay invoices", async () => {
    getInfo.mockResolvedValue({ methods: ["get_balance"] });
    await expect(assertUserNwcCanPay("nwc://user")).rejects.toMatchObject({
      kind: "connection_dead",
    });
  });
});
