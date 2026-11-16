import type { ActionFunctionArgs } from "react-router";

import { requireUserId } from "~/features/auth/auth.server";
import { upsertPushSubscription } from "~/features/notifications";
import { getVapidPublicKey } from "~/infra/notifications/web-push-config.server";
import { jsonResponse } from "~/lib/http/json-response";

/**
 * GET /api/push-subscribe - Get VAPID public key
 */
export async function loader() {
  try {
    // Ensure web push is initialized
    const { initWebPush } =
      await import("~/infra/notifications/web-push-config.server");
    initWebPush();

    const publicKey = getVapidPublicKey();
    if (!publicKey) {
      return jsonResponse(
        {
          error:
            "Push notifications not configured. Please set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables.",
        },
        { status: 503 }
      );
    }
    return jsonResponse({ publicKey });
  } catch (error) {
    const { logError } = await import("~/lib/error-logger.server");
    logError(error instanceof Error ? error : new Error(String(error)), {
      message: "Failed to get VAPID public key",
    });
    return jsonResponse(
      {
        error:
          "Failed to initialize push notifications. Please check server configuration.",
      },
      { status: 503 }
    );
  }
}

/**
 * POST /api/push-subscribe - Subscribe to push notifications
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const userId = await requireUserId(request);

    const body = (await request.json()) as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    const { endpoint, keys } = body;

    if (!endpoint || !keys?.p256dh || !keys.auth) {
      return jsonResponse(
        { error: "Missing required fields: endpoint, keys.p256dh, keys.auth" },
        { status: 400 }
      );
    }

    await upsertPushSubscription({
      userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    });

    return jsonResponse({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    const { handleActionError } = await import("~/lib/error-handler.server");
    return handleActionError(error);
  }
}
