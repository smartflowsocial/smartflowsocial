import { toDashboardJsonUrl } from "~/lib/remix/fetch-json";

/** POST target whose action returns JSON instead of a document. */
export function buildActionUrl(pathname: string): string {
  return toDashboardJsonUrl(pathname);
}
