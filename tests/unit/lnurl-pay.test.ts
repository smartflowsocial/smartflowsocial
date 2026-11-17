import { afterEach, describe, expect, it, vi } from "vitest";

import { freshInvoiceForSats } from "../helpers/bolt11-fixture";

import { fetchLnurlPayInvoice } from "~/features/referral/lnurl-pay.server";

const metadataUrl = "https://example.com/.well-known/lnurlp/alice";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LNURL pay invoice fetch", () => {
  it("returns an invoice only when the callback amount matches", async () => {
    const invoice = freshInvoiceForSats(100);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === metadataUrl) {
        return jsonResponse({
          callback: "https://example.com/lnurl/pay",
          minSendable: 1000,
          maxSendable: 1_000_000_000,
        });
      }
      expect(url).toContain("amount=100000");
      return jsonResponse({ pr: invoice });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchLnurlPayInvoice(metadataUrl, 100);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice).toBe(invoice.trim());
  });

  it("rejects a callback invoice for a different amount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url) === metadataUrl) {
          return jsonResponse({
            callback: "https://example.com/lnurl/pay",
            minSendable: 1000,
            maxSendable: 1_000_000_000,
          });
        }
        return jsonResponse({ pr: freshInvoiceForSats(101) });
      })
    );
    const result = await fetchLnurlPayInvoice(metadataUrl, 100);
    expect(result).toMatchObject({ ok: false, code: "invoice_rejected" });
  });

  it("rejects an invalid callback response and an amountless invoice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url) === metadataUrl) {
          return jsonResponse({
            callback: "https://example.com/lnurl/pay",
            minSendable: 1000,
            maxSendable: 1_000_000_000,
          });
        }
        return jsonResponse({ status: "ERROR", reason: "no" });
      })
    );
    const errored = await fetchLnurlPayInvoice(metadataUrl, 100);
    expect(errored).toMatchObject({ ok: false, code: "invalid_response" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url) === metadataUrl) {
          return jsonResponse({
            callback: "https://example.com/lnurl/pay",
            minSendable: "nope",
            maxSendable: 1000,
          });
        }
        return jsonResponse({ pr: freshInvoiceForSats(100) });
      })
    );
    const malformed = await fetchLnurlPayInvoice(metadataUrl, 100);
    expect(malformed).toMatchObject({ ok: false, code: "invalid_response" });
  });

  it("rejects a fractional requested amount before calling the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchLnurlPayInvoice(metadataUrl, 1.5);
    expect(result).toMatchObject({ ok: false, code: "invalid_amount" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
