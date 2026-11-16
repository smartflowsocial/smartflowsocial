import type { LoaderFunctionArgs } from "@remix-run/node";

import { jsonAction, jsonLoader } from "~/lib/remix/json-response.server";
import {
  action as calendarAction,
  loadCalendarRange,
  loadCalendarValidated,
} from "~/routes/dashboard.calendar";

export const loader = jsonLoader(({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.has("from") || url.searchParams.has("to")) {
    return loadCalendarRange(request, params);
  }
  return loadCalendarValidated(request, params);
});
export const action = jsonAction(calendarAction);
