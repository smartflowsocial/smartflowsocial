import type { ActionFunctionArgs } from "@remix-run/node";

import { verifyBtcpayWebhookSignature } from "~/features/payments/btcpay.server";
import { processBtcpayWebhookPayload } from "~/features/payments/data/btcpay-webhook.server";
import { env } from "~/lib/env.server";
import { logError } from "~/lib/error-logger.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const secret = env.BTCPAY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return Response.json({ error: "Webhooks not configured" }, { status: 503 });
  }

  const raw = await request.text();
  const sig =
    request.headers.get("btcpay-sig") ??
    request.headers.get("BTCPay-Sig") ??
    request.headers.get("Btcpay-Sig");

  if (!verifyBtcpayWebhookSignature(raw, sig, secret)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const payload: unknown = raw ? JSON.parse(raw) : null;
    await processBtcpayWebhookPayload(payload);
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), {
      message: "BTCPay webhook handler error",
    });
    return Response.json({ error: "Bad payload" }, { status: 400 });
  }

  return Response.json({ ok: true });
}

export const loader = async () =>
  Response.json({ error: "Method not allowed" }, { status: 405 });
