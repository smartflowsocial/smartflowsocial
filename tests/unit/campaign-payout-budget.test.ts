import { describe, expect, it } from "vitest";

import {
  authorizedCampaignBudgetSats,
  budgetAllowsNextPayment,
  readSpendCap,
  reservedPayoutSats,
} from "~/features/payments/campaign-payout-budget";

describe("campaign payout budget", () => {
  const winners = [
    { winnerPubkey: "a", amountSats: 600 },
    { winnerPubkey: "b", amountSats: 600 },
  ];

  it("rejects a fractional or negative spend cap", () => {
    expect(readSpendCap(10.5).ok).toBe(false);
    expect(readSpendCap(-1).ok).toBe(false);
    expect(readSpendCap(undefined)).toEqual({ ok: true, spendCapSats: null });
    expect(readSpendCap(0)).toEqual({ ok: true, spendCapSats: 0 });
  });

  it("does not let a later request raise a stored winner amount", () => {
    const budget = authorizedCampaignBudgetSats({
      spendCapSats: null,
      items: [{ winnerPubkey: "a", amountSats: 100, status: "pending" }],
      requested: [{ winnerPubkey: "a", amountSats: 1_000_000 }],
    });
    expect(budget).toEqual({ ok: true, capSats: 100 });
  });

  it("stops at the spend cap even when winner allocations are larger", () => {
    const budget = authorizedCampaignBudgetSats({
      spendCapSats: 600,
      items: [],
      requested: winners,
    });
    expect(budget).toEqual({ ok: true, capSats: 600 });
    if (!budget.ok) return;
    expect(
      budgetAllowsNextPayment({
        capSats: budget.capSats,
        reservedSats: 0,
        nextSats: 600,
      }).ok
    ).toBe(true);
    expect(
      budgetAllowsNextPayment({
        capSats: budget.capSats,
        reservedSats: 600,
        nextSats: 600,
      }).ok
    ).toBe(false);
  });

  it("keeps paying and unknown amounts reserved so a second worker cannot spend them", () => {
    const items = [
      { winnerPubkey: "a", amountSats: 600, status: "paying" },
      { winnerPubkey: "b", amountSats: 600, status: "unknown" },
      { winnerPubkey: "c", amountSats: 600, status: "failed" },
    ];
    expect(reservedPayoutSats(items, "c")).toBe(1200);
    const budget = authorizedCampaignBudgetSats({
      spendCapSats: null,
      items,
      requested: [{ winnerPubkey: "c", amountSats: 600 }],
    });
    expect(budget).toEqual({ ok: true, capSats: 1800 });
    if (!budget.ok) return;
    expect(
      budgetAllowsNextPayment({
        capSats: budget.capSats,
        reservedSats: reservedPayoutSats(items, "c") ?? 0,
        nextSats: 600,
      }).ok
    ).toBe(true);
    expect(
      budgetAllowsNextPayment({
        capSats: 1000,
        reservedSats: reservedPayoutSats(items) ?? 0,
        nextSats: 600,
      }).ok
    ).toBe(false);
  });

  it("serializes two workers so only one can reserve the remaining budget", async () => {
    let reserved = 0;
    const cap = 1000;
    let chain: Promise<unknown> = Promise.resolve();
    const claim = (amount: number) => {
      const run = chain.then(() => {
        const decision = budgetAllowsNextPayment({
          capSats: cap,
          reservedSats: reserved,
          nextSats: amount,
        });
        if (!decision.ok) return false;
        reserved += amount;
        return true;
      });
      chain = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    };
    const results = await Promise.all([claim(600), claim(600)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(reserved).toBe(600);
  });
});
