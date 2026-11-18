/**
 * Validates a release record without writing a commit SHA into itself.
 *
 * A record may name an already-created tag. It must not name the commit that
 * contains the record, and it must not treat a CI success as a deployment.
 *
 *   node scripts/release-record.mjs --check docs/releases/v1.0.0-beta.1.manifest.json
 *   node scripts/release-record.mjs --init 1.2.3-beta.1
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

export const SHA_RE = /^[0-9a-f]{40}$/;

export const RELEASE_SHA_STATUSES = new Set([
  "unknown",
  "git-tag",
  "validated-commit",
]);

export const VALIDATION_STATUSES = new Set([
  "unknown",
  "not-validated",
  "checks-passed",
  "checks-finished-after-publication",
]);

export const DEPLOYMENT_STATUSES = new Set([
  "unknown",
  "verified-from-running-service",
]);

export const ROLES = new Set([
  "required",
  "required-for-relay-delivery",
  "optional",
]);

const PASSED_VALIDATION = new Set([
  "checks-passed",
  "checks-finished-after-publication",
]);

export function gitCommit(rev) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", `${rev}^{commit}`], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function isSha(value) {
  return typeof value === "string" && SHA_RE.test(value);
}

function push(errors, message) {
  errors.push(message);
}

export function validateReleaseRecord(record, context = {}) {
  const errors = [];
  const headSha = context.headSha ?? null;
  if (!record || typeof record !== "object") {
    return ["release record must be an object"];
  }
  if (typeof record.version !== "string" || record.version.length === 0) {
    push(errors, "version is required");
  }
  if (record.tagPublished === true) {
    if (
      record.status !== "published-prerelease" &&
      record.status !== "published"
    ) {
      push(
        errors,
        "a published tag needs status published or published-prerelease"
      );
    }
    if (!isSha(record.applicationReleaseSha)) {
      push(
        errors,
        "applicationReleaseSha must be the 40-character tagged commit"
      );
    }
  } else if (record.applicationReleaseSha != null) {
    push(
      errors,
      "applicationReleaseSha cannot be set before the tag exists. Record it after the tag is created, in a later commit."
    );
  }
  if (
    isSha(record.applicationReleaseSha) &&
    record.applicationReleaseSha === headSha
  ) {
    push(
      errors,
      "applicationReleaseSha is the commit that contains this record. Put the tagged commit here only after that tag exists, and do not tag this commit to make the hash match."
    );
  }
  if (
    context.tagSha &&
    record.applicationReleaseSha &&
    record.applicationReleaseSha !== context.tagSha
  ) {
    push(errors, "applicationReleaseSha does not match the local git tag");
  }
  if (
    record.productionDeployed !== true &&
    record.productionDeployed !== false
  ) {
    push(errors, "productionDeployed must be true or false");
  }
  if (!Array.isArray(record.components) || record.components.length === 0) {
    push(errors, "components must be a non-empty list");
    return errors;
  }

  const names = new Set();
  let anyProductionSha = false;
  for (const component of record.components) {
    if (!component?.name || !component.repository || !component.role) {
      push(errors, "a component is missing name, repository, or role");
      continue;
    }
    if (names.has(component.name))
      push(errors, `duplicate component ${component.name}`);
    names.add(component.name);
    if (!String(component.repository).startsWith("smartflowsocial/")) {
      push(errors, `${component.name} is outside smartflowsocial`);
    }
    if (!ROLES.has(component.role)) {
      push(errors, `${component.name} has an unknown role`);
    }
    if (!RELEASE_SHA_STATUSES.has(component.releaseShaStatus)) {
      push(errors, `${component.name} has an unknown releaseShaStatus`);
    }
    if (!VALIDATION_STATUSES.has(component.validationStatus)) {
      push(errors, `${component.name} has an unknown validationStatus`);
    }
    if (component.releaseSha == null) {
      if (component.releaseShaStatus !== "unknown") {
        push(
          errors,
          `${component.name} has no releaseSha, so releaseShaStatus must be unknown`
        );
      }
      if (PASSED_VALIDATION.has(component.validationStatus)) {
        push(
          errors,
          `${component.name} cannot be validated without a releaseSha`
        );
      }
    } else if (!isSha(component.releaseSha)) {
      push(
        errors,
        `${component.name} releaseSha must be 40 hex characters or null`
      );
    } else if (component.releaseSha === headSha) {
      push(
        errors,
        `${component.name} releaseSha is the commit that contains this record`
      );
    } else if (component.releaseShaStatus === "unknown") {
      push(
        errors,
        `${component.name} releaseSha needs git-tag or validated-commit`
      );
    }
    for (const field of ["productionSha", "stagingSha"]) {
      const statusField =
        field === "productionSha" ? "productionShaStatus" : "stagingShaStatus";
      const value = component[field];
      const status = component[statusField];
      if (!DEPLOYMENT_STATUSES.has(status)) {
        push(errors, `${component.name} has an unknown ${statusField}`);
        continue;
      }
      if (status === "inferred-from-ci") {
        push(
          errors,
          `${component.name} ${statusField} cannot be inferred from CI`
        );
      }
      if (value == null) {
        if (status !== "unknown") {
          push(
            errors,
            `${component.name} ${field} is empty, so ${statusField} must be unknown`
          );
        }
      } else if (!isSha(value)) {
        push(
          errors,
          `${component.name} ${field} must be 40 hex characters or null`
        );
      } else if (status !== "verified-from-running-service") {
        push(
          errors,
          `${component.name} ${field} is set without verified-from-running-service`
        );
      } else if (field === "productionSha") {
        anyProductionSha = true;
      }
    }
  }

  if (record.productionDeployed === true && !anyProductionSha) {
    push(
      errors,
      "productionDeployed cannot be true until a productionSha is verified from the running service"
    );
  }
  if (record.productionDeployed === false && anyProductionSha) {
    push(
      errors,
      "productionDeployed is false while a productionSha is recorded"
    );
  }
  for (const name of context.required ?? []) {
    if (!names.has(name)) push(errors, `missing component ${name}`);
  }
  return errors;
}

export function emptyReleaseRecord(version) {
  const component = (name, repository, role) => ({
    name,
    repository,
    role,
    branch: "main",
    releaseSha: null,
    releaseShaStatus: "unknown",
    validationStatus: "unknown",
    productionSha: null,
    productionShaStatus: "unknown",
    stagingSha: null,
    stagingShaStatus: "unknown",
  });
  return {
    version,
    status: "unreleased",
    tag: `v${version}`,
    tagPublished: false,
    publishedAt: null,
    applicationReleaseSha: null,
    productionDeployed: false,
    shaPolicy:
      "Leave applicationReleaseSha null until the tag exists. Then set it to that tag in a commit that is not the tagged commit. Leave productionSha null until the running service reports it.",
    components: [
      component("app", "smartflowsocial/smartflowsocial", "required"),
      component(
        "publisher",
        "smartflowsocial/smartflowsocial-publisher",
        "required-for-relay-delivery"
      ),
      component(
        "blossom",
        "smartflowsocial/smartflowsocial-blossom",
        "optional"
      ),
      component("blastr", "smartflowsocial/smartflowsocial-blastr", "optional"),
      component(
        "cache-worker",
        "smartflowsocial/smartflowsocial-cache-worker",
        "optional"
      ),
    ],
  };
}

function printErrors(errors) {
  for (const error of errors) console.error(error);
}

function main() {
  const initAt = process.argv.indexOf("--init");
  if (initAt !== -1) {
    const version = process.argv[initAt + 1];
    if (!version || version.startsWith("-")) {
      console.error("usage: node scripts/release-record.mjs --init <version>");
      process.exit(1);
    }
    const record = emptyReleaseRecord(version);
    const errors = validateReleaseRecord(record, {
      headSha: gitCommit("HEAD"),
      required: ["app", "publisher"],
    });
    if (errors.length > 0) {
      printErrors(errors);
      process.exit(1);
    }
    const destination = `docs/releases/${version}.record.json`;
    writeFileSync(destination, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`wrote ${destination}`);
    return;
  }

  const checkAt = process.argv.indexOf("--check");
  const file = checkAt === -1 ? null : process.argv[checkAt + 1];
  if (!file || file.startsWith("-")) {
    console.error(
      "usage: node scripts/release-record.mjs --check <record.json> | --init <version>"
    );
    process.exit(1);
  }
  const record = JSON.parse(readFileSync(file, "utf8"));
  const errors = validateReleaseRecord(record, {
    headSha: gitCommit("HEAD"),
    tagSha: record.tag ? gitCommit(record.tag) : null,
    required: ["app", "publisher"],
  });
  if (errors.length > 0) {
    printErrors(errors);
    process.exit(1);
  }
  console.log(`release record ok ${file}`);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("release-record.mjs");

if (invokedDirectly) {
  main();
}
