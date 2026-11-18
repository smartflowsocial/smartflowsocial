/**
 * Fails unless the named commits already have successful required checks.
 * Does not create a GitHub Release and does not deploy.
 *
 *   CANDIDATE_SHA=... PUBLISHER_SHA=... OWNER_APPROVAL=approve-release \
 *     node scripts/require-release-checks.mjs --expect-head
 */

import { execFileSync } from "node:child_process";

import {
  APP_REQUIRED_CHECKS,
  PUBLISHER_REQUIRED_CHECKS,
  evaluateRequiredChecks,
  publisherReleasePlan,
  releaseInputErrors,
} from "./release-checks.mjs";

const APP_REPOSITORY =
  process.env.APP_REPOSITORY ?? "smartflowsocial/smartflowsocial";
const PUBLISHER_REPOSITORY =
  process.env.PUBLISHER_REPOSITORY ??
  "smartflowsocial/smartflowsocial-publisher";

function headSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

async function checkRuns(repository, sha) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
  if (!token) {
    throw new Error("GITHUB_TOKEN is required to read check runs");
  }
  /** @type {Array<{ name?: string, status?: string, conclusion?: string | null, completed_at?: string | null }>} */
  const runs = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = `https://api.github.com/repos/${repository}/commits/${sha}/check-runs?per_page=100&page=${page}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "smartflowsocial-release-validation",
      },
    });
    if (!response.ok) {
      throw new Error(
        `could not read checks for ${repository}@${sha} (HTTP ${response.status})`
      );
    }
    const body = await response.json();
    const pageRuns = Array.isArray(body.check_runs) ? body.check_runs : [];
    runs.push(...pageRuns);
    if (pageRuns.length < 100) break;
  }
  return runs;
}

function report(label, failures) {
  if (failures.length === 0) {
    console.log(`${label}: required checks passed`);
    return;
  }
  for (const failure of failures) {
    console.error(`${label}: ${failure.name} is ${failure.result}`);
  }
}

async function main() {
  const publisherPlan = publisherReleasePlan({
    publisherMode: process.env.PUBLISHER_MODE,
    publisherSha: process.env.PUBLISHER_SHA,
  });
  const inputErrors = releaseInputErrors({
    candidateSha: process.env.CANDIDATE_SHA,
    publisherSha: process.env.PUBLISHER_SHA,
    publisherMode: process.env.PUBLISHER_MODE,
    ownerApproval: process.env.OWNER_APPROVAL,
    headSha: process.argv.includes("--expect-head") ? headSha() : undefined,
    expectHead: process.argv.includes("--expect-head"),
  });
  if (inputErrors.length > 0) {
    for (const error of inputErrors) console.error(error);
    process.exit(1);
  }

  const candidate = process.env.CANDIDATE_SHA;
  const appRuns = await checkRuns(APP_REPOSITORY, candidate);
  const appFailures = evaluateRequiredChecks(appRuns, APP_REQUIRED_CHECKS);
  report(`${APP_REPOSITORY}@${candidate}`, appFailures);
  /** @type {Array<{ name: string, result: string }>} */
  let publisherFailures = [];
  if (publisherPlan.mode === "http") {
    const publisher = process.env.PUBLISHER_SHA;
    const publisherRuns = await checkRuns(PUBLISHER_REPOSITORY, publisher);
    publisherFailures = evaluateRequiredChecks(
      publisherRuns,
      PUBLISHER_REQUIRED_CHECKS
    );
    report(`${PUBLISHER_REPOSITORY}@${publisher}`, publisherFailures);
  } else {
    console.log(
      "internal publisher: external HTTP publisher checks are not required for this release"
    );
  }
  if (appFailures.length > 0 || publisherFailures.length > 0) {
    process.exit(1);
  }
  console.log(
    "release checks passed for this candidate. No release was published and nothing was deployed."
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("require-release-checks.mjs");

if (invokedDirectly) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "release check failed"
    );
    process.exit(1);
  });
}
