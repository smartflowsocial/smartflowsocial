import { Suspense } from "react";
import { type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { Await, useLoaderData } from "react-router";

import { DeferredRouteAwaitError } from "~/components/deferred-route/DeferredRouteAwaitError";
import { requireSession } from "~/features/auth/auth.server";
import { CalendarQueuePage } from "~/features/posts/calendar";
import { CalendarQueuePageSkeleton } from "~/features/posts/calendar/CalendarQueuePageSkeleton";
import type {
  UserData as _UserData,
  QueueType as _QueueType,
} from "~/features/posts/server";
import { handleCalendarAction } from "~/features/posts/server/calendar";
import { withCSRFProtection } from "~/lib/csrf.server";
import { DeferredRouteLoaderProvider } from "~/lib/remix/deferred-route-loader-context";
import type { CalendarQueueLoaderData } from "~/lib/validation/schemas/loader-responses.schemas";

import { loadCalendarQueueValidated } from "./dashboard.calendar.queue.loader.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    return {
      calendarQueue: loadCalendarQueueValidated(request, params),
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

interface CalendarQueueDeferredLoaderData {
  calendarQueue: Promise<CalendarQueueLoaderData>;
}

function CalendarQueueFeedRoute() {
  const { calendarQueue } = useLoaderData<CalendarQueueDeferredLoaderData>();

  return (
    <Suspense fallback={<CalendarQueuePageSkeleton />}>
      <Await
        resolve={calendarQueue}
        errorElement={<DeferredRouteAwaitError retryTo="/dashboard/calendar" />}
      >
        {(data) => (
          <DeferredRouteLoaderProvider value={data}>
            <CalendarQueuePage />
          </DeferredRouteLoaderProvider>
        )}
      </Await>
    </Suspense>
  );
}

export default CalendarQueueFeedRoute;
