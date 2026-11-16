import type { ActionFunctionArgs } from "@remix-run/node";

import { verifyBtcpayWebhookSignature } from "~/features/payments/btcpay.server";
import { processBtcpayWebhookPayload } from "~/features/payments/data/btcpay-webhook.server";
import { env } from "~/lib/env.server";
import { logError } from "~/lib/error-logger.server";
import { jsonResponse } from "~/lib/http/json-response";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const secret = env.BTCPAY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return jsonResponse({ error: "Webhooks not configured" }, { status: 503 });
  }

  const raw = await request.text();
  const sig =
    request.headers.get("btcpay-sig") ??
    request.headers.get("BTCPay-Sig") ??
    request.headers.get("Btcpay-Sig");

  if (!verifyBtcpayWebhookSignature(raw, sig, secret)) {
    return jsonResponse({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const payload: unknown = raw ? JSON.parse(raw) : null;
    await processBtcpayWebhookPayload(payload);
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), {
      message: "BTCPay webhook handler error",
    });
    return jsonResponse({ error: "Bad payload" }, { status: 400 });
  }

  return jsonResponse({ ok: true });
}

export const loader = async () =>
  jsonResponse({ error: "Method not allowed" }, { status: 405 });
