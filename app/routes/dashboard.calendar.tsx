import {
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
  data as routeData,
} from "@remix-run/node";
import { Await, useLoaderData } from "@remix-run/react";
import { Suspense } from "react";

import { DeferredRouteAwaitError } from "~/components/deferred-route/DeferredRouteAwaitError";
import { requireSession, requireUserId } from "~/features/auth";
import { requireAnySubscription } from "~/features/payments";
import { CalendarPage } from "~/features/posts/calendar";
import { parseCalendarPastRangeSearch } from "~/features/posts/calendar/calendar-past-range";
import { CalendarPageSkeleton } from "~/features/posts/calendar/CalendarPageSkeleton";
import {
  handleCalendarAction,
  loadCalendarData,
  loadCalendarPublishedRange,
} from "~/features/posts/server/calendar";
import { withCSRFProtection } from "~/lib/csrf.server";
import { DeferredRouteLoaderProvider } from "~/lib/remix/deferred-route-loader-context";
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

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const url = new URL(request.url);
    const parsedRange = parseCalendarPastRangeSearch(url.searchParams);
    if (parsedRange.kind !== "full") {
      return await loadCalendarRange(request, params);
    }

    return {
      calendar: loadCalendarValidated(request, params),
    };
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const { handleLoaderError } = await import("~/lib/error-handler.server");
    return handleLoaderError(error, {});
  }
}

export const action = withCSRFProtection(
  async ({ request }: ActionFunctionArgs) => {
    try {
      const { userId, pubkey } = await requireSession(request);
      const formData = await request.formData();
      return handleCalendarAction(formData, userId, pubkey);
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }
      const { handleActionError } = await import("~/lib/error-handler.server");
      return handleActionError(error);
    }
  }
);

interface CalendarDeferredLoaderData {
  calendar: Promise<CalendarLoaderData>;
}

function CalendarFeedRoute() {
  const { calendar } = useLoaderData<CalendarDeferredLoaderData>();

  return (
    <Suspense fallback={<CalendarPageSkeleton />}>
      <Await
        resolve={calendar}
        errorElement={<DeferredRouteAwaitError retryTo="/dashboard/calendar" />}
      >
        {(data) => (
          <DeferredRouteLoaderProvider value={data}>
            <CalendarPage />
          </DeferredRouteLoaderProvider>
        )}
      </Await>
    </Suspense>
  );
}

export default CalendarFeedRoute;
