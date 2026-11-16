import type { LoaderFunctionArgs } from "react-router";

import { requireUserId } from "~/features/auth/auth.server";
import { requireAnySubscription } from "~/features/payments";
import { loadDraftsData } from "~/features/posts/server/drafts";
import { validateLoaderResponse } from "~/lib/validation/loader-responses.server";
import {
  draftsLoaderDataSchema,
  type DraftsLoaderData,
} from "~/lib/validation/schemas/loader-responses.schemas";

export async function loadDraftsValidated(
  request: Request,
  params: LoaderFunctionArgs["params"]
): Promise<DraftsLoaderData> {
  const userId = await requireUserId(request);
  await requireAnySubscription(userId);

  const url = new URL(request.url);
  const queueType =
    url.searchParams.get("queueType") ?? params["queueType"] ?? "all";
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit = 20;

  const data = await loadDraftsData(userId, queueType, page, limit);
  return validateLoaderResponse(data, draftsLoaderDataSchema);
}
