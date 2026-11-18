/**
 * Reading a publish result.
 *
 * These live apart from the publisher module so a test that replaces the
 * publisher still gets the real answers here.
 */

import type { RelayPublishResult } from "./nostr-publisher.server";

export function allRelaysRejected(results: RelayPublishResult[]): boolean {
  return results.length > 0 && results.every((result) => !result.ok);
}

export function relayPublishFailureMessage(
  results: RelayPublishResult[]
): string {
  const detail = results
    .map((result) => result.error)
    .filter((error): error is string => Boolean(error))
    .slice(0, 3)
    .join("; ");
  return detail
    ? `Publish failed on all relays: ${detail}`
    : "Publish failed on all relays: no relay accepted the event. Check Network settings and try again.";
}
