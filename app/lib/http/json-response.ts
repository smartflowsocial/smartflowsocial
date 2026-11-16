/**
 * JSON response that works after Remix `installGlobals()`.
 * That polyfill's `Response` has no static `Response.json`.
 */
export function jsonResponse(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(data === undefined ? null : data), {
    status: init?.status,
    statusText: init?.statusText,
    headers,
  });
}
