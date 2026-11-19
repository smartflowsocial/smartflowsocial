/**
 * Selects the Nostr publishing backend at boot.
 *
 * Unset selects the in-process publisher. `NOSTR_PUBLISHER_BACKEND=http` is
 * the explicit legacy adapter. A publisher URL without that setting is
 * ambiguous and refuses to boot, so an existing HTTP deployment is not
 * silently moved onto direct relay connections.
 */

export type NostrPublisherBackend = "http" | "internal";

export type PublisherBackendDecision =
  { ok: true; backend: NostrPublisherBackend } | { ok: false; reason: string };

export function resolveNostrPublisherBackend(input: {
  configured: string | undefined;
  publisherUrl?: string | undefined;
}): PublisherBackendDecision {
  const configured = input.configured?.trim() ?? "";
  if (configured !== "") {
    const normalized = configured.toLowerCase();
    if (normalized === "http" || normalized === "internal") {
      return { ok: true, backend: normalized };
    }
    return {
      ok: false,
      reason:
        'must be "http" or "internal". Unset selects the internal publisher. Set "http" to use NOSTR_PUBLISHER_URL.',
    };
  }
  if ((input.publisherUrl?.trim() ?? "") !== "") {
    return {
      ok: false,
      reason:
        "NOSTR_PUBLISHER_URL is set but NOSTR_PUBLISHER_BACKEND is unset. Set NOSTR_PUBLISHER_BACKEND=http to keep the HTTP adapter, or unset NOSTR_PUBLISHER_URL to publish from this process.",
    };
  }
  return { ok: true, backend: "internal" };
}
