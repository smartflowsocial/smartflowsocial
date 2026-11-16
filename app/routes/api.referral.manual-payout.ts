/**
 * Manual referral payout: pay one referrer via BOLT11 invoice.
 * Requires REFERRAL_MANUAL_PAYOUT_SECRET. A missing secret rejects the request.
 */

import type { ActionFunctionArgs } from "@remix-run/node";

import {
  payReferrerWithInvoice,
  referralPayoutsEnabled,
} from "~/features/referral/referral-payout.server";
import { env } from "~/lib/env.server";
import { secretsMatch } from "~/lib/secret-match.server";

const SECRET_HEADER = "X-Referral-Payout-Secret";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!referralPayoutsEnabled(env.REFERRAL_PAYOUTS_ENABLED)) {
    return Response.json(
      { error: "Referral payouts are disabled" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (
    !secretsMatch(
      request.headers.get(SECRET_HEADER) ?? "",
      env.REFERRAL_MANUAL_PAYOUT_SECRET
    )
  ) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const o =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const referrerNpub =
    typeof o["referrer_npub"] === "string" ? o["referrer_npub"].trim() : "";
  const bolt11 = typeof o["bolt11"] === "string" ? o["bolt11"].trim() : "";
  const amountSats =
    typeof o["amount_sats"] === "number" ? Math.floor(o["amount_sats"]) : NaN;

  if (
    !referrerNpub ||
    !bolt11 ||
    !Number.isFinite(amountSats) ||
    amountSats < 1
  ) {
    return Response.json(
      { error: "Missing or invalid referrer_npub, bolt11, or amount_sats" },
      { status: 400 }
    );
  }

  const result = await payReferrerWithInvoice(referrerNpub, bolt11, amountSats);

  if (!result.success) {
    return Response.json(
      { success: false, error: result.error },
      { status: 422 }
    );
  }

  return Response.json({ success: true });
}
