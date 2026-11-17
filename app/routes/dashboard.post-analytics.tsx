import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { loadPostAnalyticsPage } from "~/features/analytics/load-post-analytics.server";
import { PostAnalyticsPage } from "~/features/analytics/PostAnalyticsPage";
import { collectViewerPostAnalytics } from "~/features/analytics/run-sweep.server";
import { requireUserId } from "~/features/auth/auth.server";
import {
  isSubscriptionActiveForGating,
  requireAnySubscription,
} from "~/features/payments";

export async function loader({ request, url }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  await requireAnySubscription(userId);
  const indexUnavailable = await collectViewerPostAnalytics(userId);
  const selected = url.searchParams.get("event")?.trim() ?? "";
  return await loadPostAnalyticsPage({
    userId,
    collectionActive: await isSubscriptionActiveForGating(userId),
    selectedEventId: selected.length > 0 ? selected : null,
    indexUnavailable,
  });
}

export default function DashboardPostAnalyticsRoute() {
  const data = useLoaderData<typeof loader>();
  return <PostAnalyticsPage data={data} />;
}
