import { Suspense } from "react";
import { type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { Await, useLoaderData } from "react-router";

import { DeferredRouteAwaitError } from "~/components/deferred-route/DeferredRouteAwaitError";
import { requireSession } from "~/features/auth/auth.server";
import { CalendarPage } from "~/features/posts/calendar";
import { parseCalendarPastRangeSearch } from "~/features/posts/calendar/calendar-past-range";
import { CalendarPageSkeleton } from "~/features/posts/calendar/CalendarPageSkeleton";
import { handleCalendarAction } from "~/features/posts/server/calendar";
import { withCSRFProtection } from "~/lib/csrf.server";
import { DeferredRouteLoaderProvider } from "~/lib/remix/deferred-route-loader-context";
import type { CalendarLoaderData } from "~/lib/validation/schemas/loader-responses.schemas";

import {
  loadCalendarRange,
  loadCalendarValidated,
} from "./dashboard.calendar.loader.server";

export async function loader({ request, url, params }: LoaderFunctionArgs) {
  try {
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
