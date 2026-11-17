import {
  assertBolt11MatchesAuthorizedAmount,
  isPositiveWholeSats,
  type Bolt11ReadResult,
} from "~/features/referral/bolt11-invoice.server";

import {
  extractInvoiceFromRequest,
  extractPaymentHashFromRequest,
} from "./data/payment-utils.server";
import { normalizePaymentHex } from "./payment-preimage";

const flights = new Map<string, Promise<unknown>>();

/**
 * Shares one in-flight finalization invoice create across callers in this process.
 * A second caller waits for the first result instead of asking the wallet again.
 */
export async function singleFlight<T>(
  key: string,
  run: () => Promise<T>
): Promise<T> {
  const current = flights.get(key) as Promise<T> | undefined;
  if (current) return current;
  const created = run();
  flights.set(key, created);
  try {
    return await created;
  } finally {
    if (flights.get(key) === created) flights.delete(key);
  }
}

/**
 * Wallet-provided amount fields. The encoded BOLT11 amount is checked
 * separately. A present field that is fractional, zero, or disagrees with
 * another field is rejected instead of rounded into a satoshi value.
 */
export function readWalletAmountMetadata(
  request: unknown
): { ok: true; amountSats: number | null } | { ok: false; error: string } {
  const record =
    request && typeof request === "object" && !Array.isArray(request)
      ? (request as Record<string, unknown>)
      : {};
  const invoice = record["invoice"];
  const invoiceRecord =
    invoice && typeof invoice === "object" && !Array.isArray(invoice)
      ? (invoice as Record<string, unknown>)
      : null;
  const candidates: unknown[] = [];
  if ("amount" in record) candidates.push(record["amount"]);
  if ("satoshi" in record) candidates.push(record["satoshi"]);
  if (invoiceRecord && "satoshi" in invoiceRecord) {
    candidates.push(invoiceRecord["satoshi"]);
  }
  if (candidates.length === 0) return { ok: true, amountSats: null };

  const parsed: number[] = [];
  for (const candidate of candidates) {
    if (!isPositiveWholeSats(candidate)) {
      return {
        ok: false,
        error: "Wallet amount metadata is not a positive whole number of sats",
      };
    }
    parsed.push(candidate);
  }
  const first = parsed[0];
  if (first === undefined || parsed.some((value) => value !== first)) {
    return {
      ok: false,
      error: "Wallet amount metadata disagrees with itself",
    };
  }
  return { ok: true, amountSats: first };
}

/**
 * Accepts an owner-wallet invoice only when the encoded BOLT11 amount, network,
 * expiry, and payment hash agree with the authorized fee and the wallet metadata.
 */
export function acceptFinalizationWalletInvoice(args: {
  request: unknown;
  authorizedSats: number;
  nowMs?: number;
}): Bolt11ReadResult {
  const metadata = readWalletAmountMetadata(args.request);
  if (!metadata.ok) return metadata;
  const invoice = extractInvoiceFromRequest(args.request);
  const decoded = assertBolt11MatchesAuthorizedAmount({
    invoice,
    authorizedSats: args.authorizedSats,
    nowMs: args.nowMs,
  });
  if (!decoded.ok) return decoded;
  const walletHash = normalizePaymentHex(
    extractPaymentHashFromRequest(args.request)
  );
  if (!walletHash || walletHash !== decoded.paymentHash) {
    return {
      ok: false,
      error: "Wallet payment hash does not match the invoice",
    };
  }
  if (
    metadata.amountSats !== null &&
    metadata.amountSats !== decoded.amountSats
  ) {
    return {
      ok: false,
      error: "Wallet amount does not match the invoice",
    };
  }
  return decoded;
}

export function acceptedStoredFinalizationInvoice(
  existing: {
    id: string;
    invoice: string | null;
    paymentHash: string | null;
    amount: number;
    expiresAt: Date | null;
  } | null,
  authorizedSats: number,
  nowMs: number = Date.now()
): {
  invoice: string;
  paymentHash: string;
  amount: number;
  expiresAt: Date;
  paymentId: string;
} | null {
  if (
    !existing?.invoice ||
    !existing.paymentHash ||
    !existing.expiresAt ||
    existing.amount !== authorizedSats
  ) {
    return null;
  }
  if (
    !storedFinalizationInvoiceStillMatches({
      invoice: existing.invoice,
      paymentHash: existing.paymentHash,
      amountSats: existing.amount,
      expiresAtMs: existing.expiresAt.getTime(),
      nowMs,
    })
  ) {
    return null;
  }
  return {
    invoice: existing.invoice,
    paymentHash: existing.paymentHash,
    amount: existing.amount,
    expiresAt: existing.expiresAt,
    paymentId: existing.id,
  };
}

/** A stored pending invoice may be shown again only when it still matches. */
export function storedFinalizationInvoiceStillMatches(args: {
  invoice: string;
  paymentHash: string;
  amountSats: number;
  expiresAtMs: number;
  nowMs?: number;
}): boolean {
  const nowMs = args.nowMs ?? Date.now();
  if (args.expiresAtMs <= nowMs) return false;
  const checked = acceptFinalizationWalletInvoice({
    request: {
      invoice: args.invoice,
      paymentHash: args.paymentHash,
      amount: args.amountSats,
    },
    authorizedSats: args.amountSats,
    nowMs,
  });
  return checked.ok && checked.expiresAtMs >= args.expiresAtMs;
}
