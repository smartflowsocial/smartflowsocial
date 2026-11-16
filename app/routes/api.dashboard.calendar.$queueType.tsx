import type { LoaderFunctionArgs } from "@remix-run/node";

import { jsonAction, jsonLoader } from "~/lib/remix/json-response.server";
import {
  action as calendarQueueAction,
  loadCalendarQueueValidated,
} from "~/routes/dashboard.calendar.$queueType";

export const loader = jsonLoader(({ request, params }: LoaderFunctionArgs) =>
  loadCalendarQueueValidated(request, params)
);
export const action = jsonAction(calendarQueueAction);
