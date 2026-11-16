import { Suspense } from "react";
import { type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { Await, useLoaderData } from "react-router";

import { DeferredRouteAwaitError } from "~/components/deferred-route/DeferredRouteAwaitError";
import { requireUserId } from "~/features/auth/auth.server";
import { RecyclablesPage } from "~/features/posts/publishing";
import { RecyclablesPageSkeleton } from "~/features/posts/publishing/RecyclablesPageSkeleton";
import { handleRecyclablePostAction } from "~/features/posts/server/publishing";
import { withCSRFProtection } from "~/lib/csrf.server";
import { DeferredRouteLoaderProvider } from "~/lib/remix/deferred-route-loader-context";
import type { RecyclablesLoaderData } from "~/lib/validation/schemas/loader-responses.schemas";

import { loadRecyclablesValidated } from "./dashboard.recyclables.loader.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    return {
      recyclables: loadRecyclablesValidated(request, params),
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
      const userId = await requireUserId(request);
      const formData = await request.formData();
      return await handleRecyclablePostAction(formData, userId);
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }
      const { handleActionError } = await import("~/lib/error-handler.server");
      return handleActionError(error);
    }
  }
);

interface RecyclablesDeferredLoaderData {
  recyclables: Promise<RecyclablesLoaderData>;
}

function RecyclablesFeedRoute() {
  const { recyclables } = useLoaderData<RecyclablesDeferredLoaderData>();

  return (
    <Suspense fallback={<RecyclablesPageSkeleton />}>
      <Await
        resolve={recyclables}
        errorElement={
          <DeferredRouteAwaitError retryTo="/dashboard/recyclables" />
        }
      >
        {(data) => (
          <DeferredRouteLoaderProvider value={data}>
            <RecyclablesPage />
          </DeferredRouteLoaderProvider>
        )}
      </Await>
    </Suspense>
  );
}

export default RecyclablesFeedRoute;
