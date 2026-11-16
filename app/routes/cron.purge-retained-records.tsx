import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import { purgeRetainedRecords } from "~/features/user/data/account-data.server";
import { cronJson, denyCronUnlessAuthorized } from "~/lib/cron-http.server";
import { logError, logWarning } from "~/lib/error-logger.server";
import { jsonResponse } from "~/lib/http/json-response";

/**
 * Cron job to delete retained payment rows and referral payout audit rows
 * older than the retention window. Intended cadence: daily. POST is preferred.
 */
async function runPurgeCron(request: Request) {
  const denied = denyCronUnlessAuthorized(request);
  if (denied) return denied;
  if (request.method === "GET") {
    logWarning(
      "GET /cron/purge-retained-records is still accepted. New schedulers should POST.",
      {}
    );
  }
  try {
    const result = await purgeRetainedRecords();
    const response = cronJson(result);
    if (request.method === "GET") {
      response.headers.set("Deprecation", "true");
    }
    return response;
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), {
      message: "[CRON] Failed to purge retained records",
    });
    return cronJson({ success: false }, 500);
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  return runPurgeCron(request);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed" },
      { status: 405, headers: { "Cache-Control": "no-store" } }
    );
  }
  return runPurgeCron(request);
}
