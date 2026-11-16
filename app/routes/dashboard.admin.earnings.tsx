import { redirect, type LoaderFunctionArgs } from "react-router";

import { appUrlFromRequest } from "~/lib/app-url";

/**
 * Legacy URL: earnings admin merged into Referrals tab.
 */
export function loader({ request }: LoaderFunctionArgs) {
  const u = appUrlFromRequest(request);
  u.pathname = "/dashboard/admin/referrals";
  if (!u.searchParams.has("section")) {
    u.searchParams.set("section", "ledger");
  }
  return redirect(u.toString());
}

export default function AdminEarningsRedirect() {
  return null;
}
