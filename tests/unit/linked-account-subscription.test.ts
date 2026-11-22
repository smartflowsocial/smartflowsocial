import { describe, expect, it } from "vitest";

import { readPublicDeployment } from "~/features/payments/entitlements/deployment-mode";
import {
  parentSubscriptionCoversLinkedChild,
  parentSubscriptionGrantsRelayFanout,
} from "~/features/payments/linked-account-subscription";

const hosted = readPublicDeployment({ SFS_DEPLOYMENT_MODE: "hosted" });
const now = new Date("2026-11-17T18:00:00.000Z");

describe("parentSubscriptionCoversLinkedChild", () => {
  it("covers a child while the parent Pro plan is active", () => {
    expect(
      parentSubscriptionCoversLinkedChild(
        {
          status: "ACTIVE",
          planId: "pro",
          currentPeriodEnd: new Date("2026-12-06T20:13:50.175Z"),
          Plan: { name: "Pro", enableLifetimeAccess: false },
        },
        { now, deployment: hosted }
      )
    ).toBe(true);
  });

  it("does not cover a child from an expired or unpaid parent plan", () => {
    expect(
      parentSubscriptionCoversLinkedChild(
        {
          status: "ACTIVE",
          planId: "pro",
          currentPeriodEnd: new Date("2026-05-28T06:20:04.000Z"),
          Plan: { name: "Pro", enableLifetimeAccess: false },
        },
        { now, deployment: hosted }
      )
    ).toBe(false);
    expect(
      parentSubscriptionCoversLinkedChild(
        {
          status: "UNPAID",
          planId: "creator",
          currentPeriodEnd: new Date("2026-12-06T20:13:50.175Z"),
          Plan: { name: "Creator", enableLifetimeAccess: false },
        },
        { now, deployment: hosted }
      )
    ).toBe(false);
  });

  it("grants Blastr from an active multi-account plan after the period end", () => {
    const lapsed = {
      status: "ACTIVE",
      planId: "pro",
      currentPeriodEnd: new Date("2026-05-28T06:20:04.000Z"),
      Plan: {
        name: "Pro",
        enableLifetimeAccess: false,
        enableRelayBlast: true,
      },
    };
    expect(
      parentSubscriptionCoversLinkedChild(lapsed, { now, deployment: hosted })
    ).toBe(false);
    expect(
      parentSubscriptionGrantsRelayFanout(lapsed, { deployment: hosted })
    ).toBe(true);
  });

  it("does not grant Blastr from a single-account plan", () => {
    expect(
      parentSubscriptionGrantsRelayFanout(
        {
          status: "ACTIVE",
          planId: "starter",
          currentPeriodEnd: new Date("2026-12-06T20:13:50.175Z"),
          Plan: {
            name: "Starter",
            enableLifetimeAccess: false,
            enableRelayBlast: true,
          },
        },
        { deployment: hosted }
      )
    ).toBe(false);
  });

  it("does not cover a child from a single-account plan", () => {
    expect(
      parentSubscriptionCoversLinkedChild(
        {
          status: "ACTIVE",
          planId: "starter",
          currentPeriodEnd: new Date("2026-12-06T20:13:50.175Z"),
          Plan: { name: "Starter", enableLifetimeAccess: false },
        },
        { now, deployment: hosted }
      )
    ).toBe(false);
  });
});
