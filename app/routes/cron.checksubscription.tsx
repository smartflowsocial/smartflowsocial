import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { checkAndRenewSubscriptions } from "~/features/payments";
import { cronJson, denyCronUnlessAuthorized } from "~/lib/cron-http.server";
import { jsonResponse } from "~/lib/http/json-response";

/**
 * Manual trigger for the subscription renewal sweep. The worker runs the same
 * function on SUBSCRIPTION_RENEWAL_INTERVAL_MINUTES. This route does not have
 * to be called for renewals to happen.
 */
async function runSubscriptionCron(request?: Request) {
  const denied = denyCronUnlessAuthorized(request);
  if (denied) return denied;

  const result = await checkAndRenewSubscriptions();
  return cronJson(result, result.success ? 200 : 500);
}

export async function loader(args?: LoaderFunctionArgs) {
  return runSubscriptionCron(args?.request);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }
  return runSubscriptionCron(request);
}
