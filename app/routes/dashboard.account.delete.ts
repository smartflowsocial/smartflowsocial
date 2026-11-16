import type { ActionFunctionArgs } from "@remix-run/node";

import { logout, requireUserId } from "~/features/auth";
import {
  deletionRequestIsConfirmed,
  deleteAccountData,
} from "~/features/user/data/account-data.server";
import {
  deletePlannedAccountObjects,
  planUnsharedOwnedObjects,
} from "~/features/user/data/account-object-cleanup.server";
import { withCSRFProtection } from "~/lib/csrf";
import { logError } from "~/lib/error-logger.server";

export const action = withCSRFProtection(
  async ({ request }: ActionFunctionArgs) => {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
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
      return Response.json(
        {
          error:
            'Type "delete my account" and confirm that relays keep published events.',
        },
        { status: 400 }
      );
    }
    let objectPlan: Awaited<ReturnType<typeof planUnsharedOwnedObjects>>;
    try {
      objectPlan = await planUnsharedOwnedObjects(userId);
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), {
        message: "Account deletion stopped before removing the account",
        userId,
      });
      return Response.json(
        {
          error: "Could not inspect stored media. The account was not deleted.",
        },
        { status: 500 }
      );
    }
    const deleted = await deleteAccountData(userId);
    if (!deleted) {
      return Response.json({ error: "Account not found" }, { status: 404 });
    }
    try {
      await deletePlannedAccountObjects(userId, objectPlan);
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), {
        message:
          "Account was deleted. Some owned objects could not be removed.",
        userId,
      });
    }
    return logout(request);
  }
);
