import type { LoaderFunctionArgs } from "@remix-run/node";

import { jsonAction, jsonLoader } from "~/lib/remix/json-response.server";
import {
  action as publishedAction,
  loadPublishedData,
} from "~/routes/dashboard.published";

export const loader = jsonLoader(({ request, params }: LoaderFunctionArgs) =>
  loadPublishedData(request, params)
);
export const action = jsonAction(publishedAction);
