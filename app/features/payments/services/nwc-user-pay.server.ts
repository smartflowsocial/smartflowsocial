import { NWCClient } from "@getalby/sdk";

import { verifiedPreimage } from "~/features/payments/payment-preimage";
import { readBolt11ForPayout } from "~/features/referral/bolt11-invoice.server";
import { ensureServerWebSocket } from "~/lib/websocket-polyfill.server";

const DEFINITIVE_WALLET_REJECTION_CODES = new Set([
  "INSUFFICIENT_BALANCE",
  "QUOTA_EXCEEDED",
  "RESTRICTED",
  "UNAUTHORIZED",
  "NOT_IMPLEMENTED",
  "RATE_LIMITED",
]);

const NWC_PROBE_TIMEOUT_MS = 15_000;
const NWC_PAY_TIMEOUT_MS = 55_000;

export type NwcChargeFailureKind =
  | "connection_dead"
  | "wallet_rejected"
  | "invoice_failed"
  | "unconfirmed";

export class NwcChargeError extends Error {
  readonly kind: NwcChargeFailureKind;

  constructor(kind: NwcChargeFailureKind, message: string) {
    super(message);
    this.name = "NwcChargeError";
    this.kind = kind;
  }
}

export function nwcChargeFailureNotice(kind: NwcChargeFailureKind): string {
  switch (kind) {
    case "wallet_rejected":
      return "Your wallet rejected the payment. Check the spending budget and balance.";
    case "connection_dead":
      return "We could not reach your wallet connection. Reconnect NWC in billing settings.";
    case "invoice_failed":
      return "We could not create the renewal invoice. We will retry automatically.";
    case "unconfirmed":
      return "Your wallet did not confirm the payment. We will retry automatically.";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function classifyNwcPayError(error: unknown): NwcChargeFailureKind {
  const name = error instanceof Error ? error.name : "";
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code).toUpperCase()
      : "";

  if (
    name.includes("Timeout") ||
    name.includes("Network") ||
    code.includes("TIMEOUT") ||
    code.includes("NETWORK") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("websocket") ||
    message.includes("econnrefused") ||
    message.includes("not connected") ||
    message.includes("failed to publish") ||
    message.includes("relay")
  ) {
    return message.includes("payment timed out")
      ? "unconfirmed"
      : "connection_dead";
  }

  if (
    message.includes("already paid") ||
    message.includes("already settled") ||
    message.includes("preimage")
  ) {
    return "unconfirmed";
  }

  if (DEFINITIVE_WALLET_REJECTION_CODES.has(code)) return "wallet_rejected";
  return "unconfirmed";
}

/**
 * Confirms the wallet can be reached, and that a configured spending budget
 * is not already used up, before we ask the owner wallet for an invoice.
 */
export async function assertUserNwcCanPay(nwcUrl: string): Promise<void> {
  ensureServerWebSocket();
  const client = new NWCClient({ nostrWalletConnectUrl: nwcUrl });
  try {
    const info = await withNwcTimeout(
      client.getInfo(),
      NWC_PROBE_TIMEOUT_MS,
      "Wallet connection timed out"
    );
    if (
      Array.isArray(info.methods) &&
      info.methods.length > 0 &&
      !info.methods.includes("pay_invoice")
    ) {
      throw new NwcChargeError(
        "connection_dead",
        "Wallet connection cannot pay invoices"
      );
    }

    try {
      const budget = await withNwcTimeout(
        client.getBudget(),
        NWC_PROBE_TIMEOUT_MS,
        "Wallet budget check timed out"
      );
      if (
        "total_budget" in budget &&
        typeof budget.total_budget === "number" &&
        budget.total_budget > 0 &&
        "used_budget" in budget &&
        typeof budget.used_budget === "number" &&
        budget.used_budget >= budget.total_budget
      ) {
        throw new NwcChargeError(
          "wallet_rejected",
          "Wallet spending budget is used up"
        );
      }
    } catch (error) {
      if (error instanceof NwcChargeError) throw error;
    }
  } catch (error) {
    if (error instanceof NwcChargeError) throw error;
    throw new NwcChargeError("connection_dead", errorText(error));
  } finally {
    client.close();
  }
}

/**
 * Pays a BOLT11 invoice and returns the preimage. A missing preimage is not
 * a successful payment.
 */
export async function payBolt11WithUserNwc(
  nwcUrl: string,
  invoice: string
): Promise<string> {
  ensureServerWebSocket();
  const decoded = readBolt11ForPayout(invoice);
  if (!decoded.ok) {
    throw new NwcChargeError("unconfirmed", decoded.error);
  }
  const client = new NWCClient({ nostrWalletConnectUrl: nwcUrl });
  const payment = captureUserPayment(client, invoice);
  void (async () => {
    try {
      await payment;
    } catch {
      // The timeout path already decided. A late rejection must not surface.
    }
  })();
  try {
    const result = await withNwcTimeout(
      payment,
      NWC_PAY_TIMEOUT_MS,
      "Wallet payment timed out"
    );
    if (!result.ok) {
      throw new NwcChargeError(
        classifyNwcPayError(result.error),
        errorText(result.error)
      );
    }
    const preimage = verifiedPreimage(
      result.value.preimage,
      decoded.paymentHash
    );
    if (!preimage) {
      throw new NwcChargeError(
        "unconfirmed",
        "Wallet did not return a preimage for this invoice"
      );
    }
    return preimage;
  } catch (error) {
    if (error instanceof NwcChargeError) throw error;
    const message = errorText(error);
    if (message.toLowerCase().includes("payment timed out")) {
      throw new NwcChargeError("unconfirmed", "Wallet payment timed out");
    }
    throw new NwcChargeError(classifyNwcPayError(error), message);
  } finally {
    client.close();
  }
}

async function captureUserPayment(
  client: NWCClient,
  invoice: string
): Promise<
  { ok: true; value: { preimage?: unknown } } | { ok: false; error: unknown }
> {
  try {
    return { ok: true, value: await client.payInvoice({ invoice }) };
  } catch (error) {
    return { ok: false, error };
  }
}

async function withNwcTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
