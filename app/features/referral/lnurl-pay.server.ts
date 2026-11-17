import { isAllowedOutboundUrl } from "~/lib/outbound-url.server";

import {
  assertBolt11MatchesAuthorizedAmount,
  millisatsFromSats,
} from "./bolt11-invoice.server";

/**
 * Minimal LNURL pay: fetch a BOLT11 invoice for an exact sat amount.
 * Destinations and callbacks must be public HTTPS URLs. Redirects are not followed.
 * The returned invoice is decoded and must match `amountSats` exactly.
 */

export type LnurlPayInvoiceResult =
  | { ok: true; invoice: string }
  | {
      ok: false;
      code:
        | "invalid_amount"
        | "invalid_destination"
        | "invalid_response"
        | "invoice_rejected";
      detail: string;
    };

function payoutUrlAllowed(raw: string): boolean {
  return isAllowedOutboundUrl(raw, {
    allowInsecureHttp: process.env["NODE_ENV"] !== "production",
    allowPrivate: process.env["REFERRAL_PAYOUT_ALLOW_PRIVATE_LNURL"] === "true",
  });
}

function readNonNegativeInteger(value: unknown): bigint | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  return null;
}

function isLnurlError(value: object): boolean {
  if (!("status" in value)) return false;
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" && status.toUpperCase() === "ERROR";
}

async function readJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status >= 300 && response.status < 400) return null;
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export async function fetchLnurlPayInvoice(
  url: string,
  amountSats: number
): Promise<LnurlPayInvoiceResult> {
  const millisats = millisatsFromSats(amountSats);
  if (millisats === null) {
    return {
      ok: false,
      code: "invalid_amount",
      detail: "LNURL amount must be a positive whole number of sats",
    };
  }
  if (!payoutUrlAllowed(url)) {
    return {
      ok: false,
      code: "invalid_destination",
      detail: "LNURL endpoint is not an allowed public URL",
    };
  }

  const metaRaw = await readJson(url);
  if (
    typeof metaRaw !== "object" ||
    metaRaw === null ||
    Array.isArray(metaRaw)
  ) {
    return {
      ok: false,
      code: "invalid_response",
      detail: "LNURL metadata response was not valid JSON",
    };
  }
  if (isLnurlError(metaRaw)) {
    return {
      ok: false,
      code: "invalid_response",
      detail: "LNURL metadata endpoint returned an error",
    };
  }
  const meta = metaRaw as {
    callback?: unknown;
    minSendable?: unknown;
    maxSendable?: unknown;
  };
  const callback = typeof meta.callback === "string" ? meta.callback : "";
  if (!callback || !payoutUrlAllowed(callback)) {
    return {
      ok: false,
      code: "invalid_response",
      detail: "LNURL callback URL is missing or not allowed",
    };
  }
  const min = readNonNegativeInteger(meta.minSendable);
  const max = readNonNegativeInteger(meta.maxSendable);
  if (min === null || max === null || min > max) {
    return {
      ok: false,
      code: "invalid_response",
      detail: "LNURL minSendable and maxSendable must be whole millisatoshis",
    };
  }
  if (millisats < min || millisats > max) {
    return {
      ok: false,
      code: "invalid_response",
      detail: "Requested amount is outside the LNURL sendable range",
    };
  }

  const callbackUrl = callback.includes("?")
    ? `${callback}&amount=${millisats.toString()}`
    : `${callback}?amount=${millisats.toString()}`;
  const payRaw = await readJson(callbackUrl);
  if (typeof payRaw !== "object" || payRaw === null || Array.isArray(payRaw)) {
    return {
      ok: false,
      code: "invalid_response",
      detail: "LNURL callback response was not valid JSON",
    };
  }
  if (isLnurlError(payRaw)) {
    return {
      ok: false,
      code: "invalid_response",
      detail: "LNURL callback returned an error",
    };
  }
  const pr = (payRaw as { pr?: unknown }).pr;
  if (typeof pr !== "string" || pr.trim() === "") {
    return {
      ok: false,
      code: "invalid_response",
      detail: "LNURL callback did not include a BOLT11 invoice",
    };
  }
  const invoice = assertBolt11MatchesAuthorizedAmount({
    invoice: pr,
    authorizedSats: amountSats,
  });
  if (!invoice.ok) {
    return { ok: false, code: "invoice_rejected", detail: invoice.error };
  }
  return { ok: true, invoice: invoice.invoice };
}

export async function fetchInvoiceFromLnurlPay(
  url: string,
  amountSats: number
): Promise<string | null> {
  const result = await fetchLnurlPayInvoice(url, amountSats);
  return result.ok ? result.invoice : null;
}
