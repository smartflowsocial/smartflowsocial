/**
 * Decides whether a commit's GitHub checks satisfy a release.
 * A missing, pending, skipped, or failed required check is not a pass.
 * Checks from a different commit are not an input to this function.
 */

export const SHA_RE = /^[0-9a-f]{40}$/;

export const APP_REQUIRED_CHECKS = [
  "Lint, Format & Type Check",
  "Tests & Coverage",
  "Clean install migrations",
  "Build & Bundle Budget",
  "Docker image boots",
  "E2E Smoke",
  "Gitleaks",
];

export const PUBLISHER_REQUIRED_CHECKS = [
  "Lint & Type Check",
  "Unit Tests",
  "Integration Tests",
  "Property-Based Tests",
  "Chaos Tests",
  "Security Tests",
  "Worker execution",
  "Test Summary",
  "Gitleaks",
];

export const OWNER_APPROVAL_PHRASE = "approve-release";

/**
 * @param {Array<{ name?: string, status?: string, conclusion?: string | null, completed_at?: string | null }>} runs
 * @param {readonly string[]} requiredNames
 */
export function evaluateRequiredChecks(runs, requiredNames) {
  const byName = new Map();
  for (const run of runs) {
    if (!run?.name) continue;
    const list = byName.get(run.name) ?? [];
    list.push(run);
    byName.set(run.name, list);
  }

  /** @type {Array<{ name: string, result: string }>} */
  const failures = [];
  for (const name of requiredNames) {
    const list = byName.get(name) ?? [];
    if (list.length === 0) {
      failures.push({ name, result: "missing" });
      continue;
    }
    if (list.some((run) => run.status !== "completed")) {
      failures.push({ name, result: "pending" });
      continue;
    }
    const latest = [...list].sort((left, right) => {
      const leftTime = Date.parse(left.completed_at ?? "") || 0;
      const rightTime = Date.parse(right.completed_at ?? "") || 0;
      return rightTime - leftTime;
    })[0];
    if (latest?.conclusion === "skipped") {
      failures.push({ name, result: "skipped" });
      continue;
    }
    if (latest?.conclusion !== "success") {
      failures.push({ name, result: latest?.conclusion || "failed" });
    }
  }
  return failures;
}

/**
 * @param {{
 *   candidateSha?: string,
 *   publisherSha?: string,
 *   ownerApproval?: string,
 *   headSha?: string,
 *   expectHead?: boolean,
 * }} input
 */
export function releaseInputErrors(input) {
  /** @type {string[]} */
  const errors = [];
  if (!SHA_RE.test(input.candidateSha ?? "")) {
    errors.push("candidate_sha must be the full 40-character commit");
  }
  if (!SHA_RE.test(input.publisherSha ?? "")) {
    errors.push(
      "publisher_sha must be the full 40-character publisher commit. A blank value is not a pass."
    );
  }
  if (input.ownerApproval !== OWNER_APPROVAL_PHRASE) {
    errors.push(
      "owner approval must be approve-release. This workflow does not publish or deploy."
    );
  }
  if (input.expectHead && input.headSha !== input.candidateSha) {
    errors.push(
      `checked out ${input.headSha ?? "nothing"}, expected ${input.candidateSha ?? "the candidate"}`
    );
  }
  return errors;
}
