/**
 * @vitest-environment jsdom
 *
 * Check payment must show that the click ran, including when BTCPay is still unpaid.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InvoiceModal } from "~/features/payments/components/InvoiceModal";

const invoiceData = {
  invoice: "https://btcpay.example/i/abc",
  amount: 100_000,
  amountUsd: 200,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  contextLabel: "Creator yearly",
  paymentId: "pay-1",
};

describe("InvoiceModal check payment", () => {
  it("shows the unpaid result after the check finishes", async () => {
    const onCheckPayment = vi.fn().mockResolvedValue({
      paid: false,
      message: "Payment not received yet.",
    });

    render(
      <InvoiceModal
        isOpen
        checkoutKind="btcpay"
        invoiceData={invoiceData}
        timeRemaining={60_000}
        isPolling
        onCopy={() => undefined}
        onCheckPayment={onCheckPayment}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Check payment" }));

    expect(screen.getByRole("button", { name: "Checking..." })).toBeDisabled();
    expect(
      await screen.findByText("Payment not received yet.")
    ).toBeInTheDocument();
    expect(onCheckPayment).toHaveBeenCalledWith("pay-1");
    expect(screen.getByRole("button", { name: "Check payment" })).toBeEnabled();
  });
});
