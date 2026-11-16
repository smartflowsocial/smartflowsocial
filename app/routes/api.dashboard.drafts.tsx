import type { LoaderFunctionArgs } from "@remix-run/node";

import { jsonAction, jsonLoader } from "~/lib/remix/json-response.server";
import {
  action as draftsAction,
  loadDraftsValidated,
} from "~/routes/dashboard.drafts";

export const loader = jsonLoader(({ request, params }: LoaderFunctionArgs) =>
  loadDraftsValidated(request, params)
);
export const action = jsonAction(draftsAction);
