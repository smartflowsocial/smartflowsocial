import { type LoaderFunctionArgs } from "react-router";

import {
  fetchPrimalProfileData,
  LOGIN_FLOW_PRIMAL_FETCH_BUDGET_MS,
  processPrimalData,
} from "~/features/auth/profile.server";
import { jsonResponse } from "~/lib/http/json-response";
import { nostrAdapter } from "~/lib/nostr-adapter.server";

/**
 * GET /api/profile-display-name?pubkey=<hex|npub>
 * Returns display name for a Nostr pubkey (used on login panel: "Signing in as username").
 * No auth required.
 */
export async function loader({ url }: LoaderFunctionArgs) {
  const raw = url.searchParams.get("pubkey")?.trim();
  if (!raw) {
    return jsonResponse({ displayName: null });
  }

  const npub =
    raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)
      ? nostrAdapter.encodeNpub(raw)
      : raw.startsWith("npub")
        ? raw
        : null;
  if (!npub) {
    return jsonResponse({ displayName: null });
  }

  try {
    const primalData = await fetchPrimalProfileData(npub, {
      primalFetchBudgetMs: LOGIN_FLOW_PRIMAL_FETCH_BUDGET_MS,
    });
    const { profile } = processPrimalData(primalData);
    const d =
      typeof profile.display_name === "string"
        ? profile.display_name.trim()
        : "";
    const n = typeof profile.name === "string" ? profile.name.trim() : "";
    const displayName = d || n || null;
    return jsonResponse({ displayName });
  } catch {
    return jsonResponse({ displayName: null });
  }
}
