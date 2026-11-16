import { NWCClient } from "@getalby/sdk";

import {
  amountSatsFromMillisatoshis,
  assertBolt11MatchesAuthorizedAmount,
} from "~/features/referral/bolt11-invoice.server";

const DEFINITIVE_REJECTION_CODES = new Set([
  "INSUFFICIENT_BALANCE",
  "QUOTA_EXCEEDED",
  "RESTRICTED",
  "UNAUTHORIZED",
  "NOT_IMPLEMENTED",
  "RATE_LIMITED",
  "PAYMENT_FAILED",
]);

const DEFINITIVE_REJECTION_TEXT = [
  "insufficient balance",
  "quota exceeded",
  "not implemented",
  "rate limit",
  "unauthorized",
  "payment failed",
];

export interface AuthorizedNwcClient {
  payInvoice(request: { invoice: string }): Promise<unknown>;
  lookupInvoice?(request: { payment_hash: string }): Promise<unknown>;
  getInfo?(): Promise<{ methods?: string[] }>;
  close?(): void;
}

export type AuthorizedPayResult =
  | {
      ok: true;
      preimage: string;
      walletResponse: unknown;
      paymentHash: string;
      amountSats: number;
    }
  | {
      ok: false;
      disposition: "rejected" | "unknown";
      code: string;
      message: string;
      paymentHash: string | null;
    };

export type LookupInterpretation =
  | { kind: "settled"; preimage: string | null }
  | { kind: "failed" }
  | { kind: "inconclusive" };

type PayAttempt =
  | { type: "pay"; value: unknown }
  | { type: "error"; error: unknown }
  | { type: "timeout" }
  | { type: "lookup"; value: unknown };

function defaultNwcClient(nwcUrl: string): AuthorizedNwcClient {
  return new NWCClient({ nostrWalletConnectUrl: nwcUrl });
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code.toUpperCase() : "";
  }
  return "";
}

/**
 * A received wallet rejection may be retried with a new invoice.
 * A timeout, a dropped response, or an unclassified error may mean the
 * wallet already paid, so those stay unknown.
 */
export function classifyNwcPayFailure(error: unknown): {
  disposition: "rejected" | "unknown";
  code: string;
  message: string;
} {
  const name = error instanceof Error ? error.name : "";
  const message = errorText(error);
  const code = errorCode(error);
  const lower = message.toLowerCase();

  if (lower.includes("already paid") || lower.includes("already settled")) {
    return {
      disposition: "unknown",
      code: code || "ALREADY_PAID",
      message,
    };
  }

  const unconfirmed =
    name.includes("Timeout") ||
    name.includes("Network") ||
    code.includes("TIMEOUT") ||
    code.includes("NETWORK") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("socket") ||
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("aborted") ||
    lower.includes("websocket");
  if (unconfirmed) {
    return { disposition: "unknown", code: code || "UNCONFIRMED", message };
  }

  if (DEFINITIVE_REJECTION_CODES.has(code)) {
    return { disposition: "rejected", code, message };
  }
  if (DEFINITIVE_REJECTION_TEXT.some((text) => lower.includes(text))) {
    return { disposition: "rejected", code: code || "PAYMENT_FAILED", message };
  }
  return { disposition: "unknown", code: code || "UNCONFIRMED", message };
}

function readPreimage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const preimage = (value as { preimage?: unknown }).preimage;
  if (typeof preimage !== "string") return null;
  const trimmed = preimage.trim();
  if (trimmed.length < 32) return null;
  return trimmed;
}

/**
 * Reads a NIP-47 lookup_invoice result.
 * Settled requires the millisatoshi amount to match the authorized sats.
 * `failed` is the only non-settled state that authorizes a later retry.
 * Anything else, including a missing lookup, stays inconclusive.
 */
export function interpretNwcLookup(
  raw: unknown,
  expectedSats: number
): LookupInterpretation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "inconclusive" };
  }
  const obj = raw as Record<string, unknown>;
  const state = typeof obj["state"] === "string" ? obj["state"] : "";
  const preimage = readPreimage(obj);
  const settledAt = obj["settled_at"];
  const settledAtMs = typeof settledAt === "number" ? settledAt : 0;
  const settled = state === "settled" || (settledAtMs > 0 && preimage !== null);
  if (settled) {
    const amount = amountSatsFromMillisatoshis(obj["amount"]);
    if (!amount.ok || amount.amountSats !== expectedSats) {
      return { kind: "inconclusive" };
    }
    return { kind: "settled", preimage };
  }
  if (state === "failed" && preimage === null && settledAtMs <= 0) {
    return { kind: "failed" };
  }
  return { kind: "inconclusive" };
}

async function lookupIfSupported(
  client: AuthorizedNwcClient,
  paymentHash: string
): Promise<unknown> {
  if (typeof client.lookupInvoice !== "function") return undefined;
  try {
    if (typeof client.getInfo === "function") {
      const info = await client.getInfo();
      if (
        Array.isArray(info.methods) &&
        info.methods.length > 0 &&
        !info.methods.includes("lookup_invoice")
      ) {
        return undefined;
      }
    }
    return await client.lookupInvoice({ payment_hash: paymentHash });
  } catch {
    return undefined;
  }
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number
): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function capturePay(
  client: AuthorizedNwcClient,
  invoice: string
): Promise<Extract<PayAttempt, { type: "pay" | "error" }>> {
  try {
    return { type: "pay", value: await client.payInvoice({ invoice }) };
  } catch (error) {
    return { type: "error", error };
  }
}

async function captureLookup(
  client: AuthorizedNwcClient,
  paymentHash: string
): Promise<{ type: "lookup"; value: unknown }> {
  return {
    type: "lookup",
    value: await lookupIfSupported(client, paymentHash),
  };
}

function paidResult(
  checked: { paymentHash: string; amountSats: number },
  preimage: string,
  walletResponse: unknown
): AuthorizedPayResult {
  return {
    ok: true,
    preimage,
    walletResponse,
    paymentHash: checked.paymentHash,
    amountSats: checked.amountSats,
  };
}

function failedResult(
  disposition: "rejected" | "unknown",
  code: string,
  message: string,
  paymentHash: string | null
): AuthorizedPayResult {
  return { ok: false, disposition, code, message, paymentHash };
}

function fromLookup(
  raw: unknown,
  checked: { paymentHash: string; amountSats: number },
  walletResponse: unknown
): AuthorizedPayResult {
  const interpreted = interpretNwcLookup(raw, checked.amountSats);
  if (interpreted.kind === "settled" && interpreted.preimage) {
    return paidResult(checked, interpreted.preimage, raw ?? walletResponse);
  }
  if (interpreted.kind === "settled") {
    return failedResult(
      "unknown",
      "reconciliation_required",
      "Wallet reports the invoice settled but did not return a preimage",
      checked.paymentHash
    );
  }
  if (interpreted.kind === "failed") {
    return failedResult(
      "rejected",
      "PAYMENT_FAILED",
      "Wallet reports the payment did not settle",
      checked.paymentHash
    );
  }
  return failedResult(
    "unknown",
    "reconciliation_required",
    "Payment outcome is unknown. Automatic retry is blocked until the wallet is checked.",
    checked.paymentHash
  );
}

/**
 * Pays one already-authorized BOLT11 invoice.
 * Validation runs again here so a raw invoice cannot reach `payInvoice`
 * from another call path. No wallet call is made when validation fails.
 */
export async function payAuthorizedBolt11(args: {
  nwcUrl: string;
  invoice: string;
  authorizedSats: number;
  timeoutMs: number;
  nowMs?: number;
  clientFactory?: (nwcUrl: string) => AuthorizedNwcClient;
}): Promise<AuthorizedPayResult> {
  const checked = assertBolt11MatchesAuthorizedAmount({
    invoice: args.invoice,
    authorizedSats: args.authorizedSats,
    nowMs: args.nowMs,
  });
  if (!checked.ok) {
    return failedResult("rejected", "invoice_rejected", checked.error, null);
  }

  const factory = args.clientFactory ?? defaultNwcClient;
  let client: AuthorizedNwcClient;
  try {
    client = factory(args.nwcUrl);
  } catch (error) {
    return failedResult(
      "rejected",
      "wallet_unavailable",
      errorText(error),
      checked.paymentHash
    );
  }

  const payPromise = capturePay(client, checked.invoice);

  try {
    const first = await withTimeout(payPromise, args.timeoutMs);
    if (first !== "timeout") {
      return settlePayAttempt(first, checked, client);
    }
    const follow = await Promise.race([
      payPromise,
      captureLookup(client, checked.paymentHash),
    ]);
    if (follow.type === "lookup") {
      return fromLookup(follow.value, checked, null);
    }
    return settlePayAttempt(follow, checked, client);
  } finally {
    try {
      client.close?.();
    } catch {
      // The payment result is already decided.
    }
  }
}

async function settlePayAttempt(
  attempt: Exclude<PayAttempt, { type: "timeout" | "lookup" }>,
  checked: { paymentHash: string; amountSats: number },
  client: AuthorizedNwcClient
): Promise<AuthorizedPayResult> {
  if (attempt.type === "pay") {
    const preimage = readPreimage(attempt.value);
    if (preimage) return paidResult(checked, preimage, attempt.value);
    const lookedUp = await lookupIfSupported(client, checked.paymentHash);
    return fromLookup(lookedUp, checked, attempt.value);
  }
  const classified = classifyNwcPayFailure(attempt.error);
  if (classified.disposition === "rejected") {
    return failedResult(
      "rejected",
      classified.code,
      classified.message,
      checked.paymentHash
    );
  }
  const lookedUp = await lookupIfSupported(client, checked.paymentHash);
  const reconciled = fromLookup(lookedUp, checked, null);
  if (reconciled.ok || reconciled.code === "PAYMENT_FAILED") return reconciled;
  return failedResult(
    "unknown",
    classified.code,
    classified.message,
    checked.paymentHash
  );
}

/**
 * Looks up a payment that may already have been sent.
 * This never calls `payInvoice`.
 */
export async function lookupAuthorizedPayment(args: {
  nwcUrl: string;
  paymentHash: string;
  authorizedSats: number;
  clientFactory?: (nwcUrl: string) => AuthorizedNwcClient;
}): Promise<LookupInterpretation> {
  const factory = args.clientFactory ?? defaultNwcClient;
  let client: AuthorizedNwcClient;
  try {
    client = factory(args.nwcUrl);
  } catch {
    return { kind: "inconclusive" };
  }
  try {
    const raw = await lookupIfSupported(client, args.paymentHash);
    return interpretNwcLookup(raw, args.authorizedSats);
  } finally {
    try {
      client.close?.();
    } catch {
      // Lookup already finished.
    }
  }
}
