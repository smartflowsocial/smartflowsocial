import type { LoaderFunctionArgs } from "react-router";

import { requireUserId } from "~/features/auth/auth.server";
import { requireAnySubscription } from "~/features/payments";
import { SCHEDULED_DATE_RANGE_QUERY_LIMIT } from "~/features/posts/deferred-loader-limits";
import { loadScheduledData } from "~/features/posts/server/scheduling";
import { validateLoaderResponse } from "~/lib/validation/loader-responses.server";
import {
  scheduledPostsLoaderDataSchema,
  type ScheduledPostsLoaderData,
} from "~/lib/validation/schemas/loader-responses.schemas";

export async function loadScheduledValidated(
  request: Request,
  params: LoaderFunctionArgs["params"]
): Promise<ScheduledPostsLoaderData> {
  const userId = await requireUserId(request);
  await requireAnySubscription(userId);

  const url = new URL(request.url);
  const queueType =
    params["queueType"] ?? url.searchParams.get("queueType") ?? "all";
  const dateFrom = url.searchParams.get("dateFrom") ?? undefined;
  const dateTo = url.searchParams.get("dateTo") ?? undefined;
  const hasDateRange = Boolean(dateFrom ?? dateTo);
  const page = hasDateRange
    ? 1
    : parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit = hasDateRange ? SCHEDULED_DATE_RANGE_QUERY_LIMIT : 20;

  const data = await loadScheduledData(
    userId,
    queueType,
    page,
    limit,
    dateFrom,
    dateTo
  );

  const outData = hasDateRange
    ? {
        ...data,
        pagination: { ...data.pagination, pages: 1 },
        longformPagination: { ...data.longformPagination, pages: 1 },
      }
    : data;

  return validateLoaderResponse(outData, scheduledPostsLoaderDataSchema);
}
