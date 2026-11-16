import type { LoaderFunctionArgs } from "react-router";

import { requireUserId } from "~/features/auth/auth.server";
import { jsonAction, jsonLoader } from "~/lib/remix/json-response.server";
import { action as templatesAction } from "~/routes/dashboard.templates";
import { loadTemplatesValidated } from "~/routes/dashboard.templates.loader.server";

export const loader = jsonLoader(async ({ request }: LoaderFunctionArgs) => {
  const userId = await requireUserId(request);
  return loadTemplatesValidated(userId);
});
export const action = jsonAction(templatesAction);
