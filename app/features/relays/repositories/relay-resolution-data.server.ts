import { getUserSubscription } from "~/features/payments/data/payment.queries.server";
import { relayFanoutForSubscription } from "~/features/payments/entitlements/deployment-mode.server";
import { prisma } from "~/lib/prisma.server";

function sanitizeRelayStrings(relays: unknown): string[] {
  if (!Array.isArray(relays)) return [];
  return relays
    .map((relay) => (typeof relay === "string" ? relay : String(relay)).trim())
    .filter((r) => r.length > 0);
}

export type PublishRelaySourceDb = "app" | "nip65_profile";

/**
 * Read persisted app relay list and publish source (NIP-65 vs app list).
 */
export async function getRelayIntentFromDb(userId: string): Promise<{
  appRelays: string[];
  publishRelaySource: PublishRelaySourceDb;
  npub: string;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { userRelays: true, publishRelaySource: true, npub: true },
  });
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }
  const persisted = sanitizeRelayStrings(user.userRelays);
  const publishRelaySource: PublishRelaySourceDb =
    user.publishRelaySource === "nip65_profile" ? "nip65_profile" : "app";
  return {
    appRelays: persisted,
    publishRelaySource,
    npub: user.npub,
  };
}

/**
 * The account's own "Use SFS Blastr relay" preference, plus the plan that
 * actually grants fan-out. A linked child follows the parent subscription.
 */
export async function isBlastrEnabledForUserFromDb(
  userId: string
): Promise<boolean> {
  const [user, subscription] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { blastrRelayEnabled: true },
    }),
    getUserSubscription(userId),
  ]);

  return (
    user?.blastrRelayEnabled === true &&
    relayFanoutForSubscription({
      subscriptionActive: subscription?.status === "ACTIVE",
      planEnablesRelayBlast: subscription?.Plan?.enableRelayBlast === true,
    })
  );
}
