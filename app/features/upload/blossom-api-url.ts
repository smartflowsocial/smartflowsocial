/**
 * The Blossom API base is operator configuration. There is no hosted default.
 * Selecting SmartFlowSocial's server means setting BLOSSOM_SFS_API_URL to it.
 */

export class BlossomApiNotConfiguredError extends Error {
  readonly code = "blossom_api_not_configured";

  constructor(
    message = "BLOSSOM_SFS_API_URL is not set. This server does not contact a Blossom host until an operator sets that URL."
  ) {
    super(message);
    this.name = "BlossomApiNotConfiguredError";
  }
}

export function resolveBlossomApiBase(
  configured: string | null | undefined
): string {
  const trimmed = configured?.trim() ?? "";
  if (!trimmed) {
    throw new BlossomApiNotConfiguredError();
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BlossomApiNotConfiguredError(
      "BLOSSOM_SFS_API_URL must be an absolute http or https URL."
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new BlossomApiNotConfiguredError(
      "BLOSSOM_SFS_API_URL must use http or https."
    );
  }
  if (parsed.username || parsed.password) {
    throw new BlossomApiNotConfiguredError(
      "BLOSSOM_SFS_API_URL must not include credentials."
    );
  }
  const path = parsed.pathname.replace(/\/+$/, "").replace(/\/upload$/i, "");
  return `${parsed.origin}${path === "/" ? "" : path}`;
}
