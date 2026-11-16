import type { LoaderFunctionArgs } from "react-router";

import { jsonAction, jsonLoader } from "~/lib/remix/json-response.server";
import { action as recyclablesAction } from "~/routes/dashboard.recyclables";
import { loadRecyclablesValidated } from "~/routes/dashboard.recyclables.loader.server";

export const loader = jsonLoader(({ request, params }: LoaderFunctionArgs) =>
  loadRecyclablesValidated(request, params)
);
export const action = jsonAction(recyclablesAction);
