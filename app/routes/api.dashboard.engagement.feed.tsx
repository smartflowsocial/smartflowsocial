import type { LoaderFunctionArgs } from "@remix-run/node";

import { jsonLoader } from "~/lib/remix/json-response.server";
import { loadEngagementJson } from "~/routes/dashboard.engagement.feed";

export const loader = jsonLoader(({ request }: LoaderFunctionArgs) =>
  loadEngagementJson(request)
);
