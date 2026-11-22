/**
 * Unit tests for Blastr relay resolution: isBlastrEnabledForUserFromDb
 * and resolveExecutionRelays when blastrRelayEnabled is false.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  user: { findUnique: vi.fn() },
  subscription: { findUnique: vi.fn() },
};

vi.mock("~/lib/prisma.server", () => ({ prisma: mockPrisma }));

describe("isBlastrEnabledForUserFromDb", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when user has blastrRelayEnabled false even with ACTIVE subscription and enableRelayBlast", async () => {
    (mockPrisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      blastrRelayEnabled: false,
    });
    (
      mockPrisma.subscription.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      status: "ACTIVE",
      Plan: { enableRelayBlast: true },
    });

    const { isBlastrEnabledForUserFromDb } =
      await import("~/features/relays/repositories/relay-resolution-data.server");
    const result = await isBlastrEnabledForUserFromDb("user-1");
    expect(result).toBe(false);
  });

  it("returns true when user has blastrRelayEnabled true with ACTIVE subscription and enableRelayBlast", async () => {
    (mockPrisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      blastrRelayEnabled: true,
    });
    (
      mockPrisma.subscription.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      status: "ACTIVE",
      Plan: { enableRelayBlast: true },
    });

    const { isBlastrEnabledForUserFromDb } =
      await import("~/features/relays/repositories/relay-resolution-data.server");
    const result = await isBlastrEnabledForUserFromDb("user-1");
    expect(result).toBe(true);
  });

  it("returns false when subscription is not ACTIVE", async () => {
    (mockPrisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      blastrRelayEnabled: true,
    });
    (
      mockPrisma.subscription.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      status: "CANCELED",
      Plan: { enableRelayBlast: true },
    });

    const { isBlastrEnabledForUserFromDb } =
      await import("~/features/relays/repositories/relay-resolution-data.server");
    const result = await isBlastrEnabledForUserFromDb("user-1");
    expect(result).toBe(false);
  });

  it("enables Blastr for a linked child who opted in when the parent plan includes it", async () => {
    installChildSubscription({
      blastrRelayEnabled: true,
      parentPlanId: "pro",
      parentEnablesRelayBlast: true,
    });

    const { isBlastrEnabledForUserFromDb } =
      await import("~/features/relays/repositories/relay-resolution-data.server");
    const result = await isBlastrEnabledForUserFromDb("child-1");
    expect(result).toBe(true);
  });

  it("keeps Blastr off for a linked child who turned the relay off", async () => {
    installChildSubscription({
      blastrRelayEnabled: false,
      parentPlanId: "pro",
      parentEnablesRelayBlast: true,
    });

    const { isBlastrEnabledForUserFromDb } =
      await import("~/features/relays/repositories/relay-resolution-data.server");
    const result = await isBlastrEnabledForUserFromDb("child-1");
    expect(result).toBe(false);
  });

  it("does not enable Blastr for a child when the parent plan excludes fan-out", async () => {
    installChildSubscription({
      blastrRelayEnabled: true,
      parentPlanId: "pro",
      parentEnablesRelayBlast: false,
    });

    const { isBlastrEnabledForUserFromDb } =
      await import("~/features/relays/repositories/relay-resolution-data.server");
    const result = await isBlastrEnabledForUserFromDb("child-1");
    expect(result).toBe(false);
  });

  it("enables Blastr for a child when the parent plan includes it after the period end", async () => {
    installChildSubscription({
      blastrRelayEnabled: true,
      parentPlanId: "pro",
      parentEnablesRelayBlast: true,
      currentPeriodEnd: new Date("2020-01-01T00:00:00.000Z"),
    });

    const { isBlastrEnabledForUserFromDb } =
      await import("~/features/relays/repositories/relay-resolution-data.server");
    const result = await isBlastrEnabledForUserFromDb("child-1");
    expect(result).toBe(true);
  });

  it("does not grant Blastr from a parent plan that does not cover linked accounts", async () => {
    installChildSubscription({
      blastrRelayEnabled: true,
      parentPlanId: "starter",
      parentEnablesRelayBlast: true,
    });

    const { isBlastrEnabledForUserFromDb } =
      await import("~/features/relays/repositories/relay-resolution-data.server");
    const result = await isBlastrEnabledForUserFromDb("child-1");
    expect(result).toBe(false);
  });
});

function installChildSubscription(input: {
  blastrRelayEnabled: boolean;
  parentPlanId: string;
  parentEnablesRelayBlast: boolean;
  currentPeriodEnd?: Date;
}): void {
  (mockPrisma.user.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
    (args: {
      where: { id?: string; npub?: string };
      select?: {
        blastrRelayEnabled?: boolean;
        isChild?: boolean;
        id?: boolean;
      };
    }) => {
      if (args.where.npub) return { id: "parent-1" };
      if (args.select?.isChild) {
        return { isChild: true, parentNpub: "parent-npub" };
      }
      return { blastrRelayEnabled: input.blastrRelayEnabled };
    }
  );
  (
    mockPrisma.subscription.findUnique as ReturnType<typeof vi.fn>
  ).mockImplementation((args: { where: { userId: string } }) => {
    if (args.where.userId === "parent-1") {
      return {
        status: "ACTIVE",
        planId: input.parentPlanId,
        currentPeriodEnd:
          input.currentPeriodEnd ?? new Date("2099-01-01T00:00:00.000Z"),
        Plan: {
          enableRelayBlast: input.parentEnablesRelayBlast,
          enableLifetimeAccess: false,
          name: input.parentPlanId,
        },
      };
    }
    return {
      status: "CANCELED",
      planId: "free",
      currentPeriodEnd: new Date("2020-01-01T00:00:00.000Z"),
      Plan: {
        enableRelayBlast: false,
        enableLifetimeAccess: false,
        name: "Free",
      },
    };
  });
}
