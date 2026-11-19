/**
 * Rejects a release tag whose name does not match package.json.
 *
 *   node scripts/check-release-version.mjs --tag v1.0.0-beta.3
 *
 * v1.0.0-beta.2 was published while package.json still said 1.0.0-beta.1.
 * That tag is immutable. This check applies to tags created after it.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function releaseTagVersion(tag) {
  const trimmed = String(tag ?? "").trim();
  if (!trimmed.startsWith("v") || trimmed.length < 2) return null;
  return trimmed.slice(1);
}

/**
 * @param {{ packageVersion?: string, tag?: string }} input
 * @returns {string | null}
 */
export function releaseVersionError(input) {
  const packageVersion = String(input.packageVersion ?? "").trim();
  const tagVersion = releaseTagVersion(input.tag);
  if (!packageVersion) return "package.json version is empty";
  if (!tagVersion) return "tag must look like v1.2.3";
  if (packageVersion !== tagVersion) {
    return `package.json version ${packageVersion} does not match tag v${tagVersion}. Update package.json before publishing. The published v1.0.0-beta.2 tag is an exception and is not rewritten.`;
  }
  return null;
}

function readPackageVersion() {
  const file = new URL("../package.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return typeof parsed.version === "string" ? parsed.version : "";
}

function main() {
  const tagFlag = process.argv.indexOf("--tag");
  const tag = tagFlag === -1 ? "" : process.argv[tagFlag + 1];
  const error = releaseVersionError({
    packageVersion: readPackageVersion(),
    tag,
  });
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(`release version ${readPackageVersion()} matches ${tag}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
