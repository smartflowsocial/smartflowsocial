/**
 * Web Push Configuration
 * Handles VAPID key generation and configuration
 */

import webpush from "web-push";

import { env } from "~/lib/env.server";

/**
 * Initialize web push with VAPID keys from environment
 */
export function initWebPush(): void {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject =
    env.VAPID_SUBJECT ?? env.APP_URL ?? "mailto:admin@smartflow.social";

  if (!publicKey || !privateKey) {
    // Init-time config warning before full logger; acceptable per logging policy
    console.warn(
      "Web Push: VAPID keys not configured. Push notifications will be disabled."
    );
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
}

/**
 * Get VAPID public key for client subscription
 */
export function getVapidPublicKey(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null;
}
