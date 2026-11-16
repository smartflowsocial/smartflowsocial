import type { LoaderFunctionArgs } from "react-router";

import { requireUserId } from "~/features/auth/auth.server";
import { loadCalendarQueueData } from "~/features/posts/server/calendar";
import { validateLoaderResponse } from "~/lib/validation/loader-responses.server";
import {
  calendarQueueLoaderDataSchema,
  type CalendarQueueLoaderData,
} from "~/lib/validation/schemas/loader-responses.schemas";

export async function loadCalendarQueueValidated(
  request: Request,
  params: LoaderFunctionArgs["params"]
): Promise<CalendarQueueLoaderData> {
  const userId = await requireUserId(request);
  const queueType = params["queueType"] ?? "all";
  const data = await loadCalendarQueueData(userId, queueType);
  return validateLoaderResponse(data, calendarQueueLoaderDataSchema);
}
