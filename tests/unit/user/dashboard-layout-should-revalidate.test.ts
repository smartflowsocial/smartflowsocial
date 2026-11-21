import { describe, expect, it } from "vitest";

import { dashboardLayoutShouldRevalidate } from "~/features/user/dashboard-layout-should-revalidate";

const here = new URL("https://app.example/dashboard");
const plans = new URL("https://app.example/dashboard/plans");

describe("dashboardLayoutShouldRevalidate", () => {
  it("reloads on an explicit revalidate so a confirmed payment updates the banner", () => {
    expect(
      dashboardLayoutShouldRevalidate({
        currentUrl: here,
        nextUrl: here,
        defaultShouldRevalidate: true,
      })
    ).toBe(true);
  });

  it("keeps the layout cached for same-page fetcher traffic", () => {
    expect(
      dashboardLayoutShouldRevalidate({
        currentUrl: plans,
        nextUrl: plans,
        formAction: "/api/payment-status",
        formMethod: "POST",
        defaultShouldRevalidate: true,
      })
    ).toBe(false);
  });

  it("still reloads dashboard actions and real navigations", () => {
    expect(
      dashboardLayoutShouldRevalidate({
        currentUrl: here,
        nextUrl: here,
        formAction: "/dashboard/drafts",
        formMethod: "POST",
        defaultShouldRevalidate: false,
      })
    ).toBe(true);
    expect(
      dashboardLayoutShouldRevalidate({
        currentUrl: here,
        nextUrl: plans,
        defaultShouldRevalidate: true,
      })
    ).toBe(true);
    expect(
      dashboardLayoutShouldRevalidate({
        currentUrl: here,
        nextUrl: plans,
        defaultShouldRevalidate: false,
      })
    ).toBe(false);
  });
});
