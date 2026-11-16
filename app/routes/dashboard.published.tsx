import { Suspense } from "react";
import { type LoaderFunctionArgs } from "react-router";
import { Await, useLoaderData } from "react-router";

import { DeferredRouteAwaitError } from "~/components/deferred-route/DeferredRouteAwaitError";
import { PublishedPostsPage } from "~/features/posts/publishing";
import { PublishedPostsPageSkeleton } from "~/features/posts/publishing/PublishedPostsPageSkeleton";
import type { LongFormPostType as _LongFormPostType } from "~/features/posts/server";
import { DeferredRouteLoaderProvider } from "~/lib/remix/deferred-route-loader-context";
import type { PublishedPostsLoaderData } from "~/lib/validation/schemas/loader-responses.schemas";

import { loadPublishedData } from "./dashboard.published.loader.server";

export { publishedPostsAction as action } from "~/features/posts/published.action.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const p = params as { queueType?: string };

    return {
      published: loadPublishedData(request, p),
    };
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const { handleLoaderError } = await import("~/lib/error-handler.server");
    return handleLoaderError(error, {});
  }
}

function normalizePublishedSearch(url: URL): string {
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
  const isPublishedAction =
    typeof args.formAction === "string" &&
    args.formAction.includes("/dashboard/published");

  if (isPublishedAction) {
    return true;
  }

  if (args.currentUrl.pathname !== args.nextUrl.pathname) {
    return args.defaultShouldRevalidate;
  }

  // Skip revalidation when only client-only params changed.
  if (
    normalizePublishedSearch(args.currentUrl) ===
    normalizePublishedSearch(args.nextUrl)
  ) {
    return false;
  }

  return args.defaultShouldRevalidate;
}

interface PublishedDeferredLoaderData {
  published: Promise<PublishedPostsLoaderData>;
}

function PublishedFeedRoute() {
  const { published } = useLoaderData<PublishedDeferredLoaderData>();

  return (
    <Suspense fallback={<PublishedPostsPageSkeleton />}>
      <Await
        resolve={published}
        errorElement={
          <DeferredRouteAwaitError retryTo="/dashboard/published" />
        }
      >
        {(data) => (
          <DeferredRouteLoaderProvider value={data}>
            <PublishedPostsPage />
          </DeferredRouteLoaderProvider>
        )}
      </Await>
    </Suspense>
  );
}

export default PublishedFeedRoute;
