import type { LoaderFunctionArgs } from "react-router";

import { jsonAction, jsonLoader } from "~/lib/remix/json-response.server";
import { action as draftsAction } from "~/routes/dashboard.drafts";
import { loadDraftsValidated } from "~/routes/dashboard.drafts.loader.server";

export const loader = jsonLoader(({ request, params }: LoaderFunctionArgs) =>
  loadDraftsValidated(request, params)
);
export const action = jsonAction(draftsAction);
