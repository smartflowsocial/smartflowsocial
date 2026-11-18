/**
 * Checks the published v1.0.0-beta.1 manifest.
 *
 * The tagged commit still contains the pre-publication manifest. This script
 * checks the copy on the branch where it is run. It does not move the tag.
 *
 *   node scripts/release-manifest.mjs
 *   node scripts/release-manifest.mjs --online
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { gitCommit, validateReleaseRecord } from "./release-record.mjs";

export const PUBLISHED_BETA_SHA = "9b1e08cf9a8cf381b640d26c26277e2b0c5ad169";
export const PUBLISHED_BETA_AT = "2026-11-18T07:02:25Z";

const manifestPath = new URL(
  "../docs/releases/v1.0.0-beta.1.manifest.json",
  import.meta.url
);
const packagePath = new URL("../package.json", import.meta.url);

export function validatePublishedBetaManifest(manifest, packageJson, context) {
  const errors = validateReleaseRecord(manifest, {
    ...context,
    required: ["app", "publisher", "blossom", "blastr", "cache-worker"],
  });
  if (manifest?.version !== "1.0.0-beta.1") {
    errors.push(`manifest version is ${String(manifest?.version)}`);
  }
  if (packageJson?.version !== "1.0.0-beta.1") {
    errors.push(`package.json version is ${String(packageJson?.version)}`);
  }
  if (packageJson?.version !== manifest?.version) {
    errors.push("package.json version does not match the manifest");
  }
  if (packageJson?.private !== true) {
    errors.push('package.json "private" must stay true');
  }
  if (manifest?.status !== "published-prerelease") {
    errors.push("status must be published-prerelease");
  }
  if (manifest?.tag !== "v1.0.0-beta.1") {
    errors.push("tag must be v1.0.0-beta.1");
  }
  if (manifest?.tagPublished !== true) {
    errors.push(
      "tagPublished must be true. The GitHub Release already exists."
    );
  }
  if (manifest?.publishedAt !== PUBLISHED_BETA_AT) {
    errors.push(`publishedAt must be ${PUBLISHED_BETA_AT}`);
  }
  if (manifest?.applicationReleaseSha !== PUBLISHED_BETA_SHA) {
    errors.push(
      `applicationReleaseSha must be the published tag ${PUBLISHED_BETA_SHA}`
    );
  }
  if (manifest?.productionDeployed !== false) {
    errors.push(
      "productionDeployed must stay false until a running service reports its commit"
    );
  }
  const app = (manifest?.components ?? []).find((item) => item.name === "app");
  if (app && app.releaseSha !== PUBLISHED_BETA_SHA) {
    errors.push("app.releaseSha must be the published tag");
  }
  if (app && app.validationStatus !== "checks-finished-after-publication") {
    errors.push(
      "app validation is checks-finished-after-publication. The release was published before every required check had finished."
    );
  }
  for (const component of manifest?.components ?? []) {
    if (component.name === "app") continue;
    if (
      component.releaseSha != null ||
      component.validationStatus !== "unknown"
    ) {
      errors.push(
        `${component.name} was not recorded with this prerelease. Leave releaseSha null and validationStatus unknown.`
      );
    }
  }
  return errors;
}

function main() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const online = process.argv.includes("--online");
  const headSha = gitCommit("HEAD");
  const tagSha = gitCommit("v1.0.0-beta.1");
  const errors = validatePublishedBetaManifest(manifest, packageJson, {
    headSha,
    tagSha,
  });
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log(
    `release manifest ok tag=${manifest.tag} sha=${manifest.applicationReleaseSha} production=unknown`
  );
  if (!online) return;

  for (const component of manifest.components) {
    try {
      const sha = execFileSync(
        "gh",
        [
          "api",
          `repos/${component.repository}/commits/${component.branch}`,
          "--jq",
          ".sha",
        ],
        { encoding: "utf8" }
      ).trim();
      console.log(
        `${component.name} ${component.branch} observed ${sha} (not a release SHA and not a deployment SHA)`
      );
    } catch {
      console.error(
        `cannot read ${component.repository} branch ${component.branch}`
      );
      process.exitCode = 1;
    }
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("release-manifest.mjs");

if (invokedDirectly) {
  main();
}
