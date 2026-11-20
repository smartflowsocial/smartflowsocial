/**
 * Checks that this working tree records the published v1.0.0-rc.1 tag and that
 * the published v1.0.0-beta.2 record still points at its immutable tag.
 *
 *   node scripts/check-candidate-version.mjs
 *
 * It does not create a tag and it does not deploy.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { gitCommit, validateReleaseRecord } from "./release-record.mjs";

export const CANDIDATE_VERSION = "1.0.0-rc.1";
export const PUBLISHED_RC_SHA = "7b9903532637525685dcb915081cb0824b2b43f6";
export const PUBLISHED_RC_AT = "2026-11-20T19:23:53Z";
export const PUBLISHED_BETA_2_SHA = "5be28add1a8ef1d078e8ba9c885ca68249d0a54f";
export const PUBLISHED_BETA_2_AT = "2026-11-19T07:47:40Z";

function readJson(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

/**
 * @param {{
 *   packageJson?: { version?: string, private?: boolean },
 *   candidate?: Record<string, unknown>,
 *   beta2?: Record<string, unknown>,
 *   headSha?: string | null,
 *   beta2TagSha?: string | null,
 * }} input
 * @returns {string[]}
 */
export function validateWorkingTreeVersions(input) {
  const errors = [];
  const packageJson = input.packageJson ?? {};
  const candidate = input.candidate ?? {};
  const beta2 = input.beta2 ?? {};

  if (packageJson.version !== CANDIDATE_VERSION) {
    errors.push(
      `package.json version is ${String(packageJson.version)}. The unreleased candidate is ${CANDIDATE_VERSION}.`
    );
  }
  if (packageJson.private !== true) {
    errors.push('package.json "private" must stay true');
  }
  if (packageJson.version === "1.0.0-beta.1") {
    errors.push(
      "package.json still says 1.0.0-beta.1. That string remains only on the published tags."
    );
  }

  for (const error of validateReleaseRecord(candidate, {
    headSha: input.headSha ?? null,
    required: ["app"],
  })) {
    errors.push(`candidate: ${error}`);
  }
  if (candidate.version !== CANDIDATE_VERSION) {
    errors.push(`candidate manifest version must be ${CANDIDATE_VERSION}`);
  }
  if (candidate.tag !== `v${CANDIDATE_VERSION}`) {
    errors.push(`candidate tag must be v${CANDIDATE_VERSION}`);
  }
  if (candidate.status !== "published-prerelease") {
    errors.push("candidate status must be published-prerelease");
  }
  if (candidate.tagPublished !== true) {
    errors.push("v1.0.0-rc.1 tagPublished must be true");
  }
  if (candidate.publishedAt !== PUBLISHED_RC_AT) {
    errors.push(`candidate publishedAt must be ${PUBLISHED_RC_AT}`);
  }
  if (candidate.applicationReleaseSha !== PUBLISHED_RC_SHA) {
    errors.push(`candidate applicationReleaseSha must be ${PUBLISHED_RC_SHA}`);
  }
  const candidateApp = Array.isArray(candidate.components)
    ? candidate.components.find((item) => item?.name === "app")
    : undefined;
  if (!candidateApp || candidateApp.releaseSha !== PUBLISHED_RC_SHA) {
    errors.push("candidate app.releaseSha must be the published tag");
  }
  if (candidateApp && candidateApp.validationStatus !== "checks-passed") {
    errors.push("candidate app validationStatus must be checks-passed");
  }
  if (candidate.productionDeployed !== false) {
    errors.push("candidate productionDeployed must be false");
  }
  if (
    input.rcTagSha != null &&
    input.rcTagSha !== PUBLISHED_RC_SHA
  ) {
    errors.push(`local v1.0.0-rc.1 tag must stay ${PUBLISHED_RC_SHA}`);
  }
  const names = new Set(
    Array.isArray(candidate.components)
      ? candidate.components.map((item) => item?.name)
      : []
  );
  for (const retired of ["publisher", "cache-worker"]) {
    if (names.has(retired)) {
      errors.push(
        `candidate manifest must not list ${retired}. Those workers are not part of this release.`
      );
    }
  }

  for (const error of validateReleaseRecord(beta2, {
    headSha: input.headSha ?? null,
    tagSha: input.beta2TagSha ?? null,
    required: ["app"],
  })) {
    errors.push(`beta.2: ${error}`);
  }
  if (beta2.version !== "1.0.0-beta.2") {
    errors.push("beta.2 manifest version must stay 1.0.0-beta.2");
  }
  if (beta2.status !== "published-prerelease") {
    errors.push("beta.2 status must be published-prerelease");
  }
  if (beta2.tag !== "v1.0.0-beta.2") {
    errors.push("beta.2 tag must be v1.0.0-beta.2");
  }
  if (beta2.tagPublished !== true) {
    errors.push("beta.2 tagPublished must be true");
  }
  if (beta2.publishedAt !== PUBLISHED_BETA_2_AT) {
    errors.push(`beta.2 publishedAt must be ${PUBLISHED_BETA_2_AT}`);
  }
  if (beta2.applicationReleaseSha !== PUBLISHED_BETA_2_SHA) {
    errors.push(`beta.2 applicationReleaseSha must be ${PUBLISHED_BETA_2_SHA}`);
  }
  if (beta2.productionDeployed !== false) {
    errors.push(
      "beta.2 productionDeployed stays false until a running service reports its commit"
    );
  }
  const app = Array.isArray(beta2.components)
    ? beta2.components.find((item) => item?.name === "app")
    : undefined;
  if (!app || app.releaseSha !== PUBLISHED_BETA_2_SHA) {
    errors.push("beta.2 app.releaseSha must be the published tag");
  }
  if (app && app.releaseShaStatus !== "git-tag") {
    errors.push("beta.2 app.releaseShaStatus must be git-tag");
  }
  if (app && app.validationStatus !== "checks-passed") {
    errors.push(
      "beta.2 app validationStatus records the checks observed on that tag"
    );
  }
  for (const component of Array.isArray(beta2.components)
    ? beta2.components
    : []) {
    if (component?.name === "app") continue;
    if (component?.releaseSha != null || component?.productionSha != null) {
      errors.push(
        `${component?.name} has no recorded release or production SHA for beta.2`
      );
    }
  }
  return errors;
}

function main() {
  const root = new URL("..", import.meta.url);
  const packageJson = readJson(new URL("package.json", root));
  const candidate = readJson(
    new URL("docs/releases/v1.0.0-rc.1.manifest.json", root)
  );
  const beta2 = readJson(
    new URL("docs/releases/v1.0.0-beta.2.manifest.json", root)
  );
  const errors = validateWorkingTreeVersions({
    packageJson,
    candidate,
    beta2,
    headSha: gitCommit("HEAD"),
    rcTagSha: gitCommit("v1.0.0-rc.1"),
    beta2TagSha: gitCommit("v1.0.0-beta.2"),
  });
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log(
    `candidate ${CANDIDATE_VERSION} is ${PUBLISHED_RC_SHA}. v1.0.0-beta.2 is ${PUBLISHED_BETA_2_SHA}. No tag was moved.`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
