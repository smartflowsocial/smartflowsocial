/**
 * Check the toolchain for this checkout before a self-host install.
 *
 *   node scripts/self-host-clean-room.mjs
 *   node scripts/self-host-clean-room.mjs --migrate
 *
 * `--migrate` applies migrations only when DATABASE_URL and REDIS_URL are
 * loopback. It does not start the app, deploy, or contact a hosted service.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function versionAtLeast(actual, minimum) {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

export function isLoopbackHost(host) {
  const normalized = host.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function loopbackUrl(value, protocol) {
  if (!value || !value.startsWith(protocol)) return false;
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

function main() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const minimumNode = String(pkg.engines?.node ?? "").replace(/^>=/, "");
  const pnpm = String(pkg.packageManager ?? "").replace(/^pnpm@/, "");
  const problems = [];
  if (!versionAtLeast(process.version, minimumNode)) {
    problems.push(
      `Node ${process.version} is older than ${minimumNode}. The published tag was installed with node:26.13.1-bookworm-slim.`
    );
  }
  let pnpmVersion = "";
  try {
    pnpmVersion = execFileSync("pnpm", ["--version"], {
      encoding: "utf8",
    }).trim();
  } catch {
    problems.push("pnpm is not on PATH.");
  }
  if (pnpmVersion && pnpmVersion !== pnpm) {
    problems.push(`pnpm ${pnpmVersion} does not match packageManager ${pnpm}.`);
  }
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `toolchain ok node=${process.version} pnpm=${pnpmVersion}\n`
  );
  if (!process.argv.includes("--migrate")) return;

  const databaseUrl = process.env.DATABASE_URL ?? "";
  const redisUrl = process.env.REDIS_URL ?? "";
  if (
    !loopbackUrl(databaseUrl, "postgres") ||
    !loopbackUrl(redisUrl, "redis://")
  ) {
    process.stderr.write(
      "Refusing to migrate. DATABASE_URL and REDIS_URL must be loopback.\n"
    );
    process.exit(1);
  }
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    stdio: "inherit",
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
