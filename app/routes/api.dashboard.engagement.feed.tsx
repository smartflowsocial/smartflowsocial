import type { LoaderFunctionArgs } from "react-router";

import { jsonLoader } from "~/lib/remix/json-response.server";
import { loadEngagementJson } from "~/routes/dashboard.engagement.loader.server";

export const loader = jsonLoader(({ request }: LoaderFunctionArgs) =>
  loadEngagementJson(request)
);
