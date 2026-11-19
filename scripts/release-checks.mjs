/**
 * Decides whether a commit's GitHub checks satisfy a release.
 * A missing, pending, skipped, or failed required check is not a pass.
 * Checks from a different commit are not an input to this function.
 */

export const SHA_RE = /^[0-9a-f]{40}$/;

export const APP_REQUIRED_CHECKS = [
  "Lint, Format & Type Check",
  "Tests & Coverage",
  "Internal Nostr paths",
  "Clean install migrations",
  "Build & Bundle Budget",
  "Docker image boots",
  "E2E Smoke",
  "E2E Core",
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
 * The internal publisher is the release default. `http` still requires the
 * external publisher commit and its checks. A blank publisher SHA is not a
 * pass in that mode.
 *
 * @param {{ publisherMode?: string, publisherSha?: string }} input
 * @returns {{ mode: "internal" | "http" | "invalid", errors: string[] }}
 */
export function publisherReleasePlan(input) {
  const requested = (input.publisherMode ?? "").trim().toLowerCase();
  /** @type {"internal" | "http" | "invalid"} */
  let mode = "internal";
  if (requested === "http" || requested === "internal") {
    mode = requested;
  } else if (requested !== "") {
    mode = "invalid";
  } else if ((input.publisherSha ?? "").trim() !== "") {
    mode = "http";
  }

  /** @type {string[]} */
  const errors = [];
  if (mode === "invalid") {
    errors.push("publisher_mode must be internal or http");
  } else if (mode === "internal" && (input.publisherSha ?? "").trim() !== "") {
    errors.push(
      "publisher_sha must be empty when publisher_mode is internal. The HTTP publisher is not part of this release."
    );
  } else if (mode === "http" && !SHA_RE.test(input.publisherSha ?? "")) {
    errors.push(
      "publisher_sha must be the full 40-character publisher commit when publisher_mode is http. A blank value is not a pass."
    );
  }
  return { mode, errors };
}

/**
 * @param {{
 *   candidateSha?: string,
 *   publisherSha?: string,
 *   publisherMode?: string,
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
  errors.push(...publisherReleasePlan(input).errors);
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
