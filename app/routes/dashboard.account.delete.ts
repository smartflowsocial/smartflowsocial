import type { ActionFunctionArgs } from "react-router";

import { logout, requireUserId } from "~/features/auth/auth.server";
import {
  deletionRequestIsConfirmed,
  deleteAccountData,
} from "~/features/user/data/account-data.server";
import {
  planUnsharedOwnedObjects,
  processDueOwnedObjectDeletions,
} from "~/features/user/data/account-object-cleanup.server";
import { withCSRFProtection } from "~/lib/csrf.server";
import { logError } from "~/lib/error-logger.server";
import { jsonResponse } from "~/lib/http/json-response";

export const action = withCSRFProtection(
  async ({ request }: ActionFunctionArgs) => {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, { status: 405 });
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
      return jsonResponse(
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
    } catch {
      logError(
        new Error("Account deletion stopped before removing the account"),
        {
          message: "Could not inspect stored media.",
        }
      );
      return jsonResponse(
        {
          error: "Could not inspect stored media. The account was not deleted.",
        },
        { status: 500 }
      );
    }
    let deleted = false;
    try {
      deleted = await deleteAccountData(userId, {
        ownedObjectKeys: objectPlan.deleteKeys,
      });
    } catch {
      logError(new Error("Account deletion rolled back"), {
        message: "The account row and queued object deletions were not kept.",
      });
      return jsonResponse(
        {
          error: "Could not delete the account. Nothing was removed.",
        },
        { status: 500 }
      );
    }
    if (!deleted) {
      return jsonResponse({ error: "Account not found" }, { status: 404 });
    }
    try {
      const sweep = await processDueOwnedObjectDeletions({
        accountId: userId,
      });
      if (sweep.retrying + sweep.failed + sweep.rejected > 0) {
        logError(new Error("Owned object deletion needs another attempt"), {
          message: "Queued keys remain until storage accepts the delete.",
          retrying: sweep.retrying,
          failed: sweep.failed,
          rejected: sweep.rejected,
        });
      }
    } catch {
      logError(new Error("Owned object deletion sweep failed"), {
        message:
          "The account was removed. Queued object keys remain for the worker.",
      });
    }
    return logout(request);
  }
);
