/**
 * Server-only loader for Admin Overview tab.
 */

import { data as routeData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import {
  defaultRangeForAdminPath,
  parseRangePreset,
} from "~/features/admin/metrics/date-range";
import { getAdminOverviewPageData } from "~/features/admin/repositories/admin-overview-queries.server";
import { requireUser } from "~/features/auth/auth.server";
import { isReferralAdmin } from "~/features/referral/referral-admin.server";

export type AdminOverviewIndexLoaderSuccess = Awaited<
  ReturnType<typeof getAdminOverviewPageData>
>;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  if (!isReferralAdmin(user.npub)) {
    return routeData({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const preset = parseRangePreset(
    url.searchParams.get("range"),
    defaultRangeForAdminPath(url.pathname)
  );

  const data = await getAdminOverviewPageData(preset);
  return data satisfies AdminOverviewIndexLoaderSuccess;
}
