import { requireUserId } from "~/features/auth/auth.server";
import {
  ENGAGEMENT_FEED_PAGE_SIZE,
  loadEngagementFeedData,
} from "~/features/engagement";
import { requireAnySubscription } from "~/features/payments";
import { validateLoaderResponse } from "~/lib/validation/loader-responses.server";
import {
  engagementLoaderDataSchema,
  type EngagementLoaderData,
} from "~/lib/validation/schemas/loader-responses.schemas";

export async function loadEngagementValidatedOrThrow(
  userId: string,
  page: number,
  limit: number
): Promise<EngagementLoaderData> {
  const data = await loadEngagementFeedData(userId, page, limit);
  return validateLoaderResponse(data, engagementLoaderDataSchema);
}

export async function loadEngagementJson(request: Request) {
  const userId = await requireUserId(request);
  await requireAnySubscription(userId);
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  return loadEngagementValidatedOrThrow(
    userId,
    page,
    ENGAGEMENT_FEED_PAGE_SIZE
  );
}
