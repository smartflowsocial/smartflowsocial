import { type LoaderFunctionArgs } from "@remix-run/node";

import { requireUserId } from "~/features/auth";
import { expandSavedAudienceEligiblePubkeys } from "~/features/broadcast/broadcast-recipient-picker.server";
import { jsonResponse } from "~/lib/http/json-response";

/**
 * GET ?savedAudienceId=  -  eligible pubkeys for a saved audience (follower filter for CUSTOM).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const id = new URL(request.url).searchParams.get("savedAudienceId")?.trim();
  if (!id) {
    return jsonResponse({ error: "Missing savedAudienceId" }, { status: 400 });
  }

  const { pubkeys, fetchFailed, notFound } =
    await expandSavedAudienceEligiblePubkeys(userId, id);

  if (notFound) {
    return jsonResponse({ error: "Not found" }, { status: 404 });
  }

  return jsonResponse({ pubkeys, fetchFailed });
}
