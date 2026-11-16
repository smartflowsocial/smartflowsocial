import type { LoaderFunctionArgs } from "react-router";

import { jsonAction, jsonLoader } from "~/lib/remix/json-response.server";
import { action as calendarQueueAction } from "~/routes/dashboard.calendar.$queueType";
import { loadCalendarQueueValidated } from "~/routes/dashboard.calendar.queue.loader.server";

export const loader = jsonLoader(({ request, params }: LoaderFunctionArgs) =>
  loadCalendarQueueValidated(request, params)
);
export const action = jsonAction(calendarQueueAction);
