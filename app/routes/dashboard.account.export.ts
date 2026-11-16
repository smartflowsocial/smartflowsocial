import type { LoaderFunctionArgs } from "react-router";

import { requireUserId } from "~/features/auth/auth.server";
import { exportAccountData } from "~/features/user/data/account-data.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const data = await exportAccountData(userId);
  if (!data) {
    return new Response("Account not found", { status: 404 });
  }
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="smartflow-account.json"',
      "cache-control": "no-store",
    },
  });
}
