import type { LoaderFunctionArgs } from "react-router";

import { jsonAction, jsonLoader } from "~/lib/remix/json-response.server";
import { action as scheduledAction } from "~/routes/dashboard.scheduled";
import { loadScheduledValidated } from "~/routes/dashboard.scheduled.loader.server";

export const loader = jsonLoader(({ request, params }: LoaderFunctionArgs) =>
  loadScheduledValidated(request, params)
);
export const action = jsonAction(scheduledAction);
