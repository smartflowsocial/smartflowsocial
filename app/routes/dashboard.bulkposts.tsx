import { Await, useLoaderData } from "@remix-run/react";
import { Suspense } from "react";

import { DeferredRouteAwaitError } from "~/components/deferred-route/DeferredRouteAwaitError";
import { requireUserId } from "~/features/auth";
import { requireAnySubscription } from "~/features/payments";
import { getBulkPostsDashboardData } from "~/features/posts/server";
import { BulkPostsPageSkeleton, BulkPostsPage } from "~/features/posts/ui";
import { DeferredRouteLoaderProvider } from "~/lib/remix/deferred-route-loader-context";

export { bulkPostsAction as action } from "~/features/posts/bulkposts.action.server";

async function loadBulkPostsData(request: Request) {
  const userId = await requireUserId(request);
  await requireAnySubscription(userId);
  const url = new URL(request.url);
  const groupId = url.searchParams.get("groupId");
  return getBulkPostsDashboardData(
    userId,
    groupId && groupId.length > 0 ? groupId : null
  );
}

export async function loader({ request }: { request: Request }) {
  try {
    const url = new URL(request.url);
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
