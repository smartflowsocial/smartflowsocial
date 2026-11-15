/**
 * Fails when a development Compose file publishes an internal port on every
 * interface, or pins an image to `latest`.
 *
 *   node scripts/check-dev-compose.mjs docker-compose.yml
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function unboundDevPorts(text) {
  const problems = [];
  const pattern = /^\s*-\s*["']([^"']+)["']/gm;
  for (const match of text.matchAll(pattern)) {
    const value = match[1];
    if (/^\d+:\d+$/.test(value)) {
      problems.push(value);
    }
  }
  return problems;
}

export function floatingLatestImages(text) {
  return [...text.matchAll(/image:\s*(\S+:latest)\b/g)].map(
    (match) => match[1]
  );
}

export function devComposeProblems(text) {
  const problems = [];
  for (const port of unboundDevPorts(text)) {
    problems.push(
      `port ${port} is published on all interfaces; bind it to 127.0.0.1`
    );
  }
  for (const image of floatingLatestImages(text)) {
    problems.push(`image ${image} uses the floating latest tag`);
  }
  return problems;
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: node scripts/check-dev-compose.mjs <compose.yml>...");
    process.exit(2);
  }
  let failed = false;
  for (const file of files) {
    const problems = devComposeProblems(readFileSync(file, "utf8"));
    if (problems.length === 0) {
      console.log(`${file}: development ports stay on localhost`);
      continue;
    }
    failed = true;
    for (const problem of problems) {
      console.error(`${file}: ${problem}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
