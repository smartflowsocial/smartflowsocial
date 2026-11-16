/**
 * CSRF protection for actions. Import this from server code only.
 * `~/lib/csrf` stays free of server imports so the browser build can see it.
 */

import type { ActionFunctionArgs } from "react-router";

import { jsonResponse } from "~/lib/http/json-response";
import { isStateChangingMethod, validateOrigin } from "~/lib/security.server";

/**
 * Wraps action functions with CSRF protection.
 *
 * Validates the Origin/Referer header for state-changing requests
 * (POST, PUT, PATCH, DELETE).
 */
export function withCSRFProtection<T>(
  actionFn: (args: ActionFunctionArgs) => Promise<T>
): (args: ActionFunctionArgs) => Promise<T | Response> {
  return async (args: ActionFunctionArgs) => {
    if (typeof window !== "undefined") {
      throw new Error(
        "withCSRFProtection should never be called on the client"
      );
    }

    const method = args.request.method;

    if (isStateChangingMethod(method)) {
      try {
        validateOrigin(args.request);
      } catch (error) {
        return jsonResponse(
          {
            error: "CSRF validation failed",
            message: error instanceof Error ? error.message : "Invalid origin",
          },
          { status: 403 }
        );
      }
    }

    return actionFn(args);
  };
}
