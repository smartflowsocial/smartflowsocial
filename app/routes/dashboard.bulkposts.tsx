import { Suspense } from "react";
import { Await, useLoaderData } from "react-router";

import { DeferredRouteAwaitError } from "~/components/deferred-route/DeferredRouteAwaitError";
import { requireUserId } from "~/features/auth/auth.server";
import { requireAnySubscription } from "~/features/payments";
import { getBulkPostsDashboardData } from "~/features/posts/server";
import { BulkPostsPageSkeleton, BulkPostsPage } from "~/features/posts/ui";
import { appUrlFromRequest } from "~/lib/app-url";
import { DeferredRouteLoaderProvider } from "~/lib/remix/deferred-route-loader-context";

export { bulkPostsAction as action } from "~/features/posts/bulkposts.action.server";

async function loadBulkPostsData(request: Request) {
  const userId = await requireUserId(request);
  await requireAnySubscription(userId);
  const url = appUrlFromRequest(request);
  const groupId = url.searchParams.get("groupId");
  return getBulkPostsDashboardData(
    userId,
    groupId && groupId.length > 0 ? groupId : null
  );
}

export async function loader({ request, url }: { request: Request; url: URL }) {
  try {
    const shouldAvoidDeferredFallback =
      url.searchParams.get("bulkScheduled") === "true";

    if (shouldAvoidDeferredFallback) {
      return await loadBulkPostsData(request);
    }
    return {
      bulkPosts: loadBulkPostsData(request),
    };
  } catch (error) {
    const { handleLoaderError } = await import("~/lib/error-handler.server");
    return handleLoaderError(error, {
      tags: [],
      queueTypes: [],
      hashTagPresets: [],
      mode: null,
    });
  }
}

interface BulkPostsDeferredLoaderData {
  bulkPosts: Promise<Awaited<ReturnType<typeof getBulkPostsDashboardData>>>;
}

function BulkPostsFeedRoute() {
  const { bulkPosts } = useLoaderData<BulkPostsDeferredLoaderData>();

  return (
    <Suspense fallback={<BulkPostsPageSkeleton />}>
      <Await
        resolve={bulkPosts}
        errorElement={
          <DeferredRouteAwaitError retryTo="/dashboard/bulkposts" />
        }
      >
        {(data) => (
          <DeferredRouteLoaderProvider value={data}>
            <BulkPostsPage />
          </DeferredRouteLoaderProvider>
        )}
      </Await>
    </Suspense>
  );
}

export default BulkPostsFeedRoute;
