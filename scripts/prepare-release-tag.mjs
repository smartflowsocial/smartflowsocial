/**
 * Check package.json against a proposed tag before anyone creates the tag.
 *
 *   node scripts/prepare-release-tag.mjs --tag v1.0.0-beta.3
 *
 * The command prints the git tag lines on success. It does not run git tag
 * and it does not push. v1.0.0-beta.2 stays the historical mismatch and is
 * not rewritten. The tag workflow still rejects a later mismatch after a tag
 * exists, which is too late to stop the tag object from being created.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { releaseVersionError } from "./check-release-version.mjs";

function readPackageVersion() {
  const parsed = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  );
  return typeof parsed.version === "string" ? parsed.version : "";
}

function main() {
  const tagFlag = process.argv.indexOf("--tag");
  const tag = tagFlag === -1 ? "" : process.argv[tagFlag + 1];
  const packageVersion = readPackageVersion();
  const error = releaseVersionError({ packageVersion, tag });
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(`package.json ${packageVersion} matches ${tag}.`);
  console.log(
    "This script does not create the tag. Create it only after the rest of the release checklist passes:"
  );
  console.log(`git tag -a ${tag} -m "${tag}"`);
  console.log(`git push origin ${tag}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
