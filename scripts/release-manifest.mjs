import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const manifestPath = new URL(
  "../docs/releases/v1.0.0-beta.1.manifest.json",
  import.meta.url
);
const packagePath = new URL("../package.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const online = process.argv.includes("--online");
const errors = [];

const required = ["app", "publisher", "blossom", "blastr", "cache-worker"];

if (manifest.version !== "1.0.0-beta.1") {
  errors.push(`manifest version is ${String(manifest.version)}`);
}
if (packageJson.version !== manifest.version) {
  errors.push(
    `package.json version ${packageJson.version} does not match the manifest`
  );
}
if (packageJson.private !== true) {
  errors.push('package.json "private" must stay true');
}
if (manifest.tagPublished !== false) {
  errors.push("tagPublished must stay false until a tag exists");
}
if (manifest.productionDeployed !== false) {
  errors.push(
    "productionDeployed must stay false until a deploy SHA is recorded separately"
  );
}
if (!Array.isArray(manifest.components) || manifest.components.length === 0) {
  errors.push("components must be a non-empty list");
}

const names = new Set();
for (const component of manifest.components ?? []) {
  if (!component.name || !component.repository || !component.branch) {
    errors.push("a component is missing name, repository, or branch");
    continue;
  }
  if (names.has(component.name))
    errors.push(`duplicate component ${component.name}`);
  names.add(component.name);
  if (!component.repository.startsWith("smartflowsocial/")) {
    errors.push(`${component.name} is outside smartflowsocial`);
  }
  if (component.releaseSha != null) {
    errors.push(
      `${component.name} has releaseSha set. Record the tag SHA outside this file after the tag exists.`
    );
  }
  if (component.productionSha != null) {
    errors.push(
      `${component.name} has productionSha set without a separate deployment record.`
    );
  }
}

for (const name of required) {
  if (!names.has(name)) errors.push(`missing component ${name}`);
}

if (online && errors.length === 0) {
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
      if (!/^[0-9a-f]{40}$/.test(sha)) {
        errors.push(`${component.repository} did not return a commit SHA`);
      } else {
        console.log(
          `${component.name} ${component.branch} observed ${sha} (not a release or production SHA)`
        );
      }
    } catch {
      errors.push(
        `cannot read ${component.repository} branch ${component.branch}`
      );
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log("release manifest ok");
