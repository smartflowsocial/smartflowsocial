import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FetchInit {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

const logError = vi.hoisted(() =>
  vi.fn<(error: Error, context: { message: string }) => void>()
);
const fetchMock = vi.hoisted(() =>
  vi.fn<(url: string, init?: FetchInit) => Promise<FetchResponse>>()
);

vi.mock("~/lib/error-logger.server", () => ({
  logError,
}));

const KRAKEN_URL = "https://api.kraken.com/0/public/Ticker?pair=XBTUSDC,XBTEUR";
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur";
const NOW = Date.parse("2024-03-01T00:00:00.000Z");

function jsonResponse(body: unknown, status = 200): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

function krakenBody(
  usd = "100.5",
  eur = "90.25",
  error: string[] = []
): unknown {
  return {
    error,
    result: {
      XBTUSDC: { c: [usd, "1"] },
      XXBTZEUR: { c: [eur, "2"] },
    },
  };
}

function geckoBody(usd: unknown = 80, eur: unknown = 70): unknown {
  return { bitcoin: { usd, eur } };
}

async function loadRates() {
  vi.resetModules();
  return import("~/features/admin/admin-fx-rates.server");
}

describe("getAdminBtcSpotRates", () => {
  beforeEach(() => {
    logError.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns Kraken prices and serves the cached value until the ttl expires", async () => {
    fetchMock.mockResolvedValue(jsonResponse(krakenBody()));
    const { getAdminBtcSpotRates } = await loadRates();

    const first = await getAdminBtcSpotRates(NOW);
    const cached = await getAdminBtcSpotRates(NOW + 59_999);
    fetchMock.mockResolvedValueOnce(jsonResponse(krakenBody("101", "91")));
    const refreshed = await getAdminBtcSpotRates(NOW + 60_000);

    expect(first).toEqual({
      btcUsd: 100.5,
      btcEur: 90.25,
      fetchedAt: "2024-03-01T00:00:00.000Z",
      source: "kraken",
    });
    expect(cached).toBe(first);
    expect(refreshed.btcUsd).toBe(101);
    expect(refreshed.btcEur).toBe(91);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(KRAKEN_URL);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      Accept: "application/json",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses Date.now when the caller does not pass a timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fetchMock.mockResolvedValue(jsonResponse(krakenBody()));
    const { getAdminBtcSpotRates } = await loadRates();

    await expect(getAdminBtcSpotRates()).resolves.toMatchObject({
      fetchedAt: "2024-03-01T00:00:00.000Z",
      source: "kraken",
    });
  });

  it.each([
    [
      "a Kraken error list",
      krakenBody("1", "1", ["EGeneral: busy"]),
      "EGeneral: busy",
    ],
    [
      "a non-positive Kraken price",
      krakenBody("0", "90"),
      "Invalid Kraken ticker parse",
    ],
    [
      "a missing Kraken price",
      { error: [], result: { XBTUSDC: { c: [""] } } },
      "Invalid Kraken ticker parse",
    ],
    ["an HTTP error", null, "HTTP 503"],
  ])("falls back to CoinGecko after %s", async (_label, kraken, message) => {
    fetchMock.mockImplementation(async (url) => {
      if (url === KRAKEN_URL) {
        if (kraken === null) return jsonResponse({}, 503);
        return jsonResponse(kraken);
      }
      return jsonResponse(geckoBody());
    });
    const { getAdminBtcSpotRates } = await loadRates();

    await expect(getAdminBtcSpotRates(NOW)).resolves.toEqual({
      btcUsd: 80,
      btcEur: 70,
      fetchedAt: "2024-03-01T00:00:00.000Z",
      source: "coingecko",
    });
    const logged = logError.mock.calls[0]?.[0];
    expect(logged).toBeInstanceOf(Error);
    if (!(logged instanceof Error)) {
      throw new Error("expected Kraken error to be logged");
    }
    expect(logged.message).toBe(message);
    expect(logError.mock.calls[0]?.[1]).toEqual({
      message: "Admin Kraken FX fetch failed; trying CoinGecko",
    });
  });

  it("wraps a non-Error Kraken rejection before trying CoinGecko", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url === KRAKEN_URL) throw "kraken-down";
      return jsonResponse(geckoBody(81, 71));
    });
    const { getAdminBtcSpotRates } = await loadRates();

    await expect(getAdminBtcSpotRates(NOW)).resolves.toMatchObject({
      btcUsd: 81,
      source: "coingecko",
    });
    const logged = logError.mock.calls[0]?.[0];
    if (!(logged instanceof Error)) {
      throw new Error("expected wrapped Kraken error");
    }
    expect(logged.message).toBe("kraken-down");
  });

  it.each([
    ["missing bitcoin", {}],
    ["a non-numeric usd price", geckoBody("80", 70)],
    ["a non-finite usd price", geckoBody(Number.POSITIVE_INFINITY, 70)],
    ["a non-positive eur price", geckoBody(80, 0)],
  ])("throws when CoinGecko returns %s", async (_label, body) => {
    fetchMock.mockImplementation(async (url) => {
      if (url === KRAKEN_URL) throw new Error("kraken failed");
      return jsonResponse(body);
    });
    const { getAdminBtcSpotRates } = await loadRates();

    await expect(getAdminBtcSpotRates(NOW)).rejects.toThrow(
      "Invalid CoinGecko price parse"
    );
    expect(logError).toHaveBeenCalledTimes(2);
    expect(logError.mock.calls[1]?.[1]).toEqual({
      message: "Admin CoinGecko FX fallback failed",
    });
  });

  it("rethrows a non-Error CoinGecko failure after logging a wrapped error", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url === KRAKEN_URL) throw new Error("kraken failed");
      throw 404;
    });
    const { getAdminBtcSpotRates } = await loadRates();

    await expect(getAdminBtcSpotRates(NOW)).rejects.toBe(404);
    const logged = logError.mock.calls[1]?.[0];
    if (!(logged instanceof Error)) {
      throw new Error("expected wrapped CoinGecko error");
    }
    expect(logged.message).toBe("404");
  });

  it("aborts a hung request and tries the fallback source", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<FetchResponse>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        })
    );
    const { getAdminBtcSpotRates } = await loadRates();
    const pending = getAdminBtcSpotRates(NOW);
    const captured = pending.then(
      () => null,
      (error: unknown) => error
    );

    await vi.advanceTimersByTimeAsync(12_000);
    await vi.advanceTimersByTimeAsync(12_000);

    await expect(captured).resolves.toBeInstanceOf(Error);
    const error = await captured;
    if (!(error instanceof Error)) {
      throw new Error("expected abort");
    }
    expect(error.message).toBe("aborted");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(COINGECKO_URL);
  });
});
