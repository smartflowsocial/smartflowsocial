/**
 * Detect whether this request wants a synchronous JSON response rather than
 * the default `defer()` streaming response.
 *
 * Remix strips `_data` and single-fetch `_routes` before the loader sees the
 * Request. `_loader=json` is our own param, so it survives both protocols.
 * Raw client fetches set it (`useInfiniteRemixQuery`, calendar history, flow
 * load-more) and then decode the single-fetch body.
 */
export function isRemixResourceRequest(request: Request): boolean {
  const url = new URL(request.url);
  return url.searchParams.get("_loader") === "json";
}
