import path from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

// Resolved from build/server.js and build/worker.js. scripts/load-env.cjs has no
// dependency on the bundle, and it runs before any bundled module initializes.
export const envBanner = 'require("../scripts/load-env.cjs");';

const sharedExternal = [
  "fsevents",
  "file-type",
  "sharp",
  "@prisma/client",
  "@prisma/engines",
  "vite",
];

export function bundleOptions(entry, { watch }) {
  const external = [...sharedExternal];
  // The previous dev:worker command left ioredis external. Keep that for the
  // watched worker bundle only.
  if (watch && entry.endsWith("worker.ts")) external.push("ioredis");
  return {
    entryPoints: [entry],
    platform: "node",
    format: "cjs",
    outdir: "build",
    bundle: true,
    external,
    banner: { js: envBanner },
    logLevel: "info",
  };
}

async function main() {
  const entry = process.argv[2];
  const watch = process.argv.includes("--watch");
  if (!entry || entry.startsWith("-")) {
    console.error(
      "Usage: node scripts/bundle-node.mjs <server.ts|worker.ts> [--watch]"
    );
    process.exit(1);
  }
  const options = bundleOptions(entry, { watch });
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    return;
  }
  await esbuild.build(options);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
