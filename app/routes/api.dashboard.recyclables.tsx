import type { LoaderFunctionArgs } from "@remix-run/node";

import { jsonAction, jsonLoader } from "~/lib/remix/json-response.server";
import {
  action as recyclablesAction,
  loadRecyclablesValidated,
} from "~/routes/dashboard.recyclables";

export const loader = jsonLoader(({ request, params }: LoaderFunctionArgs) =>
  loadRecyclablesValidated(request, params)
);
export const action = jsonAction(recyclablesAction);
