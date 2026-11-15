import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";

import { logout, requireUserId } from "~/features/auth";
import {
  deletionRequestIsConfirmed,
  deleteAccountData,
} from "~/features/user/data/account-data.server";
import { withCSRFProtection } from "~/lib/csrf";

export const action = withCSRFProtection(
  async ({ request }: ActionFunctionArgs) => {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405 });
    }
    const userId = await requireUserId(request);
    const form = await request.formData();
    const confirm = form.get("confirm");
    const acknowledgeRelays = form.get("acknowledgeRelays");
    if (
      !deletionRequestIsConfirmed({
        confirm: typeof confirm === "string" ? confirm : null,
        acknowledgeRelays:
          typeof acknowledgeRelays === "string" ? acknowledgeRelays : null,
      })
    ) {
      return json(
        {
          error:
            'Type "delete my account" and confirm that relays keep published events.',
        },
        { status: 400 }
      );
    }
    const deleted = await deleteAccountData(userId);
    if (!deleted) {
      return json({ error: "Account not found" }, { status: 404 });
    }
    return logout(request);
  }
);
