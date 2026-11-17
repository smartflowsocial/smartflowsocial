import { Suspense } from "react";
import { type LoaderFunctionArgs } from "react-router";
import { Await, useLoaderData } from "react-router";

import { requireUserId } from "~/features/auth/auth.server";
import {
  ENGAGEMENT_FEED_PAGE_SIZE,
  ENGAGEMENT_LOADER_FALLBACK,
  EngagementFeedAwaitError,
  EngagementFeedPage,
  EngagementFeedSkeleton,
  EngagementResolvedLoaderProvider,
} from "~/features/engagement";
import { requireAnySubscription } from "~/features/payments";
import { logError } from "~/lib/error-logger.server";
import type { EngagementLoaderData } from "~/lib/validation/schemas/loader-responses.schemas";

import { loadEngagementValidatedOrThrow } from "./dashboard.engagement.loader.server";

async function loaderImpl({ request, url }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  await requireAnySubscription(userId);

  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit = ENGAGEMENT_FEED_PAGE_SIZE;

  const engagementPromise = (async (): Promise<EngagementLoaderData> => {
    try {
      return await loadEngagementValidatedOrThrow(userId, page, limit);
    } catch (error: unknown) {
      logError(error instanceof Error ? error : new Error(String(error)), {
        message:
          "Engagement feed deferred load failed; returning empty fallback",
        userId,
      });
      return ENGAGEMENT_LOADER_FALLBACK;
    }
  })();

  return {
    engagement: engagementPromise,
  };
}

export const loader = async (args: LoaderFunctionArgs) => {
  try {
    return await loaderImpl(args);
  } catch (error) {
    const { handleLoaderError } = await import("~/lib/error-handler.server");
    return handleLoaderError(error, ENGAGEMENT_LOADER_FALLBACK);
  }
};

interface EngagementFeedDeferredLoaderData {
  engagement: Promise<EngagementLoaderData>;
}

export default function EngagementFeedRoute() {
  const { engagement } = useLoaderData<EngagementFeedDeferredLoaderData>();

  return (
    <Suspense fallback={<EngagementFeedSkeleton />}>
      <Await resolve={engagement} errorElement={<EngagementFeedAwaitError />}>
        {(data) => (
          <EngagementResolvedLoaderProvider value={data}>
            <EngagementFeedPage />
          </EngagementResolvedLoaderProvider>
        )}
      </Await>
    </Suspense>
  );
}
