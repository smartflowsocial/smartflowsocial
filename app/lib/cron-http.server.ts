import { cronRequestAuthorized } from "~/lib/cron-auth.server";
import { env } from "~/lib/env.server";
import { jsonResponse } from "~/lib/http/json-response";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Returns a 401 response when the cron secret is missing or does not match.
 * Returns null when the caller may run the job.
 */
export function denyCronUnlessAuthorized(
  request: Request | undefined
): Response | null {
  if (!cronRequestAuthorized(request, env.CRON_SECRET)) {
    return jsonResponse(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE }
    );
  }
  return null;
}

export function cronJson(data: unknown, status = 200): Response {
  return jsonResponse(data, { status, headers: NO_STORE });
}
