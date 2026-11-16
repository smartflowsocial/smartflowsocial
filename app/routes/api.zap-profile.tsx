import { type LoaderFunctionArgs } from "react-router";

import {
  fetchPrimalProfileData,
  processPrimalData,
} from "~/features/auth/profile.server";
import { jsonResponse } from "~/lib/http/json-response";
import { nostrAdapter } from "~/lib/nostr-adapter.server";

/**
 * GET /api/zap-profile?npub=<npub>
 * Returns lud16 (Lightning address) for a Nostr pubkey for NIP-57 zap flow.
 * No auth required.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("npub")?.trim();
  if (!raw) {
    return jsonResponse({ error: "Missing npub" }, { status: 400 });
  }

  const npub =
    raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)
      ? nostrAdapter.encodeNpub(raw)
      : raw.startsWith("npub")
        ? raw
        : null;
  if (!npub) {
    return jsonResponse({ error: "Invalid npub" }, { status: 400 });
  }

  try {
    const primalData = await fetchPrimalProfileData(npub);
    const { profile } = processPrimalData(primalData);
    const lud16 =
      typeof profile.lud16 === "string" && profile.lud16.trim() !== ""
        ? profile.lud16.trim()
        : null;
    return jsonResponse({ lud16 });
  } catch {
    return jsonResponse({ lud16: null });
  }
}
