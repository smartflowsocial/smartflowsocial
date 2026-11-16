import type { LoaderFunctionArgs } from "react-router";

import { jsonAction, jsonLoader } from "~/lib/remix/json-response.server";
import { action as publishedAction } from "~/routes/dashboard.published";
import { loadPublishedData } from "~/routes/dashboard.published.loader.server";

export const loader = jsonLoader(({ request, params }: LoaderFunctionArgs) =>
  loadPublishedData(request, params)
);
export const action = jsonAction(publishedAction);
