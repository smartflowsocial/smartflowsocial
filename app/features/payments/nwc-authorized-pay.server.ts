import { NWCClient } from "@getalby/sdk";

import { MAX_NWC_TIMEOUT_MS } from "~/features/payments/campaign-payout-resolution";
import {
  normalizePaymentHex,
  verifiedPreimage,
} from "~/features/payments/payment-preimage";
import {
  amountSatsFromMillisatoshis,
  assertBolt11MatchesAuthorizedAmount,
} from "~/features/referral/bolt11-invoice.server";

/**
 * NIP-47 codes that mean the wallet refused the command before a payment
 * existed. `PAYMENT_FAILED`, `INTERNAL`, and `OTHER` are not in this set:
 * those responses do not prove that funds stayed put.
 */
const DEFINITIVE_REJECTION_CODES = new Set([
  "INSUFFICIENT_BALANCE",
  "QUOTA_EXCEEDED",
  "RESTRICTED",
  "UNAUTHORIZED",
  "NOT_IMPLEMENTED",
  "RATE_LIMITED",
]);

export const DEFAULT_NWC_PAY_TIMEOUT_MS = 45_000;
export const DEFAULT_NWC_RECONCILE_TIMEOUT_MS = 15_000;

export { MAX_NWC_TIMEOUT_MS };

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

export function readPositiveTimeoutMs(
  value: string | undefined,
  fallback: number
): number {
  if (value == null || !/^\d+$/.test(value.trim())) return fallback;
  const parsed = Number(value.trim());
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 50 ||
    parsed > MAX_NWC_TIMEOUT_MS
  ) {
    return fallback;
  }
  return parsed;
}

/** Operator overrides. Invalid values keep the defaults. */
export function nwcTimeouts(
  source: Record<string, string | undefined> = process.env
): { payMs: number; reconcileMs: number } {
  return {
    payMs: readPositiveTimeoutMs(
      source["NWC_PAY_TIMEOUT_MS"],
      DEFAULT_NWC_PAY_TIMEOUT_MS
    ),
    reconcileMs: readPositiveTimeoutMs(
      source["NWC_RECONCILE_TIMEOUT_MS"],
      DEFAULT_NWC_RECONCILE_TIMEOUT_MS
    ),
  };
}

/**
 * A received wallet rejection may be retried with a new invoice.
 * A timeout, a dropped response, or an unclassified error may mean the
 * wallet already paid, so those stay unknown.
 *
 * Human-readable text is not proof. Only a structured NIP-47 code from
 * `DEFINITIVE_REJECTION_CODES` is a definitive failure.
 */
export function classifyNwcPayFailure(error: unknown): {
  disposition: "rejected" | "unknown";
  code: string;
  message: string;
} {
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

  if (DEFINITIVE_REJECTION_CODES.has(code)) {
    return { disposition: "rejected", code, message };
  }
  return { disposition: "unknown", code: code || "UNCONFIRMED", message };
}

/**
 * Reads a NIP-47 lookup_invoice result.
 * Settled requires the millisatoshi amount to match the authorized sats and,
 * when a preimage is present, that preimage to hash to the invoice payment
 * hash. A returned payment hash that does not match is inconclusive.
 * `failed` is the only non-settled state that authorizes a later retry, and
 * only when the response has no preimage field.
 */
export function interpretNwcLookup(
  raw: unknown,
  expectedSats: number,
  expectedPaymentHash: string
): LookupInterpretation {
  const expected = normalizePaymentHex(expectedPaymentHash);
  if (!expected) return { kind: "inconclusive" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "inconclusive" };
  }
  const obj = raw as Record<string, unknown>;
  const returnedHash = normalizePaymentHex(obj["payment_hash"]);
  if (returnedHash && returnedHash !== expected) {
    return { kind: "inconclusive" };
  }
  const preimageField = obj["preimage"];
  const hasPreimageField =
    typeof preimageField === "string" && preimageField.trim().length > 0;
  const preimage = verifiedPreimage(preimageField, expected);
  if (hasPreimageField && !preimage) return { kind: "inconclusive" };
  const state = typeof obj["state"] === "string" ? obj["state"] : "";
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
  if (
    state === "failed" &&
    !hasPreimageField &&
    preimage === null &&
    settledAtMs <= 0
  ) {
    return { kind: "failed" };
  }
  return { kind: "inconclusive" };
}

function swallow(work: Promise<unknown>): void {
  void (async () => {
    try {
      await work;
    } catch {
      // The caller already continued. A late rejection must not surface.
    }
  })();
}

async function settledCall<T>(
  work: Promise<T>
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await work };
  } catch {
    return { ok: false };
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
        timer = setTimeout(() => resolve("timeout"), Math.max(0, timeoutMs));
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function lookupIfSupported(
  client: AuthorizedNwcClient,
  paymentHash: string,
  timeoutMs: number
): Promise<unknown> {
  if (typeof client.lookupInvoice !== "function" || timeoutMs <= 0) {
    return undefined;
  }
  const started = Date.now();
  try {
    if (typeof client.getInfo === "function") {
      const info = await withTimeout(settledCall(client.getInfo()), timeoutMs);
      if (info === "timeout" || !info.ok) return undefined;
      const methods = info.value.methods;
      if (
        Array.isArray(methods) &&
        methods.length > 0 &&
        !methods.includes("lookup_invoice")
      ) {
        return undefined;
      }
    }
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0 || typeof client.lookupInvoice !== "function") {
      return undefined;
    }
    const looked = await withTimeout(
      settledCall(client.lookupInvoice({ payment_hash: paymentHash })),
      remaining
    );
    if (looked === "timeout" || !looked.ok) return undefined;
    return looked.value;
  } catch {
    return undefined;
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
  paymentHash: string,
  timeoutMs: number
): Promise<{ type: "lookup"; value: unknown }> {
  return {
    type: "lookup",
    value: await lookupIfSupported(client, paymentHash, timeoutMs),
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
  const interpreted = interpretNwcLookup(
    raw,
    checked.amountSats,
    checked.paymentHash
  );
  if (interpreted.kind === "settled" && interpreted.preimage) {
    return paidResult(checked, interpreted.preimage, raw ?? walletResponse);
  }
  if (interpreted.kind === "settled") {
    return failedResult(
      "unknown",
      "reconciliation_required",
      "Wallet reports the invoice settled but did not return a valid preimage",
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

function returnedPaymentHash(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  return normalizePaymentHex(
    (value as { payment_hash?: unknown }).payment_hash
  );
}

/**
 * Pays one already-authorized BOLT11 invoice.
 * Validation runs again here so a raw invoice cannot reach `payInvoice`
 * from another call path. No wallet call is made when validation fails.
 * Neither the payment nor the reconciliation lookup can block past its timeout.
 */
export async function payAuthorizedBolt11(args: {
  nwcUrl: string;
  invoice: string;
  authorizedSats: number;
  timeoutMs: number;
  reconcileTimeoutMs?: number;
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

  const reconcileMs = args.reconcileTimeoutMs ?? args.timeoutMs;
  const payPromise = capturePay(client, checked.invoice);
  swallow(payPromise);

  // Active window, in order: this pay wait, the reconciliation race below,
  // and one more lookup inside settlePayAttempt. The payout resolution
  // active window must stay equal to that sum. A hanging lookup ends here.
  try {
    const first = await withTimeout(payPromise, args.timeoutMs);
    if (first !== "timeout") {
      return settlePayAttempt(first, checked, client, reconcileMs);
    }
    const lookupPromise = captureLookup(
      client,
      checked.paymentHash,
      reconcileMs
    );
    swallow(lookupPromise);
    const raced = Promise.race([payPromise, lookupPromise]);
    swallow(raced);
    const follow = await withTimeout(raced, reconcileMs);
    if (follow === "timeout") {
      return failedResult(
        "unknown",
        "reconciliation_timeout",
        "Payment and wallet lookup both exceeded the reconciliation deadline. Automatic retry is blocked.",
        checked.paymentHash
      );
    }
    if (follow.type === "lookup") {
      return fromLookup(follow.value, checked, null);
    }
    return settlePayAttempt(follow, checked, client, reconcileMs);
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
  client: AuthorizedNwcClient,
  lookupTimeoutMs: number
): Promise<AuthorizedPayResult> {
  if (attempt.type === "pay") {
    const returnedHash = returnedPaymentHash(attempt.value);
    if (returnedHash && returnedHash !== checked.paymentHash) {
      return failedResult(
        "unknown",
        "preimage_mismatch",
        "Wallet returned a different payment hash. Automatic retry is blocked.",
        checked.paymentHash
      );
    }
    const preimage = verifiedPreimage(
      (attempt.value as { preimage?: unknown } | null)?.preimage,
      checked.paymentHash
    );
    if (preimage) return paidResult(checked, preimage, attempt.value);
    const lookedUp = await lookupIfSupported(
      client,
      checked.paymentHash,
      lookupTimeoutMs
    );
    const reconciled = fromLookup(lookedUp, checked, attempt.value);
    if (reconciled.ok) return reconciled;
    if (
      typeof (attempt.value as { preimage?: unknown } | null)?.preimage ===
      "string"
    ) {
      return failedResult(
        "unknown",
        "preimage_mismatch",
        "Wallet preimage does not match the invoice payment hash. Automatic retry is blocked.",
        checked.paymentHash
      );
    }
    return reconciled;
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
  const lookedUp = await lookupIfSupported(
    client,
    checked.paymentHash,
    lookupTimeoutMs
  );
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
 * This never calls `payInvoice`. The lookup cannot block past `timeoutMs`.
 */
export async function lookupAuthorizedPayment(args: {
  nwcUrl: string;
  paymentHash: string;
  authorizedSats: number;
  timeoutMs?: number;
  clientFactory?: (nwcUrl: string) => AuthorizedNwcClient;
}): Promise<LookupInterpretation> {
  const factory = args.clientFactory ?? defaultNwcClient;
  let client: AuthorizedNwcClient;
  try {
    client = factory(args.nwcUrl);
  } catch {
    return { kind: "inconclusive" };
  }
  const timeoutMs = args.timeoutMs ?? nwcTimeouts().reconcileMs;
  try {
    const raw = await lookupIfSupported(client, args.paymentHash, timeoutMs);
    return interpretNwcLookup(raw, args.authorizedSats, args.paymentHash);
  } finally {
    try {
      client.close?.();
    } catch {
      // Lookup already finished.
    }
  }
}
