/**
 * Blastr policy settings actions: mode, enabled, add/remove relay.
 * Only for users with Blastr access (ACTIVE subscription + plan.enableRelayBlast).
 */

import { data } from "@remix-run/node";

import { getUserSubscription } from "~/features/payments/data";
import { relayFanoutForSubscription } from "~/features/payments/entitlements/deployment-mode.server";
import { getUserBasicInfo } from "~/features/user";
import {
  addPolicyRelay,
  putUserPolicy,
  removePolicyRelay,
  resolvePubkeyHex,
} from "~/infra/blastr/blastr-admin.client.server";

async function getBlastrEligiblePubkeyHex(
  userId: string
): Promise<string | null> {
  const [user, subscription] = await Promise.all([
    getUserBasicInfo(userId),
    getUserSubscription(userId),
  ]);
  if (
    !user?.npub ||
    !relayFanoutForSubscription({
      subscriptionActive: subscription?.status === "ACTIVE",
      planEnablesRelayBlast: subscription?.Plan?.enableRelayBlast === true,
    })
  )
    return null;
  return resolvePubkeyHex(user.npub);
}

const BLASTR_ACTIONS = [
  "update_blastr_policy",
  "add_blastr_policy_relay",
  "remove_blastr_policy_relay",
];

export async function handleBlastrPolicyAction(
  userId: string,
  action: string,
  formData: FormData
) {
  if (!BLASTR_ACTIONS.includes(action)) return null;

  const pubkeyHex = await getBlastrEligiblePubkeyHex(userId);
  if (!pubkeyHex) {
    return data({ error: "Blastr access required" }, { status: 403 });
  }

  if (action === "update_blastr_policy") {
    const mode = formData.get("mode");
    const enabledRaw = formData.get("enabled");
    const policyMode = mode === "whitelist" ? "whitelist" : "blacklist";
    const enabled = String(enabledRaw ?? "") === "true";
    const ok = await putUserPolicy(pubkeyHex, { mode: policyMode, enabled });
    if (!ok)
      return data({ error: "Failed to update Blastr policy" }, { status: 502 });
    return { success: true };
  }

  if (action === "add_blastr_policy_relay") {
    const relayUrl = formData.get("relay_url");
    const actionType = formData.get("action");
    if (typeof relayUrl !== "string" || !relayUrl.trim()) {
      return data({ error: "relay_url required" }, { status: 400 });
    }
    const allowOrBlock = actionType === "allow" ? "allow" : "block";
    const ok = await addPolicyRelay(pubkeyHex, relayUrl.trim(), allowOrBlock);
    if (!ok)
      return data(
        { error: "Failed to add relay to Blastr policy" },
        { status: 502 }
      );
    return { success: true };
  }

  if (action === "remove_blastr_policy_relay") {
    const relayUrl = formData.get("relay_url");
    if (typeof relayUrl !== "string" || !relayUrl.trim()) {
      return data({ error: "relay_url required" }, { status: 400 });
    }
    const ok = await removePolicyRelay(pubkeyHex, relayUrl.trim());
    if (!ok)
      return data(
        { error: "Failed to remove relay from Blastr policy" },
        { status: 502 }
      );
    return { success: true };
  }

  return null;
}
