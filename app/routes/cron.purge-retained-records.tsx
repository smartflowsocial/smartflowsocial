import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { purgeRetainedRecords } from "~/features/user/data/account-data.server";
import { cronJson, denyCronUnlessAuthorized } from "~/lib/cron-http.server";
import { logError } from "~/lib/error-logger.server";

/**
 * Cron job to delete retained payment rows and referral payout audit rows
 * older than the retention window. Intended cadence: daily. POST is preferred.
 */
async function runPurgeCron(request: Request) {
  const denied = denyCronUnlessAuthorized(request);
  if (denied) return denied;
  try {
    const result = await purgeRetainedRecords();
    return cronJson(result);
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
    return json(
      { error: "Method not allowed" },
      { status: 405, headers: { "Cache-Control": "no-store" } }
    );
  }
  return runPurgeCron(request);
}
