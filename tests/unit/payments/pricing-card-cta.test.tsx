/**
 * @vitest-environment jsdom
 *
 * An expired current tier must open checkout. An in-period current tier
 * links back to the dashboard.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { PricingCard } from "~/features/payments/components/PricingCard";
import type { PricingPagePlan } from "~/features/payments/types/plan-loader.types";

const creatorPlan: PricingPagePlan = {
  id: "creator",
  name: "Creator",
  monthlyPriceUsd: 20,
  yearlyPriceUsd: 200,
  yearlySavingsNote: null,
  checkoutPricing: {
    nwcAutoRenewMonthlyUsd: 20,
    nwcAutoRenewYearlyUsd: 200,
    lightningOneTimeMonthlyUsd: { 1: 20, 3: 60, 6: 120 },
    lightningOneTimeYearlyUsd: 200,
    btcOnchainYearlyUsd: null,
  },
  description: "Best solo plan",
  features: {},
  isPopular: true,
  planBillingModel: "recurring",
  purchasable: true,
  isComingSoon: false,
  isTeamsPlaceholder: false,
  callouts: [],
};

function showCard(
  isCurrentPlanExpired: boolean,
  onPlanSelect: (planId: string) => void
) {
  render(
    <MemoryRouter>
      <PricingCard
        plan={creatorPlan}
        isCurrentPlan
        isCurrentPlanExpired={isCurrentPlanExpired}
        isLoading={false}
        selectedPlan={null}
        useCheckoutModal
        billingCadence="monthly"
        onPlanSelect={onPlanSelect}
      />
    </MemoryRouter>
  );
}

describe("PricingCard current-plan CTA", () => {
  it("links an active current plan to the dashboard", () => {
    showCard(false, vi.fn());

    const link = screen.getByRole("link", { name: "Current plan" });
    expect(link).toHaveAttribute("href", "/dashboard");
    expect(
      screen.queryByRole("button", { name: "Renew" })
    ).not.toBeInTheDocument();
  });

  it("opens checkout when the current plan has expired", () => {
    const onPlanSelect = vi.fn();
    showCard(true, onPlanSelect);

    expect(
      screen.queryByRole("link", { name: "Current plan" })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Renew" }));
    expect(onPlanSelect).toHaveBeenCalledWith("creator");
  });

  it("shows Free as the current plan when it is not purchasable", () => {
    render(
      <MemoryRouter>
        <PricingCard
          plan={{
            ...creatorPlan,
            id: "free",
            name: "Free",
            planBillingModel: "free",
            purchasable: false,
            monthlyPriceUsd: 0,
            yearlyPriceUsd: 0,
          }}
          isCurrentPlan
          isCurrentPlanExpired
          isLoading={false}
          selectedPlan={null}
          useCheckoutModal
          billingCadence="monthly"
          onPlanSelect={vi.fn()}
        />
      </MemoryRouter>
    );

    const link = screen.getByRole("link", { name: "Current plan" });
    expect(link).toHaveAttribute("href", "/dashboard");
    expect(
      screen.queryByRole("button", { name: "Start free" })
    ).not.toBeInTheDocument();
  });
});
