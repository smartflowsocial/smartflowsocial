import { randomBytes } from "crypto";

import type { ActionFunctionArgs } from "react-router";

import { issueLoginChallenge } from "~/features/auth/auth.server";
import { withCSRFProtection } from "~/lib/csrf.server";
import { featureFlags } from "~/lib/feature-flags.server";
import { jsonResponse } from "~/lib/http/json-response";

const PURPOSE_LOGIN = "login";
const CHALLENGE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export const action = withCSRFProtection(
  async ({ request }: ActionFunctionArgs) => {
    try {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, { status: 405 });
      }

      if (!featureFlags.nostrAuthV2Enabled) {
        return jsonResponse(
          {
            success: false,
            error: {
              code: "FEATURE_DISABLED",
              message:
                "Nostr auth is disabled on this server (NOSTR_AUTH_V2_ENABLED=false).",
            },
          },
          { status: 404 }
        );
      }

      const nonce = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

      const challenge = await issueLoginChallenge({
        nonce,
        purpose: PURPOSE_LOGIN,
        expiresAt,
      });

      return jsonResponse({
        challengeId: challenge.id,
        nonce: challenge.nonce,
        purpose: challenge.purpose,
        expiresAt: challenge.expiresAt.toISOString(),
      });
    } catch (error) {
      const { handleActionError } = await import("~/lib/error-handler.server");
      return handleActionError(error);
    }
  }
);
