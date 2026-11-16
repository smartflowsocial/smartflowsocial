import type { LoaderFunctionArgs } from "react-router";

import { jsonAction, jsonLoader } from "~/lib/remix/json-response.server";
import { action as calendarAction } from "~/routes/dashboard.calendar";
import {
  loadCalendarRange,
  loadCalendarValidated,
} from "~/routes/dashboard.calendar.loader.server";

export const loader = jsonLoader(({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.has("from") || url.searchParams.has("to")) {
    return loadCalendarRange(request, params);
  }
  return loadCalendarValidated(request, params);
});
export const action = jsonAction(calendarAction);
