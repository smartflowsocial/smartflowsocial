/**
 * Application URL for code that only has the Fetch request.
 * With `v8_passThroughRequests`, `request.url` keeps the `.data` suffix.
 * Loaders that receive the framework `url` argument should use that instead.
 */
export function appUrlFromRequest(request: Request): URL {
  const url = new URL(request.url);
  if (url.pathname.endsWith(".data")) {
    const pathname = url.pathname.slice(0, -".data".length);
    url.pathname = pathname.length > 0 ? pathname : "/";
  }
  return url;
}
