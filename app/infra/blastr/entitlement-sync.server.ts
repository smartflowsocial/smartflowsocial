/**
 * Blastr entitlement sync: after subscription changes, update Blastr so only paid users can publish.
 * A linked child follows the parent's plan, the same way other feature access does.
 * Best-effort for child fan-out; logs errors and does not throw from that path.
 */

import { getUserSubscription } from "~/features/payments/data/payment.queries.server";
import { relayFanoutForSubscription } from "~/features/payments/entitlements/deployment-mode.server";
import { findConfirmedChildrenForParent } from "~/features/user/repositories/parent-child-data.server";
import { logError } from "~/lib/error-logger.server";
import { prisma } from "~/lib/prisma.server";

import {
  resolvePubkeyHex,
  syncEntitlement,
} from "./blastr-admin.client.server";

/**
 * Loads user + effective subscription + plan. If the user is enabled and the
 * plan that grants access includes relay fan-out, syncs "active"; otherwise
 * syncs "expired". Linked children use the parent plan.
 */
export async function syncBlastrEntitlementForUser(
  userId: string
): Promise<void> {
  const [user, subscription] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { npub: true, isEnabled: true },
    }),
    getUserSubscription(userId),
  ]);

  if (!user?.npub) return;

  const pubkeyHex = resolvePubkeyHex(user.npub);
  if (!pubkeyHex) return;

  const isEligible =
    user.isEnabled === true &&
    relayFanoutForSubscription({
      subscriptionActive: subscription?.status === "ACTIVE",
      planEnablesRelayBlast: subscription?.Plan?.enableRelayBlast === true,
    });

  await syncEntitlement(pubkeyHex, isEligible ? "active" : "expired");
}

async function syncLinkedChildEntitlements(
  parentUserId: string
): Promise<void> {
  try {
    const owner = await prisma.user.findUnique({
      where: { id: parentUserId },
      select: { npub: true },
    });
    if (!owner?.npub) return;

    const children = await findConfirmedChildrenForParent(owner.npub);
    const linked = children.filter(
      (child) => child.isChild && child.id !== parentUserId
    );
    await Promise.all(
      linked.map(async (child) => {
        try {
          await syncBlastrEntitlementForUser(child.id);
        } catch (error) {
          logError(error instanceof Error ? error : new Error(String(error)), {
            context: "Blastr child entitlement sync",
            userId: child.id,
          });
        }
      })
    );
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), {
      context: "Blastr child entitlement sync",
      userId: parentUserId,
    });
  }
}

/**
 * Called after a subscription is updated (new plan, renewal, or cancel/downgrade).
 * Syncs that user, then confirmed linked children so their pubkeys match the parent plan.
 */
export async function afterSubscriptionUpdated(userId: string): Promise<void> {
  await syncBlastrEntitlementForUser(userId);
  await syncLinkedChildEntitlements(userId);
}
