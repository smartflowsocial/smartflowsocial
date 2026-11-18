/**
 * Build identity for one running process.
 * A missing value stays unknown. CI success is not a deployment.
 */

const SHA_RE = /^[0-9a-f]{40}$/i;
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export interface DeploymentIdentity {
  version: string;
  sourceCommit: string | null;
  sourceCommitStatus: "build" | "unknown";
  buildTime: string | null;
  buildTimeStatus: "build" | "unknown";
}

export function readDeploymentIdentity(
  env: Record<string, string | undefined>,
  version: string
): DeploymentIdentity {
  const sourceCommit = normalizeSha(env["SOURCE_COMMIT"]);
  const buildTime = normalizeTime(env["BUILD_TIME"]);
  return {
    version,
    sourceCommit,
    sourceCommitStatus: sourceCommit ? "build" : "unknown",
    buildTime,
    buildTimeStatus: buildTime ? "build" : "unknown",
  };
}

export function deploymentIdentityHeaders(
  identity: DeploymentIdentity
): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "X-App-Version": identity.version,
    "X-Source-Commit": identity.sourceCommit ?? "unknown",
    "X-Build-Time": identity.buildTime ?? "unknown",
  };
}

export function wantsDeploymentJson(accept: string | null): boolean {
  return (accept ?? "")
    .split(",")
    .some((part) => part.trim().toLowerCase().startsWith("application/json"));
}

function normalizeSha(value: string | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return SHA_RE.test(trimmed) ? trimmed : null;
}

function normalizeTime(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!TIME_RE.test(trimmed)) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().replace(".000Z", "Z");
}
