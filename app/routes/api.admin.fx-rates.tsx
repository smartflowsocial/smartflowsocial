import { type LoaderFunctionArgs, data } from "react-router";

import { getAdminBtcSpotRates } from "~/features/admin/admin-fx-rates.server";
import { requireUser } from "~/features/auth/auth.server";
import { isReferralAdmin } from "~/features/referral/referral-admin.server";

/**
 * GET /api/admin/fx-rates  -  Kraken XBTUSDC + XBTEUR last trade (referral admins only).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method !== "GET") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }
  const user = await requireUser(request);
  if (!isReferralAdmin(user.npub)) {
    return data({ error: "Forbidden" }, { status: 403 });
  }
  try {
    return await getAdminBtcSpotRates();
  } catch {
    return data({ error: "rates_unavailable" }, { status: 503 });
  }
}

export default function AdminFxRatesResource() {
  return null;
}
