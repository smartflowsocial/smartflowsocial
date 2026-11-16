import { data as routeData, type LoaderFunctionArgs } from "react-router";

import { requireUserId } from "~/features/auth/auth.server";
import { requireAnySubscription } from "~/features/payments";
import { parseCalendarPastRangeSearch } from "~/features/posts/calendar/calendar-past-range";
import {
  loadCalendarData,
  loadCalendarPublishedRange,
} from "~/features/posts/server/calendar";
import { validateLoaderResponse } from "~/lib/validation/loader-responses.server";
import {
  calendarLoaderDataSchema,
  calendarPastRangeLoaderDataSchema,
  type CalendarLoaderData,
} from "~/lib/validation/schemas/loader-responses.schemas";

export async function loadCalendarValidated(
  request: Request,
  params: LoaderFunctionArgs["params"]
): Promise<CalendarLoaderData> {
  const userId = await requireUserId(request);
  await requireAnySubscription(userId);

  const url = new URL(request.url);
  const queueType =
    params["queueType"] ?? url.searchParams.get("queueType") ?? "all";

  const data = await loadCalendarData(userId, queueType);
  return validateLoaderResponse(data, calendarLoaderDataSchema);
}

export async function loadCalendarRange(
  request: Request,
  params: LoaderFunctionArgs["params"]
) {
  const url = new URL(request.url);
  const search = new URLSearchParams(url.searchParams);
  if (!search.has("pastRange")) search.set("pastRange", "1");
  const parsedRange = parseCalendarPastRangeSearch(search);
  const userId = await requireUserId(request);
  await requireAnySubscription(userId);
  if (parsedRange.kind !== "range") {
    return routeData(
      { ok: false, error: "Invalid calendar range" },
      { status: 400 }
    );
  }
  const queueType =
    params["queueType"] ?? url.searchParams.get("queueType") ?? "all";
  const data = await loadCalendarPublishedRange(
    userId,
    queueType,
    parsedRange.start,
    parsedRange.end
  );
  return validateLoaderResponse(
    {
      pastPosts: data.pastPosts,
      pastLongFormPosts: data.pastLongFormPosts,
      from: parsedRange.start.toISOString(),
      to: parsedRange.end.toISOString(),
    },
    calendarPastRangeLoaderDataSchema
  );
}
