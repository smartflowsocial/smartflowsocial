import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/error-logger.server", () => ({
  logError: vi.fn(),
}));

import { logError } from "~/lib/error-logger.server";
import {
  FetchError,
  FetchNetworkError,
  FetchRateLimitError,
  FetchTimeoutError,
  fetchJsonWithRetry,
  fetchWithRetry,
} from "~/lib/fetch.server";

const URL_OK = "https://example.com/resource";

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function hangUntilAbort(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener("abort", () => {
      reject(abortError());
    });
  });
}

describe("fetchWithRetry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(logError).mockClear();
  });

  it("returns a successful response and sends a correlation id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry(new URL(URL_OK), {
      timeout: 30_000,
      maxRetries: 0,
      retryDelay: 0,
      correlationId: "corr-1",
      headers: { Accept: "text/plain" },
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Correlation-Id"]).toBe("corr-1");
    expect(headers["Accept"]).toBe("text/plain");
  });

  it("returns client and unusual statuses without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response("redirect", { status: 302 }));
    vi.stubGlobal("fetch", fetchMock);
    const options = { timeout: 30_000, maxRetries: 2, retryDelay: 0 };

    await expect(fetchWithRetry(URL_OK, options)).resolves.toMatchObject({
      status: 404,
    });
    await expect(fetchWithRetry(URL_OK, options)).resolves.toMatchObject({
      status: 302,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 500 and then returns the recovered response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("down", { status: 503, statusText: "Unavailable" })
      )
      .mockResolvedValueOnce(new Response("up", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry(URL_OK, {
      timeout: 30_000,
      maxRetries: 2,
      retryDelay: 0,
      correlationId: "corr-5xx",
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalled();
  });

  it("does not retry 5xx when retryOn5xx is false", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("down", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry(URL_OK, {
      timeout: 30_000,
      maxRetries: 3,
      retryDelay: 0,
      retryOn5xx: false,
    });

    expect(response.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors a custom shouldRetry predicate", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("down", { status: 500 }))
      .mockResolvedValueOnce(new Response("up", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const shouldRetry = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    const response = await fetchWithRetry(URL_OK, {
      timeout: 30_000,
      maxRetries: 2,
      retryDelay: 0,
      shouldRetry,
    });

    expect(response.status).toBe(200);
    expect(shouldRetry).toHaveBeenCalledWith(expect.any(Response), 0);
  });

  it("returns the response when a custom predicate asks to retry a client error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("bad", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry(URL_OK, {
      timeout: 30_000,
      maxRetries: 2,
      retryDelay: 0,
      shouldRetry: () => true,
    });

    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries 429 using Retry-After and then succeeds", async () => {
    const limited = new Response("slow", {
      status: 429,
      headers: { "Retry-After": "0" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(limited)
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry(URL_OK, {
      timeout: 30_000,
      maxRetries: 1,
      retryDelay: 0,
      correlationId: "corr-429",
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(
      expect.any(FetchRateLimitError),
      expect.objectContaining({ correlationId: "corr-429" })
    );
  });

  it("retries 429 with backoff when Retry-After is absent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow", { status: 429 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry(URL_OK, {
      timeout: 30_000,
      maxRetries: 1,
      retryDelay: 0,
    });

    expect(response.status).toBe(200);
  });

  it("retries a network error and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry(URL_OK, {
      timeout: 30_000,
      maxRetries: 1,
      retryDelay: 0,
    });

    expect(response.status).toBe(200);
    expect(logError).toHaveBeenCalledWith(
      expect.any(FetchNetworkError),
      expect.any(Object)
    );
  });

  it("throws FetchNetworkError when network retries are exhausted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("econnrefused while dialing"))
    );

    await expect(
      fetchWithRetry(URL_OK, {
        timeout: 30_000,
        maxRetries: 1,
        retryDelay: 0,
      })
    ).rejects.toBeInstanceOf(FetchNetworkError);
  });

  it("throws immediately when network retries are disabled", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchWithRetry(URL_OK, {
        timeout: 30_000,
        maxRetries: 3,
        retryDelay: 0,
        retryOnNetworkError: false,
      })
    ).rejects.toBeInstanceOf(FetchNetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries an enotfound error and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND example.com"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchWithRetry(URL_OK, {
        timeout: 30_000,
        maxRetries: 1,
        retryDelay: 0,
      })
    ).resolves.toMatchObject({ status: 200 });
  });

  it("rethrows errors that are not timeouts or network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

    await expect(
      fetchWithRetry(URL_OK, {
        timeout: 30_000,
        maxRetries: 2,
        retryDelay: 0,
      })
    ).rejects.toThrow("boom");
  });

  it("rethrows a non-error throw that is not a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("boom"));

    await expect(
      fetchWithRetry(URL_OK, {
        timeout: 30_000,
        maxRetries: 1,
        retryDelay: 0,
      })
    ).rejects.toBe("boom");
  });

  it("retries an aborted request and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) =>
        hangUntilAbort(init)
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry(URL_OK, {
      timeout: 30,
      maxRetries: 1,
      retryDelay: 0,
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws FetchTimeoutError when the aborted request is not retried", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((_url: string, init?: RequestInit) =>
          hangUntilAbort(init)
        )
    );

    await expect(
      fetchWithRetry(URL_OK, {
        timeout: 20,
        maxRetries: 0,
        retryDelay: 0,
      })
    ).rejects.toBeInstanceOf(FetchTimeoutError);
  });

  it("aborts when the caller signal aborts", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((_url: string, init?: RequestInit) =>
          hangUntilAbort(init)
        )
    );
    const controller = new AbortController();
    const pending = fetchWithRetry(URL_OK, {
      timeout: 30_000,
      maxRetries: 0,
      retryDelay: 0,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(FetchTimeoutError);
  });

  it("throws when maxRetries never enters the loop", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(
      fetchWithRetry(URL_OK, {
        timeout: 30_000,
        maxRetries: -1,
        retryDelay: 0,
      })
    ).rejects.toBeInstanceOf(FetchError);
  });
});

describe("fetchJsonWithRetry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    await expect(
      fetchJsonWithRetry<{ ok: boolean }>(URL_OK, {
        timeout: 30_000,
        maxRetries: 0,
        retryDelay: 0,
        correlationId: "json-1",
      })
    ).resolves.toEqual({ ok: true });
  });

  it("throws FetchError when the JSON response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("nope", { status: 422, statusText: "Unprocessable" })
        )
    );

    await expect(
      fetchJsonWithRetry(URL_OK, {
        timeout: 30_000,
        maxRetries: 0,
        retryDelay: 0,
        correlationId: "json-2",
      })
    ).rejects.toMatchObject({
      name: "FetchError",
      status: 422,
      correlationId: "json-2",
    });
  });
});
