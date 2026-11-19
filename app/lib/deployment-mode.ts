/**
 * Deployment mode for this process.
 *
 * Self-hosted is the install default. Hosted managed service is an explicit
 * opt-in. Production, and the managed app hosts, refuse to start when the
 * mode is missing so platform commission is never guessed.
 *
 * A cookie, header, or account field is not an input.
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

const EXPLICIT_MODE_REASON =
  "SFS_DEPLOYMENT_MODE is unset. Set SFS_DEPLOYMENT_MODE=hosted to keep managed hosting, or SFS_DEPLOYMENT_MODE=self_hosted for an operator install. SELF_HOSTED=true and SELF_HOSTED=false still select a mode. Production, and a process whose APP_URL or COOLIFY_URL is app.smartflow.social or staging.smartflow.social, will not start without an explicit mode.";

function normalizedFlag(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function classifySelfHosted(value: string | undefined): FlagReading {
  const normalized = normalizedFlag(value);
  if (normalized === "") return "unset";
  if (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === SELF_HOSTED_MODE ||
    normalized === "self_hosted"
  ) {
    return SELF_HOSTED_MODE;
  }
  if (
    normalized === "false" ||
    normalized === "0" ||
    normalized === "no" ||
    normalized === "hosted"
  ) {
    return "hosted";
  }
  return "invalid";
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

function requiresExplicitDeploymentMode(
  source: Record<string, string | undefined>
): boolean {
  if (normalizedFlag(source["NODE_ENV"]) === "production") return true;
  for (const key of ["APP_URL", "COOLIFY_URL"]) {
    const host = configuredHost(source[key]);
    if (host !== null && MANAGED_SERVICE_HOSTS.has(host)) return true;
  }
  return false;
}

/**
 * An explicit `SFS_DEPLOYMENT_MODE` or `SELF_HOSTED` is kept. The two must
 * agree when both are set. A development or test process with neither set is
 * self-hosted. Production and the managed hosts fail closed.
 */
export function resolveDeploymentMode(
  source: Record<string, string | undefined>
): DeploymentModeDecision {
  const fromMode = classifyDeploymentMode(source["SFS_DEPLOYMENT_MODE"]);
  const fromFlag = classifySelfHosted(source["SELF_HOSTED"]);
  if (fromMode === "invalid") {
    return {
      ok: false,
      reason: 'SFS_DEPLOYMENT_MODE must be "self_hosted" or "hosted".',
    };
  }
  if (fromFlag === "invalid") {
    return {
      ok: false,
      reason:
        "SELF_HOSTED must be true, false, 1, 0, yes, no, self_hosted, self-hosted, or hosted. An unrecognized value is not treated as hosted.",
    };
  }
  if (fromMode !== "unset" && fromFlag !== "unset" && fromMode !== fromFlag) {
    return {
      ok: false,
      reason:
        "SFS_DEPLOYMENT_MODE and SELF_HOSTED disagree. Set one value, or set both to the same mode. This process will not start.",
    };
  }
  if (fromMode === SELF_HOSTED_MODE || fromMode === "hosted") {
    return { ok: true, mode: fromMode, source: "explicit" };
  }
  if (fromFlag === SELF_HOSTED_MODE || fromFlag === "hosted") {
    return { ok: true, mode: fromFlag, source: "explicit" };
  }
  if (requiresExplicitDeploymentMode(source)) {
    return { ok: false, reason: EXPLICIT_MODE_REASON };
  }
  return { ok: true, mode: SELF_HOSTED_MODE, source: "default" };
}

/**
 * Parse an explicit `SELF_HOSTED` value. Unset and unrecognized values throw.
 * The install default lives in `resolveDeploymentMode`.
 */
export function parseDeploymentMode(value: string | undefined): DeploymentMode {
  const flag = classifySelfHosted(value);
  if (flag === SELF_HOSTED_MODE || flag === "hosted") return flag;
  throw new DeploymentModeError(
    flag === "unset"
      ? "SELF_HOSTED is unset. resolveDeploymentMode chooses the install default."
      : "SELF_HOSTED must be true, false, 1, 0, yes, no, self_hosted, self-hosted, or hosted."
  );
}
