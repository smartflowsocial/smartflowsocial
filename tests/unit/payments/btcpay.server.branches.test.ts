import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
}

const envState = vi.hoisted(() => {
  const env: {
    BTCPAY_URL?: string;
    BTCPAY_API_KEY?: string;
    BTCPAY_STORE_ID?: string;
    APP_URL?: string;
  } = {};
  return { env };
});

const logger = vi.hoisted(() => ({
  logError: vi.fn(
    (_error: unknown, _context?: Record<string, unknown>): void => undefined
  ),
}));

vi.mock("~/lib/env.server", () => ({ env: envState.env }));
vi.mock("~/lib/error-logger.server", () => logger);

import {
  BTCPAY_ONCHAIN_CHECKOUT_EXPIRATION_MINUTES,
  btcpayCreateInvoice,
  btcpayGetInvoiceSnapshot,
  isBtcpayConfigured,
  parseBtcpayInvoiceOnChainSnapshot,
  verifyBtcpayWebhookSignature,
} from "~/features/payments/btcpay.server";
import { ExternalServiceError } from "~/lib/errors";

const fetchMock = vi.fn(
  async (_url: string, _init?: RequestInit): Promise<FetchResponse> => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve("{}"),
  })
);

function response(
  status: number,
  body: string,
  statusText = "OK"
): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: () => Promise.resolve(body),
  };
}

function configure(overrides: Partial<typeof envState.env> = {}): void {
  envState.env.BTCPAY_URL = "https://btcpay.example/";
  envState.env.BTCPAY_API_KEY = " key ";
  envState.env.BTCPAY_STORE_ID = "store";
  envState.env.APP_URL = "https://app.example/";
  Object.assign(envState.env, overrides);
}

async function serviceError(
  run: () => Promise<unknown>
): Promise<ExternalServiceError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ExternalServiceError) return error;
    throw error;
  }
  throw new Error("expected ExternalServiceError");
}

function requestBody(): string {
  const body = fetchMock.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") throw new Error("expected a JSON body");
  return body;
}

describe("BTCPay configuration and invoices", () => {
  beforeEach(() => {
    configure();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(response(200, "{}"));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires a trimmed URL, key, and store", () => {
    expect(isBtcpayConfigured()).toBe(true);
    configure({ BTCPAY_URL: "  https://btcpay.example  " });
    expect(isBtcpayConfigured()).toBe(true);
    for (const missing of [
      "BTCPAY_URL",
      "BTCPAY_API_KEY",
      "BTCPAY_STORE_ID",
    ] as const) {
      configure({ [missing]: "   " });
      expect(isBtcpayConfigured()).toBe(false);
      configure({ [missing]: undefined });
      expect(isBtcpayConfigured()).toBe(false);
    }
  });

  it("refuses to create or read an invoice when BTCPay is not configured", async () => {
    configure({ BTCPAY_API_KEY: undefined });
    await expect(
      btcpayCreateInvoice({
        amountUsd: 10,
        paymentId: "pay-1",
        userId: "user-1",
        planId: "pro",
        planLabel: "Pro",
      })
    ).rejects.toThrow("BTCPay is not configured");
    await expect(btcpayGetInvoiceSnapshot("inv-1")).rejects.toThrow(
      "BTCPay is not configured"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a yearly checkout and keeps a numeric expiration", async () => {
    configure({ BTCPAY_STORE_ID: "store/id", APP_URL: "https://app.example" });
    fetchMock.mockResolvedValueOnce(
      response(
        200,
        JSON.stringify({
          id: "inv-1",
          checkoutLink: "https://btcpay.example/i/inv-1",
          expirationTime: 1_700_000_000,
        })
      )
    );

    await expect(
      btcpayCreateInvoice({
        amountUsd: 10.5,
        paymentId: "pay-1",
        userId: "user-1",
        planId: "founder",
        planLabel: "Founder",
      })
    ).resolves.toEqual({
      id: "inv-1",
      checkoutLink: "https://btcpay.example/i/inv-1",
      expirationTime: 1_700_000_000,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://btcpay.example/api/v1/stores/store%2Fid/invoices",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "token key",
        },
        body: JSON.stringify({
          amount: "10.50",
          currency: "USD",
          metadata: {
            smartflowPaymentId: "pay-1",
            smartflowUserId: "user-1",
            smartflowPlanId: "founder",
          },
          checkout: {
            expirationMinutes: BTCPAY_ONCHAIN_CHECKOUT_EXPIRATION_MINUTES,
            redirectURL: "https://app.example/dashboard?btcpayPaid=1",
          },
        }),
      }
    );
  });

  it("omits checkout redirect and a non-numeric expiration", async () => {
    configure({ APP_URL: "   " });
    fetchMock.mockResolvedValueOnce(
      response(
        200,
        JSON.stringify({
          id: "inv-2",
          checkoutLink: "https://btcpay.example/i/inv-2",
          expirationTime: "1700",
        })
      )
    );

    await expect(
      btcpayCreateInvoice({
        amountUsd: 10,
        paymentId: "pay-2",
        userId: "user-1",
        planId: "pro",
        planLabel: "Pro",
      })
    ).resolves.toEqual({
      id: "inv-2",
      checkoutLink: "https://btcpay.example/i/inv-2",
      expirationTime: undefined,
    });
    expect(JSON.parse(requestBody())).toMatchObject({
      checkout: {
        expirationMinutes: BTCPAY_ONCHAIN_CHECKOUT_EXPIRATION_MINUTES,
      },
    });
    expect(requestBody()).not.toContain("redirectURL");
  });

  it("maps provider failures to 502 or 400 and logs the provider message", async () => {
    fetchMock.mockResolvedValueOnce(
      response(503, JSON.stringify({ message: "store down" }), "Unavailable")
    );
    const server = await serviceError(() =>
      btcpayCreateInvoice({
        amountUsd: 10,
        paymentId: "pay-3",
        userId: "user-1",
        planId: "pro",
        planLabel: "Pro",
      })
    );
    expect(server.message).toBe(
      "Could not start Bitcoin checkout. Please try again later."
    );
    expect(server.statusCode).toBe(502);
    expect(server.context).toEqual({ btcpayStatus: 503 });

    fetchMock.mockResolvedValueOnce(
      response(422, "bad request", "Unprocessable")
    );
    const client = await serviceError(() =>
      btcpayCreateInvoice({
        amountUsd: 10,
        paymentId: "pay-4",
        userId: "user-1",
        planId: "pro",
        planLabel: "Pro",
      })
    );
    expect(client.statusCode).toBe(400);
    expect(client.context).toEqual({ btcpayStatus: 422 });

    fetchMock.mockResolvedValueOnce(response(400, "", "Bad Request"));
    await serviceError(() =>
      btcpayCreateInvoice({
        amountUsd: 10,
        paymentId: "pay-5",
        userId: "user-1",
        planId: "pro",
        planLabel: "Pro",
      })
    );
    const messages = logger.logError.mock.calls.map((call) => {
      const error = call[0];
      return error instanceof Error ? error.message : "";
    });
    expect(messages).toEqual([
      "BTCPay create invoice failed: store down",
      "BTCPay create invoice failed: bad request",
      "BTCPay create invoice failed: Bad Request",
    ]);
  });

  it("rejects an unreadable or incomplete invoice body", async () => {
    fetchMock.mockResolvedValueOnce(response(200, "not-json"));
    const invalid = await serviceError(() =>
      btcpayCreateInvoice({
        amountUsd: 10,
        paymentId: "pay-6",
        userId: "user-1",
        planId: "pro",
        planLabel: "Pro",
      })
    );
    expect(invalid.message).toBe("Invalid response from payment provider.");
    expect(invalid.statusCode).toBe(502);

    fetchMock.mockResolvedValueOnce(response(200, ""));
    fetchMock.mockResolvedValueOnce(response(200, "[]"));
    fetchMock.mockResolvedValueOnce(
      response(200, JSON.stringify({ id: "", checkoutLink: "https://pay" }))
    );
    fetchMock.mockResolvedValueOnce(
      response(200, JSON.stringify({ id: "inv", checkoutLink: "" }))
    );
    await serviceError(() =>
      btcpayCreateInvoice({
        amountUsd: 1,
        paymentId: "pay-7",
        userId: "user-1",
        planId: "pro",
        planLabel: "Pro",
      })
    );
    await serviceError(() =>
      btcpayCreateInvoice({
        amountUsd: 1,
        paymentId: "pay-8",
        userId: "user-1",
        planId: "pro",
        planLabel: "Pro",
      })
    );
    await serviceError(() =>
      btcpayCreateInvoice({
        amountUsd: 1,
        paymentId: "pay-9",
        userId: "user-1",
        planId: "pro",
        planLabel: "Pro",
      })
    );
    await serviceError(() =>
      btcpayCreateInvoice({
        amountUsd: 1,
        paymentId: "pay-10",
        userId: "user-1",
        planId: "pro",
        planLabel: "Pro",
      })
    );
    expect(logger.logError).toHaveBeenCalled();
  });

  it("loads an invoice snapshot and preserves the provider status on failure", async () => {
    fetchMock.mockResolvedValueOnce(
      response(
        200,
        JSON.stringify({
          status: "Processing",
          payments: [{ paymentMethodId: "BTC-onchain", confirmations: 2 }],
        })
      )
    );
    await expect(btcpayGetInvoiceSnapshot("inv/1")).resolves.toEqual({
      invoiceStatus: "Processing",
      maxOnChainConfirmations: 2,
      hasOnChainPaymentStarted: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://btcpay.example/api/v1/stores/store/invoices/inv%2F1",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: "token key",
        },
      }
    );

    fetchMock.mockResolvedValueOnce(response(404, "missing", "Not Found"));
    const missing = await serviceError(() => btcpayGetInvoiceSnapshot("gone"));
    expect(missing.message).toBe("BTCPay invoice lookup failed");
    expect(missing.statusCode).toBe(404);
    expect(missing.context).toEqual({});

    fetchMock.mockResolvedValueOnce(response(200, "not-json"));
    await expect(btcpayGetInvoiceSnapshot("blank")).resolves.toEqual({
      invoiceStatus: "",
      maxOnChainConfirmations: 0,
      hasOnChainPaymentStarted: false,
    });
  });
});

describe("parseBtcpayInvoiceOnChainSnapshot", () => {
  it("returns an empty snapshot when payments are missing or not a list", () => {
    expect(parseBtcpayInvoiceOnChainSnapshot(null)).toEqual({
      invoiceStatus: "",
      maxOnChainConfirmations: 0,
      hasOnChainPaymentStarted: false,
    });
    expect(parseBtcpayInvoiceOnChainSnapshot("nope")).toEqual({
      invoiceStatus: "",
      maxOnChainConfirmations: 0,
      hasOnChainPaymentStarted: false,
    });
    expect(parseBtcpayInvoiceOnChainSnapshot({ status: "New" })).toEqual({
      invoiceStatus: "New",
      maxOnChainConfirmations: 0,
      hasOnChainPaymentStarted: false,
    });
    expect(
      parseBtcpayInvoiceOnChainSnapshot({ status: 1, payments: "nope" })
    ).toEqual({
      invoiceStatus: "",
      maxOnChainConfirmations: 0,
      hasOnChainPaymentStarted: false,
    });
  });

  it("keeps the highest on-chain confirmation and ignores other methods", () => {
    expect(
      parseBtcpayInvoiceOnChainSnapshot({
        status: "Settled",
        payments: [
          null,
          "skip",
          [],
          { paymentMethodId: "BTC-Lightning", confirmations: 9 },
          { paymentMethodId: "onchain", confirmations: 8 },
          {
            paymentMethodId: "",
            paymentMethod: "LTC_ONCHAIN",
            confirmations: 5,
          },
          { paymentMethodId: "BTC-onchain", confirmations: 2 },
          { paymentMethod: "btc-onchain", confirmations: "3" },
          { paymentMethodId: "BTC-ONCHAIN" },
        ],
      })
    ).toEqual({
      invoiceStatus: "Settled",
      maxOnChainConfirmations: 5,
      hasOnChainPaymentStarted: true,
    });
  });
});

describe("verifyBtcpayWebhookSignature", () => {
  const secret = "webhook-secret";
  const body = '{"invoiceId":"inv-1"}';
  const signature = createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("hex");

  it("accepts a matching signature, including hex case and surrounding spaces", () => {
    expect(
      verifyBtcpayWebhookSignature(body, `sha256=${signature}`, secret)
    ).toBe(true);
    expect(
      verifyBtcpayWebhookSignature(
        body,
        `sha256=${signature.toUpperCase()}`,
        secret
      )
    ).toBe(true);
    expect(
      verifyBtcpayWebhookSignature(body, `sha256= ${signature} `, secret)
    ).toBe(true);
  });

  it("rejects a missing secret, a bad prefix, or a digest of the wrong length", () => {
    expect(verifyBtcpayWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyBtcpayWebhookSignature(body, `sha256=${signature}`, "")).toBe(
      false
    );
    expect(
      verifyBtcpayWebhookSignature(body, ` sha256=${signature}`, secret)
    ).toBe(false);
    expect(verifyBtcpayWebhookSignature(body, "sha1=abcd", secret)).toBe(false);
    expect(verifyBtcpayWebhookSignature(body, "sha256=", secret)).toBe(false);
    expect(verifyBtcpayWebhookSignature(body, "sha256=abcd", secret)).toBe(
      false
    );
    expect(verifyBtcpayWebhookSignature(body, "sha256=zz", secret)).toBe(false);
    expect(
      verifyBtcpayWebhookSignature(`${body} `, `sha256=${signature}`, secret)
    ).toBe(false);
    expect(
      verifyBtcpayWebhookSignature(body, `sha256=${signature}`, "other-secret")
    ).toBe(false);
  });
});
