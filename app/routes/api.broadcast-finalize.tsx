import type { ActionFunctionArgs } from "react-router";

import { requireSession } from "~/features/auth/auth.server";
import {
  BroadcastActionError,
  finalizeBroadcastCampaign,
} from "~/features/broadcast/broadcast-actions.server";
import { finalizeBroadcastSchema } from "~/features/broadcast/broadcast-types";
import { withCSRFProtection } from "~/lib/csrf.server";
import { jsonResponse } from "~/lib/http/json-response";

export const action = withCSRFProtection(
  async ({ request }: ActionFunctionArgs) => {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, { status: 405 });
    }

    const session = await requireSession(request);

    let bodyRaw: unknown;
    try {
      bodyRaw = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, { status: 400 });
    }

    const parsed = finalizeBroadcastSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return jsonResponse(
        {
          error: "Validation failed",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    try {
      const result = await finalizeBroadcastCampaign(
        session.userId,
        session.pubkey,
        parsed.data
      );
      return jsonResponse({ success: true as const, ...result });
    } catch (error) {
      if (error instanceof BroadcastActionError) {
        return jsonResponse(
          { error: error.message, code: error.code },
          { status: 400 }
        );
      }
      throw error;
    }
  }
);
