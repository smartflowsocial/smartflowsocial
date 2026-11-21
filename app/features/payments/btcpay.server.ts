/**
 * BTCPay Server Greenfield API (Founder on-chain checkout) + webhook signature verification.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "~/lib/env.server";
import { logError } from "~/lib/error-logger.server";
import { ExternalServiceError } from "~/lib/errors";

export function isBtcpayConfigured(): boolean {
  const url = env.BTCPAY_URL?.trim();
  const key = env.BTCPAY_API_KEY?.trim();
  const store = env.BTCPAY_STORE_ID?.trim();
  return Boolean(url && key && store);
}

function baseUrl(): string {
  return env.BTCPAY_URL!.trim().replace(/\/$/, "");
}

function authHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `token ${env.BTCPAY_API_KEY!.trim()}`,
  };
}

/**
 * Minutes the payer has to broadcast an on-chain payment.
 * BTCPay's store default is 15, which is tight for a hardware wallet or an
 * exchange send. This timer stops once BTCPay sees the transaction; confirmation
 * time is separate.
 */
export const BTCPAY_ONCHAIN_CHECKOUT_EXPIRATION_MINUTES = 60;

export interface BtcpayInvoiceCreateResult {
  id: string;
  checkoutLink: string;
  expirationTime?: number;
}

function extractBtcpayErrorMessage(data: unknown, fallback: string): string {
  if (
    data &&
    typeof data === "object" &&
    "message" in data &&
    typeof data.message === "string"
  ) {
    return (data as { message: string }).message;
  }
  return fallback;
}

function asRecord(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object") {
    return data as Record<string, unknown>;
  }
  return {};
}

export async function btcpayCreateInvoice(params: {
  amountUsd: number;
  paymentId: string;
  userId: string;
  planId: string;
  planLabel: string;
}): Promise<BtcpayInvoiceCreateResult> {
  if (!isBtcpayConfigured()) {
    throw new Error("BTCPay is not configured");
  }

  const amountStr = params.amountUsd.toFixed(2);
  const storeId = env.BTCPAY_STORE_ID!.trim();
  const url = `${baseUrl()}/api/v1/stores/${encodeURIComponent(storeId)}/invoices`;

  const body: Record<string, unknown> = {
    amount: amountStr,
    currency: "USD",
    metadata: {
      smartflowPaymentId: params.paymentId,
      smartflowUserId: params.userId,
      smartflowPlanId: params.planId,
    },
  };

  const checkout: Record<string, unknown> = {
    expirationMinutes: BTCPAY_ONCHAIN_CHECKOUT_EXPIRATION_MINUTES,
  };
  const appUrl = env.APP_URL?.trim();
  if (appUrl) {
    checkout["redirectURL"] =
      `${appUrl.replace(/\/$/, "")}/dashboard?btcpayPaid=1`;
  }
  body["checkout"] = checkout;

  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg = extractBtcpayErrorMessage(data, text || res.statusText);
    logError(new Error(`BTCPay create invoice failed: ${msg}`), {
      status: res.status,
      paymentId: params.paymentId,
    });
    throw new ExternalServiceError(
      "Could not start Bitcoin checkout. Please try again later.",
      res.status >= 500 ? 502 : 400,
      { btcpayStatus: res.status }
    );
  }

  const obj = asRecord(data);
  const id = typeof obj["id"] === "string" ? obj["id"] : "";
  const checkoutLink =
    typeof obj["checkoutLink"] === "string" ? obj["checkoutLink"] : "";
  const expirationTime =
    typeof obj["expirationTime"] === "number"
      ? obj["expirationTime"]
      : undefined;

  if (!id || !checkoutLink) {
    logError(new Error("BTCPay invoice response missing id or checkoutLink"), {
      paymentId: params.paymentId,
    });
    throw new ExternalServiceError(
      "Invalid response from payment provider.",
      502,
      {}
    );
  }

  return { id, checkoutLink, expirationTime };
}

/** Require at least this many on-chain confirmations before granting access (RBF / 0-conf risk). */
export const BTCPAY_MIN_ONCHAIN_CONFIRMS_FOR_ACCESS = 1;

export interface BtcpayInvoiceOnChainSnapshot {
  invoiceStatus: string;
  maxOnChainConfirmations: number;
  /**
   * A payment has been seen. Also true when the invoice itself is
   * Processing or Settled and Greenfield omitted the payments list.
   */
  hasOnChainPaymentStarted: boolean;
}

function isBtcpayLightningPaymentMethodId(methodId: string): boolean {
  const m = methodId.toLowerCase();
  return (
    m.includes("lightning") ||
    m.includes("lnurl") ||
    m.includes("offchain") ||
    m.includes("off-chain") ||
    m.includes("-ln") ||
    m.includes("_ln")
  );
}

/**
 * On-chain ids from current and older Greenfield servers.
 * BTCPay 2.0 returns `BTC-CHAIN`. Older servers returned `BTC-OnChain`.
 */
function isBtcpayOnChainPaymentMethodId(methodId: string): boolean {
  const m = methodId.toLowerCase();
  if (!m || isBtcpayLightningPaymentMethodId(m)) return false;
  return (
    m.includes("-onchain") ||
    m.includes("_onchain") ||
    m.endsWith("-chain") ||
    m.endsWith("_chain") ||
    m === "btc"
  );
}

function asPaymentRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function paymentMethodIdOf(
  payment: Record<string, unknown>,
  inherited: string
): string {
  const raw =
    (typeof payment["paymentMethodId"] === "string"
      ? payment["paymentMethodId"]
      : "") ||
    (typeof payment["paymentMethod"] === "string"
      ? payment["paymentMethod"]
      : "");
  return raw || inherited;
}

function confirmationCount(payment: Record<string, unknown>): number {
  const raw = payment["confirmations"] ?? payment["confirmationCount"];
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, raw);
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return 0;
}

function paymentRowSettled(payment: Record<string, unknown>): boolean {
  return (
    typeof payment["status"] === "string" &&
    payment["status"].trim().toLowerCase() === "settled"
  );
}

/**
 * Parse Greenfield GET invoice JSON for BTC on-chain progress.
 *
 * Current Greenfield `GET /invoices/{id}` does not include a `payments` array
 * or a confirmation count. `Settled` means the store's confirmation policy was
 * already met (on-chain threshold, or instant for Lightning). `Processing`
 * means a payment was seen and is still short of that policy.
 *
 * @see https://docs.btcpayserver.org/API/Greenfield/v1/
 */
export function parseBtcpayInvoiceOnChainSnapshot(
  data: unknown
): BtcpayInvoiceOnChainSnapshot {
  const obj = asRecord(data);
  const invoiceStatus = typeof obj["status"] === "string" ? obj["status"] : "";
  const additionalStatus =
    typeof obj["additionalStatus"] === "string" ? obj["additionalStatus"] : "";
  const progress = { started: false, confirmations: 0, paymentRows: 0 };

  const consider = (payment: Record<string, unknown>, inherited: string) => {
    progress.paymentRows += 1;
    const methodId = paymentMethodIdOf(payment, inherited);
    if (!isBtcpayOnChainPaymentMethodId(methodId)) return;
    progress.started = true;
    let confirmations = confirmationCount(payment);
    if (
      paymentRowSettled(payment) &&
      confirmations < BTCPAY_MIN_ONCHAIN_CONFIRMS_FOR_ACCESS
    ) {
      confirmations = BTCPAY_MIN_ONCHAIN_CONFIRMS_FOR_ACCESS;
    }
    if (confirmations > progress.confirmations) {
      progress.confirmations = confirmations;
    }
  };

  if (Array.isArray(obj["payments"])) {
    for (const payment of obj["payments"]) {
      const record = asPaymentRecord(payment);
      if (record) consider(record, "");
    }
  }

  if (Array.isArray(obj["paymentMethods"])) {
    for (const method of obj["paymentMethods"]) {
      const record = asPaymentRecord(method);
      if (!record || !Array.isArray(record["payments"])) continue;
      const inherited = paymentMethodIdOf(record, "");
      for (const payment of record["payments"]) {
        const paymentRecord = asPaymentRecord(payment);
        if (paymentRecord) consider(paymentRecord, inherited);
      }
    }
  }

  applyInvoiceStatusSignal(invoiceStatus, additionalStatus, progress);

  return {
    invoiceStatus,
    maxOnChainConfirmations: progress.confirmations,
    hasOnChainPaymentStarted: progress.started,
  };
}

function applyInvoiceStatusSignal(
  invoiceStatus: string,
  additionalStatus: string,
  progress: { started: boolean; confirmations: number; paymentRows: number }
): void {
  const status = invoiceStatus.trim().toLowerCase();
  const additional = additionalStatus.trim().toLowerCase();
  if (additional === "paidpartial" || additional === "invalid") return;

  if (status === "settled") {
    progress.started = true;
    if (progress.confirmations < BTCPAY_MIN_ONCHAIN_CONFIRMS_FOR_ACCESS) {
      progress.confirmations = BTCPAY_MIN_ONCHAIN_CONFIRMS_FOR_ACCESS;
    }
    return;
  }

  if (status === "processing" && progress.paymentRows === 0) {
    progress.started = true;
  }
}

export async function btcpayGetInvoiceSnapshot(
  btcpayInvoiceId: string
): Promise<BtcpayInvoiceOnChainSnapshot> {
  if (!isBtcpayConfigured()) {
    throw new Error("BTCPay is not configured");
  }
  const storeId = env.BTCPAY_STORE_ID!.trim();
  const url = `${baseUrl()}/api/v1/stores/${encodeURIComponent(storeId)}/invoices/${encodeURIComponent(btcpayInvoiceId)}`;

  const res = await fetch(url, { headers: authHeaders() });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new ExternalServiceError(
      "BTCPay invoice lookup failed",
      res.status,
      {}
    );
  }

  return parseBtcpayInvoiceOnChainSnapshot(data);
}

export function verifyBtcpayWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader?.startsWith("sha256=") || !secret) {
    return false;
  }
  const sigHex = signatureHeader.slice("sha256=".length).trim();
  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  try {
    const a = Buffer.from(sigHex, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || a.length === 0) {
      return false;
    }
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
