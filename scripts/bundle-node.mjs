import path from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

// Resolved from build/server.js and build/worker.js. The import is the first
// statement so it runs before the external React Router imports initialize.
export const envBanner = `import { createRequire as __createRequire } from "node:module";
import "../scripts/load-env.cjs";
var require = __createRequire(import.meta.url);
`;

const sharedExternal = [
  "fsevents",
  "file-type",
  "sharp",
  "@prisma/client",
  "@prisma/engines",
  "vite",
  "react-router",
  "react-router/dom",
  "@react-router/dev",
  "@react-router/express",
  "@react-router/fs-routes",
  "@react-router/node",
  "#nonce-context",
];

const externalReactRouter = {
  name: "external-react-router",
  setup(build) {
    build.onResolve(
      { filter: /^(?:react-router(?:\/|$)|@react-router\/)/ },
      (args) => ({ path: args.path, external: true })
    );
  },
};

export function bundleOptions(entry, { watch }) {
  const external = [...sharedExternal];
  // The previous dev:worker command left ioredis external. Keep that for the
  // watched worker bundle only.
  if (watch && entry.endsWith("worker.ts")) external.push("ioredis");
  return {
    entryPoints: [entry],
    platform: "node",
    format: "esm",
    outdir: "build",
    bundle: true,
    external,
    plugins: [externalReactRouter],
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
