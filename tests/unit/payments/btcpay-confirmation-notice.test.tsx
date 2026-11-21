/**
 * @vitest-environment jsdom
 *
 * The confirmation notice floats above the page instead of covering the header.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router", () => ({
  useRouteLoaderData: () => ({ user: { id: "user-1" } }),
  useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }),
}));

import { BTCPAY_CONFIRMATION_WATCH_STORAGE_KEY } from "~/features/payments/btcpay-confirmation-watch-storage";
import { BtcpayConfirmationWatchBar } from "~/features/payments/components/BtcpayConfirmationWatchBar";

describe("BtcpayConfirmationWatchBar", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.className = "";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          paid: false,
          status: "PENDING",
        }),
      })
    );
  });

  it("shows a dismissible floating notice and leaves the page offset alone", () => {
    localStorage.setItem(
      BTCPAY_CONFIRMATION_WATCH_STORAGE_KEY,
      JSON.stringify({
        paymentId: "pay-1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
    );

    render(<BtcpayConfirmationWatchBar />);

    const notice = screen.getByRole("status");
    expect(notice).toHaveClass("fixed");
    expect(notice).toHaveClass("pointer-events-none");
    expect(notice).not.toHaveClass("top-0");
    expect(screen.getByText("Waiting for confirmation")).toBeInTheDocument();
    expect(document.body).not.toHaveClass("has-btcpay-confirmation-bar");

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss payment notice" })
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
