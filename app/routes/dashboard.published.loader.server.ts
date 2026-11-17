import { requireUserId } from "~/features/auth/auth.server";
import { requireAnySubscription } from "~/features/payments";
import { getPublishedDashboardData } from "~/features/posts/server/publishing";
import { appUrlFromRequest } from "~/lib/app-url";
import { validateLoaderResponse } from "~/lib/validation/loader-responses.server";
import {
  publishedPostsLoaderDataSchema,
  type PublishedPostsLoaderData,
} from "~/lib/validation/schemas/loader-responses.schemas";

export async function loadPublishedData(
  request: Request,
  params: { queueType?: string }
): Promise<PublishedPostsLoaderData> {
  const userId = await requireUserId(request);
  await requireAnySubscription(userId);
  const url = appUrlFromRequest(request);
  const data = await getPublishedDashboardData({ userId, params, url });
  return validateLoaderResponse(data, publishedPostsLoaderDataSchema);
}
