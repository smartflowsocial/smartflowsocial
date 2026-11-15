import { describe, expect, it } from "vitest";

import {
  ACCOUNT_DELETE_CONFIRMATION,
  ACCOUNT_DELETE_RELAY_ACK,
} from "~/features/user/account-data.constants";
import {
  deletionRequestIsConfirmed,
  toRetainedFinancialRecord,
} from "~/features/user/data/account-data.server";

describe("account deletion confirmation", () => {
  it("requires the exact phrase and the relay acknowledgement", () => {
    expect(
      deletionRequestIsConfirmed({
        confirm: ACCOUNT_DELETE_CONFIRMATION,
        acknowledgeRelays: ACCOUNT_DELETE_RELAY_ACK,
      })
    ).toBe(true);
    expect(
      deletionRequestIsConfirmed({
        confirm: "DELETE MY ACCOUNT",
        acknowledgeRelays: ACCOUNT_DELETE_RELAY_ACK,
      })
    ).toBe(false);
    expect(
      deletionRequestIsConfirmed({
        confirm: ACCOUNT_DELETE_CONFIRMATION,
        acknowledgeRelays: null,
      })
    ).toBe(false);
  });

  it("keeps payment facts without a public key", () => {
    const createdAt = new Date("2026-11-01T00:00:00.000Z");
    const row = toRetainedFinancialRecord({
      id: "pay_1",
      amount: 1000,
      status: "PAID",
      purpose: "SUBSCRIPTION",
      paymentHash: "ab",
      paidAt: createdAt,
      createdAt,
    });
    expect(row).toEqual({
      paymentId: "pay_1",
      amountSats: 1000,
      status: "PAID",
      purpose: "SUBSCRIPTION",
      paymentHash: "ab",
      paidAt: createdAt,
      paymentCreatedAt: createdAt,
    });
    expect(row).not.toHaveProperty("npub");
    expect(row).not.toHaveProperty("invoice");
    expect(row).not.toHaveProperty("preimage");
  });
});
