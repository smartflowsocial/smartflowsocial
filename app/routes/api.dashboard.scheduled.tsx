import type { LoaderFunctionArgs } from "@remix-run/node";

import { jsonAction, jsonLoader } from "~/lib/remix/json-response.server";
import {
  action as scheduledAction,
  loadScheduledValidated,
} from "~/routes/dashboard.scheduled";

export const loader = jsonLoader(({ request, params }: LoaderFunctionArgs) =>
  loadScheduledValidated(request, params)
);
export const action = jsonAction(scheduledAction);
