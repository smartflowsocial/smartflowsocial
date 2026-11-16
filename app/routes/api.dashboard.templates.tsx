import type { LoaderFunctionArgs } from "@remix-run/node";

import { requireUserId } from "~/features/auth";
import { jsonAction, jsonLoader } from "~/lib/remix/json-response.server";
import {
  action as templatesAction,
  loadTemplatesValidated,
} from "~/routes/dashboard.templates";

export const loader = jsonLoader(async ({ request }: LoaderFunctionArgs) => {
  const userId = await requireUserId(request);
  return loadTemplatesValidated(userId);
});
export const action = jsonAction(templatesAction);
