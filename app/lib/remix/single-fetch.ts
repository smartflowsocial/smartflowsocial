/**
 * Raw `fetch()` against Remix loaders and actions once `v3_singleFetch` is on.
 *
 * Document navigations and `useFetcher()` stay on Remix's own data strategy.
 * These helpers are for call sites that used `?_data=` and `response.json()`.
 * Single fetch serves that data at `pathname.data` as a turbo-stream body.
 * turbo-stream 3.2.1 resolves the decoded value directly and reads strings, so
 * byte response bodies are decoded to text first.
 */

import { decode, type DecodePlugin } from "turbo-stream";

const SINGLE_FETCH_REDIRECT = Symbol("single-fetch-redirect");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRedirectEnvelope(
  value: unknown
): value is { [SINGLE_FETCH_REDIRECT]: unknown } {
  return isRecord(value) && SINGLE_FETCH_REDIRECT in value;
}

/**
 * turbo-stream 3 reads `chunk.charCodeAt`. `fetch()` bodies are bytes.
 * String chunks pass through so tests can feed an already-decoded stream.
 */
function turboStreamTextBody(
  body: ReadableStream<Uint8Array>
): ReadableStream<string> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  return new ReadableStream<string>({
    async pull(controller) {
      const result = await reader.read();
      if (result.done) {
        const tail = decoder.decode();
        if (tail.length > 0) controller.enqueue(tail);
        controller.close();
        return;
      }
      const chunk: unknown = result.value;
      controller.enqueue(
        typeof chunk === "string"
          ? chunk
          : decoder.decode(chunk as AllowSharedBufferSource, { stream: true })
      );
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

const decodePlugins: DecodePlugin[] = [
  (type, ...rest) => {
    if (type === "SanitizedError") {
      const message = typeof rest[1] === "string" ? rest[1] : "";
      const error = new Error(message);
      if (typeof rest[0] === "string" && rest[0].length > 0) {
        error.name = rest[0];
      }
      if (typeof rest[2] === "string") error.stack = rest[2];
      return { value: error };
    }
    if (type === "ErrorResponse") {
      const status = typeof rest[1] === "number" ? rest[1] : 500;
      const statusText = typeof rest[2] === "string" ? rest[2] : "";
      const error = new Error(
        statusText.length > 0 ? statusText : `Route error ${status}`
      );
      error.name = "ErrorResponse";
      return { value: error };
    }
    if (type === "SingleFetchRedirect") {
      return { value: { [SINGLE_FETCH_REDIRECT]: rest[0] } };
    }
    return;
  },
  (type, value) => {
    if (type === "SingleFetchFallback") return { value: undefined };
    if (type === "SingleFetchClassInstance") return { value };
    return;
  },
];

export async function decodeSingleFetch(
  body: ReadableStream<Uint8Array>
): Promise<unknown> {
  return decode(turboStreamTextBody(body), { plugins: decodePlugins });
}

function singleFetchPathname(pathname: string): string {
  const bare = pathname.replace(/\/+$/, "") || "/";
  return bare === "/" ? "/_root.data" : `${bare}.data`;
}

/**
 * Loader URL for one route. `_routes` limits the call to that loader.
 * `_loader=json` asks our loaders for plain data instead of `defer()`.
 * Remix strips `_routes` before the loader runs and leaves `_loader`.
 */
export function toSingleFetchLoaderUrl(input: string, routeId: string): string {
  const base =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const url = new URL(input, base);
  url.pathname = singleFetchPathname(url.pathname);
  url.searchParams.delete("_data");
  url.searchParams.set("_routes", routeId);
  url.searchParams.set("_loader", "json");
  return `${url.pathname}${url.search}`;
}

/** Action URL. The matched leaf route handles the POST. */
export function toSingleFetchActionUrl(pathname: string): string {
  const url = new URL(pathname, "http://localhost");
  url.pathname = singleFetchPathname(url.pathname);
  url.searchParams.delete("_data");
  return `${url.pathname}${url.search}`;
}

export interface RemixLoaderResult<T> {
  status: number;
  ok: boolean;
  data: T | null;
}

function unwrapLoaderData(payload: unknown, routeId: string): unknown {
  if (isRedirectEnvelope(payload)) {
    throw new Error(`Single-fetch redirect for ${routeId}`);
  }
  if (!isRecord(payload)) {
    throw new Error(`No single-fetch data for ${routeId}`);
  }
  const entry = payload[routeId];
  if (!isRecord(entry)) {
    throw new Error(`No single-fetch data for ${routeId}`);
  }
  if ("error" in entry) {
    const error = entry["error"];
    throw error instanceof Error ? error : new Error(String(error));
  }
  if ("data" in entry) return entry["data"];
  throw new Error(`No single-fetch data for ${routeId}`);
}

export async function fetchRemixLoader<T = unknown>(
  input: string,
  routeId: string,
  init?: RequestInit
): Promise<RemixLoaderResult<T>> {
  const response = await fetch(toSingleFetchLoaderUrl(input, routeId), {
    ...init,
    method: "GET",
    credentials: init?.credentials ?? "same-origin",
  });
  if (response.status === 204 || response.status === 205 || !response.body) {
    return { status: response.status, ok: response.ok, data: null };
  }
  const payload = await decodeSingleFetch(response.body);
  const data = unwrapLoaderData(payload, routeId) as T;
  return { status: response.status, ok: response.ok, data };
}

/**
 * Reads a single-fetch action body. Returns the action payload, or null when
 * the body is missing, a redirect, or not a turbo-stream.
 */
export async function readRemixActionData(
  response: Response
): Promise<unknown> {
  if (!response.body) return null;
  try {
    const payload = await decodeSingleFetch(response.body);
    if (isRedirectEnvelope(payload) || !isRecord(payload)) return null;
    if ("error" in payload && !("data" in payload)) return null;
    if ("data" in payload) return payload["data"];
    return null;
  } catch {
    return null;
  }
}
