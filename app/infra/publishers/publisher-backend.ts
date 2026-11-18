/**
 * Selects the Nostr publishing backend at boot.
 *
 * Hosted installs stay on the HTTP publisher until an operator sets
 * `NOSTR_PUBLISHER_BACKEND=internal`. Self-hosted installs use the internal
 * publisher unless the operator explicitly selects `http`. There is no
 * automatic failover between the two.
 */

export type NostrPublisherBackend = "http" | "internal";

export type PublisherBackendDecision =
  { ok: true; backend: NostrPublisherBackend } | { ok: false; reason: string };

/**
 * Same accepted values as `parseDeploymentMode` in deployment-mode.ts.
 * Duplicated here so environment validation does not import billing code.
 */
function isSelfHostedFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "self-hosted" ||
    normalized === "self_hosted"
  );
}

export function resolveNostrPublisherBackend(input: {
  configured: string | undefined;
  selfHosted: string | undefined;
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
        'must be "http" or "internal". Unset keeps the HTTP publisher on hosted installs and selects the internal publisher when SELF_HOSTED is enabled.',
    };
  }
  if (isSelfHostedFlag(input.selfHosted)) {
    return { ok: true, backend: "internal" };
  }
  return { ok: true, backend: "http" };
}
