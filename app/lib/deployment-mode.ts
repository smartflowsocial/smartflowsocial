/**
 * Deployment mode for this process.
 *
 * Self-hosted is the install default, including a production build.
 * `NODE_ENV=production` does not select hosted commercial policy.
 * Managed SmartFlowSocial sets `SFS_DEPLOYMENT_MODE=hosted`.
 *
 * A cookie, header, query parameter, or account field is not an input.
 * `SELF_HOSTED` is not read. A non-empty value refuses to boot.
 */

const SELF_HOSTED_MODE = "self-hosted" as const;

export type DeploymentMode = "hosted" | typeof SELF_HOSTED_MODE;

export class DeploymentModeError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "DeploymentModeError";
  }
}

export type DeploymentModeDecision =
  | { ok: true; mode: DeploymentMode; source: "explicit" | "default" }
  | { ok: false; reason: string };

type FlagReading = DeploymentMode | "unset" | "invalid";

const MANAGED_SERVICE_HOSTS = new Set([
  "app.smartflow.social",
  "staging.smartflow.social",
]);

function normalizedFlag(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function classifyDeploymentMode(value: string | undefined): FlagReading {
  const normalized = normalizedFlag(value);
  if (normalized === "") return "unset";
  if (normalized === "self_hosted" || normalized === SELF_HOSTED_MODE) {
    return SELF_HOSTED_MODE;
  }
  if (normalized === "hosted") return "hosted";
  return "invalid";
}

function configuredHost(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const host = new URL(candidate).hostname.toLowerCase();
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

function managedServiceHost(
  source: Record<string, string | undefined>
): string | null {
  for (const key of ["APP_URL", "COOLIFY_URL"]) {
    const host = configuredHost(source[key]);
    if (host !== null && MANAGED_SERVICE_HOSTS.has(host)) return host;
  }
  return null;
}

/**
 * An explicit `SFS_DEPLOYMENT_MODE` is kept. Unset is self-hosted.
 * The known managed hosts refuse every mode except `hosted`.
 */
export function resolveDeploymentMode(
  source: Record<string, string | undefined>
): DeploymentModeDecision {
  if (normalizedFlag(source["SELF_HOSTED"]) !== "") {
    return {
      ok: false,
      reason:
        "SELF_HOSTED is no longer supported. Remove it and set SFS_DEPLOYMENT_MODE=self_hosted or SFS_DEPLOYMENT_MODE=hosted.",
    };
  }
  const fromMode = classifyDeploymentMode(source["SFS_DEPLOYMENT_MODE"]);
  if (fromMode === "invalid") {
    return {
      ok: false,
      reason: 'SFS_DEPLOYMENT_MODE must be "self_hosted" or "hosted".',
    };
  }
  const mode = fromMode === "unset" ? SELF_HOSTED_MODE : fromMode;
  const managedHost = managedServiceHost(source);
  if (managedHost !== null && mode !== "hosted") {
    return {
      ok: false,
      reason: `APP_URL or COOLIFY_URL is ${managedHost}. That managed deployment must set SFS_DEPLOYMENT_MODE=hosted. Self-hosted commercial policy is refused there.`,
    };
  }
  return {
    ok: true,
    mode,
    source: fromMode === "unset" ? "default" : "explicit",
  };
}

/**
 * Parse an explicit `SFS_DEPLOYMENT_MODE` value. Unset and unrecognized
 * values throw. The install default lives in `resolveDeploymentMode`.
 */
export function parseDeploymentMode(value: string | undefined): DeploymentMode {
  const flag = classifyDeploymentMode(value);
  if (flag === SELF_HOSTED_MODE || flag === "hosted") return flag;
  throw new DeploymentModeError(
    flag === "unset"
      ? "SFS_DEPLOYMENT_MODE is unset. resolveDeploymentMode chooses the install default."
      : 'SFS_DEPLOYMENT_MODE must be "self_hosted" or "hosted".'
  );
}
