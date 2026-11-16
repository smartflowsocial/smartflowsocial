import { Suspense } from "react";
import { type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { Await, useLoaderData } from "react-router";

import { DeferredRouteAwaitError } from "~/components/deferred-route/DeferredRouteAwaitError";
import { requireUserId } from "~/features/auth/auth.server";
import { ScheduledPostsPage } from "~/features/posts/scheduling";
import { ScheduledPostsPageSkeleton } from "~/features/posts/scheduling/ScheduledPostsPageSkeleton";
import type {
  LongFormPostType as _LongFormPostType,
  UserData as _UserData,
} from "~/features/posts/server";
import { handleScheduledAction } from "~/features/posts/server/scheduling";
import { withCSRFProtection } from "~/lib/csrf.server";
import { DeferredRouteLoaderProvider } from "~/lib/remix/deferred-route-loader-context";
import type { ScheduledPostsLoaderData } from "~/lib/validation/schemas/loader-responses.schemas";

import { loadScheduledValidated } from "./dashboard.scheduled.loader.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    return {
      scheduled: loadScheduledValidated(request, params),
    };
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const { handleLoaderError } = await import("~/lib/error-handler.server");
    return handleLoaderError(error, {});
  }
}

function normalizeScheduledSearch(url: URL): string {
  const params = new URLSearchParams(url.search);
  // ?tab is a client-only content-type filter; the loader never reads it.
  params.delete("tab");
  return params.toString();
}

export function shouldRevalidate(args: {
  currentUrl: URL;
  nextUrl: URL;
  formAction?: string;
  defaultShouldRevalidate: boolean;
}) {
  const isScheduledAction =
    typeof args.formAction === "string" &&
    args.formAction.includes("/dashboard/scheduled");

  if (isScheduledAction) {
    return true;
  }

  if (args.currentUrl.pathname !== args.nextUrl.pathname) {
    return args.defaultShouldRevalidate;
  }

  // Skip revalidation when only client-only params changed.
  if (
    normalizeScheduledSearch(args.currentUrl) ===
    normalizeScheduledSearch(args.nextUrl)
  ) {
    return false;
  }

  return args.defaultShouldRevalidate;
}

export const action = withCSRFProtection(
  async ({ request }: ActionFunctionArgs) => {
    try {
      const userId = await requireUserId(request);
      const formData = await request.formData();
      const result = await handleScheduledAction(formData, userId);

      if (result instanceof Response) {
        return result;
      }

      return result;
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }
      const { handleActionError } = await import("~/lib/error-handler.server");
      return handleActionError(error);
    }
  }
);

interface ScheduledDeferredLoaderData {
  scheduled: Promise<ScheduledPostsLoaderData>;
}

function ScheduledFeedRoute() {
  const { scheduled } = useLoaderData<ScheduledDeferredLoaderData>();

  return (
    <Suspense fallback={<ScheduledPostsPageSkeleton />}>
      <Await
        resolve={scheduled}
        errorElement={
          <DeferredRouteAwaitError retryTo="/dashboard/scheduled" />
        }
      >
        {(data) => (
          <DeferredRouteLoaderProvider value={data}>
            <ScheduledPostsPage />
          </DeferredRouteLoaderProvider>
        )}
      </Await>
    </Suspense>
  );
}

export default ScheduledFeedRoute;
