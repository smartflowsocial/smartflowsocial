/**
 * Blastr entitlement sync follows the effective subscription, including
 * linked children of a parent whose plan includes relay fan-out.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const PARENT_HEX = "ab".repeat(32);
const CHILD_HEX = "cd".repeat(32);

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
}));

const payments = vi.hoisted(() => ({
  getUserSubscription: vi.fn(),
}));

const children = vi.hoisted(() => ({
  findConfirmedChildrenForParent: vi.fn(),
}));

const blastr = vi.hoisted(() => ({
  resolvePubkeyHex: vi.fn(),
  syncEntitlement: vi.fn(),
}));

const logs = vi.hoisted(() => ({
  logError: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({ prisma: prismaMock }));
vi.mock("~/features/payments/data/payment.queries.server", () => payments);
vi.mock(
  "~/features/user/repositories/parent-child-data.server",
  () => children
);
vi.mock("~/infra/blastr/blastr-admin.client.server", () => blastr);
vi.mock("~/lib/error-logger.server", () => logs);

import {
  afterSubscriptionUpdated,
  relaysIncludeBlastr,
  syncBlastrEntitlementBeforePublish,
  syncBlastrEntitlementForUser,
} from "~/infra/blastr/entitlement-sync.server";

const activeBlast = {
  status: "ACTIVE",
  Plan: { enableRelayBlast: true },
};

describe("Blastr entitlement sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    children.findConfirmedChildrenForParent.mockResolvedValue([]);
    blastr.syncEntitlement.mockResolvedValue(undefined);
    blastr.resolvePubkeyHex.mockImplementation((npub: string) => {
      if (npub === "parent-npub") return PARENT_HEX;
      if (npub === "child-npub") return CHILD_HEX;
      return null;
    });
  });

  it("syncs active when the effective plan includes fan-out", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      npub: "parent-npub",
      isEnabled: true,
    });
    payments.getUserSubscription.mockResolvedValue(activeBlast);

    await syncBlastrEntitlementForUser("owner");

    expect(blastr.syncEntitlement).toHaveBeenCalledWith(PARENT_HEX, "active");
  });

  it("syncs expired when the user is disabled", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      npub: "parent-npub",
      isEnabled: false,
    });
    payments.getUserSubscription.mockResolvedValue(activeBlast);

    await syncBlastrEntitlementForUser("owner");

    expect(blastr.syncEntitlement).toHaveBeenCalledWith(PARENT_HEX, "expired");
  });

  it("does nothing when the pubkey cannot be resolved", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      npub: "not-a-key",
      isEnabled: true,
    });
    payments.getUserSubscription.mockResolvedValue(activeBlast);

    await syncBlastrEntitlementForUser("owner");

    expect(blastr.syncEntitlement).not.toHaveBeenCalled();
  });

  it("syncs confirmed children from the parent plan and skips unlinked rows", async () => {
    prismaMock.user.findUnique.mockImplementation(
      async (args: { where: { id: string } }) => {
        if (args.where.id === "child-1") {
          return { npub: "child-npub", isEnabled: true };
        }
        return { npub: "parent-npub", isEnabled: true };
      }
    );
    payments.getUserSubscription.mockResolvedValue(activeBlast);
    children.findConfirmedChildrenForParent.mockResolvedValue([
      {
        id: "child-1",
        npub: "child-npub",
        nostrProfile: null,
        isChild: true,
      },
      {
        id: "pending-1",
        npub: "other-npub",
        nostrProfile: null,
        isChild: false,
      },
    ]);

    await afterSubscriptionUpdated("owner");

    expect(children.findConfirmedChildrenForParent).toHaveBeenCalledWith(
      "parent-npub"
    );
    expect(payments.getUserSubscription).toHaveBeenCalledWith("child-1");
    expect(blastr.syncEntitlement).toHaveBeenCalledWith(PARENT_HEX, "active");
    expect(blastr.syncEntitlement).toHaveBeenCalledWith(CHILD_HEX, "active");
    expect(blastr.syncEntitlement).toHaveBeenCalledTimes(2);
  });

  it("registers the publishing pubkey before a Blastr delivery", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      npub: "child-npub",
      isEnabled: true,
    });
    payments.getUserSubscription.mockResolvedValue(activeBlast);

    await syncBlastrEntitlementBeforePublish("child-1", [
      "wss://relay.primal.net",
      "wss://blastr.smartflow.social",
    ]);

    expect(blastr.syncEntitlement).toHaveBeenCalledWith(CHILD_HEX, "active");
  });

  it("leaves Blastr alone when the post is not sent there", async () => {
    await syncBlastrEntitlementBeforePublish("child-1", [
      "wss://relay.primal.net",
      "wss://relay.damus.io",
    ]);

    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(blastr.syncEntitlement).not.toHaveBeenCalled();
  });

  it("still returns when the entitlement lookup fails", async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error("db down"));

    await expect(
      syncBlastrEntitlementBeforePublish("child-1", [
        "wss://blastr.smartflow.social/",
      ])
    ).resolves.toBeUndefined();
    expect(logs.logError).toHaveBeenCalled();
    expect(relaysIncludeBlastr(["wss://blastr.smartflow.social/"])).toBe(true);
  });

  it("keeps going when one child entitlement sync fails", async () => {
    prismaMock.user.findUnique.mockImplementation(
      async (args: { where: { id: string } }) => {
        if (args.where.id === "child-1") {
          return { npub: "child-npub", isEnabled: true };
        }
        return { npub: "parent-npub", isEnabled: true };
      }
    );
    payments.getUserSubscription.mockImplementation(async (userId: string) => {
      if (userId === "child-1") throw new Error("child down");
      return activeBlast;
    });
    children.findConfirmedChildrenForParent.mockResolvedValue([
      {
        id: "child-1",
        npub: "child-npub",
        nostrProfile: null,
        isChild: true,
      },
    ]);

    await expect(afterSubscriptionUpdated("owner")).resolves.toBeUndefined();
    expect(blastr.syncEntitlement).toHaveBeenCalledWith(PARENT_HEX, "active");
    expect(logs.logError).toHaveBeenCalled();
  });
});
