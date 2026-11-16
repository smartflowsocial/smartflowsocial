import { toSingleFetchActionUrl } from "~/lib/remix/single-fetch";

/**
 * Bare `fetch()` POST target for a route action. Single fetch serves the
 * action payload at `pathname.data` as turbo-stream, not HTML.
 */
export function buildActionUrl(pathname: string): string {
  return toSingleFetchActionUrl(pathname);
}
