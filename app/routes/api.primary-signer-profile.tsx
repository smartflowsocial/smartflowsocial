import { type LoaderFunctionArgs } from "react-router";

import { requireUserId } from "~/features/auth/auth.server";
import { getUserPrimarySignerProfile } from "~/features/user";
import { jsonResponse } from "~/lib/http/json-response";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const userId = await requireUserId(request);
    const primarySignerProfile = await getUserPrimarySignerProfile(userId);
    return jsonResponse({ primarySignerProfile });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const { handleLoaderError } = await import("~/lib/error-handler.server");
    return handleLoaderError(error, { primarySignerProfile: null });
  }
}
