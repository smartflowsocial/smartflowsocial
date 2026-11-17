import type { LoaderFunctionArgs } from "react-router";

import { requireUserId } from "~/features/auth/auth.server";
import { requireAnySubscription } from "~/features/payments";
import { getRecyclableDashboardData } from "~/features/posts/server/publishing";
import { appUrlFromRequest } from "~/lib/app-url";
import { validateLoaderResponse } from "~/lib/validation/loader-responses.server";
import {
  recyclablesLoaderDataSchema,
  type RecyclablesLoaderData,
} from "~/lib/validation/schemas/loader-responses.schemas";

export async function loadRecyclablesValidated(
  request: Request,
  params: LoaderFunctionArgs["params"]
): Promise<RecyclablesLoaderData> {
  const userId = await requireUserId(request);
  await requireAnySubscription(userId);

  const url = appUrlFromRequest(request);
  const data = await getRecyclableDashboardData({ userId, params, url });
  return validateLoaderResponse(data, recyclablesLoaderDataSchema);
}
