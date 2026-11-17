import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import * as esbuild from "esbuild";
import { describe, expect, it } from "vitest";

import { bundleOptions, envBanner } from "../../../scripts/bundle-node.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const loadEnvPath = path.join(repoRoot, "scripts/load-env.cjs");

function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["PATH", "HOME", "TMPDIR"] as const) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) env[key] = value;
  return env;
}

describe("load-env", () => {
  it("fills variables from .env and does not override the environment", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sfs-load-env-"));
    try {
      await writeFile(
        path.join(dir, ".env"),
        "FROM_FILE=from-file\nFROM_ENV=from-file\n"
      );
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "--input-type=commonjs",
          "-e",
          `require(${JSON.stringify(loadEnvPath)}); process.stdout.write((process.env.FROM_FILE ?? "") + " " + (process.env.FROM_ENV ?? ""));`,
        ],
        { cwd: dir, env: childEnv({ FROM_ENV: "from-env" }) }
      );
      expect(stdout).toBe("from-file from-env");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("succeeds when .env is absent", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sfs-load-env-"));
    try {
      const result = await execFileAsync(
        process.execPath,
        [
          "--input-type=commonjs",
          "-e",
          `require(${JSON.stringify(loadEnvPath)})`,
        ],
        { cwd: dir, env: childEnv() }
      );
      expect(result.stderr).toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("node bundle env order", () => {
  it("keeps sharp external, and ioredis external only for the watched worker", () => {
    expect(envBanner)
      .toBe(`import { createRequire as __createRequire } from "node:module";
import "../scripts/load-env.cjs";
var require = __createRequire(import.meta.url);
`);
    expect(bundleOptions("worker.ts", { watch: true }).external).toEqual([
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
      "ioredis",
    ]);
    expect(bundleOptions("server.ts", { watch: false }).format).toBe("esm");
    expect(bundleOptions("worker.ts", { watch: false }).external).not.toContain(
      "ioredis"
    );
    expect(bundleOptions("server.ts", { watch: true }).external).toContain(
      "sharp"
    );
  });

  it("loads .env before an imported module reads it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sfs-bundle-env-"));
    const outfile = path.join(repoRoot, "build/env-order-fixture.js");
    try {
      await writeFile(
        path.join(dir, "dep.js"),
        "export const seen = process.env.ORDER_SENTINEL;\n"
      );
      await writeFile(
        path.join(dir, "entry.js"),
        'import { seen } from "./dep.js"; process.stdout.write(seen ?? "");\n'
      );
      await writeFile(path.join(dir, ".env"), "ORDER_SENTINEL=from-file\n");

      const build = (banner: boolean) =>
        esbuild.build({
          entryPoints: [path.join(dir, "entry.js")],
          outfile,
          bundle: true,
          platform: "node",
          format: "esm",
          banner: banner ? { js: envBanner } : undefined,
          logLevel: "silent",
        });

      await build(false);
      const tooLate = await execFileAsync(process.execPath, [outfile], {
        cwd: dir,
        env: childEnv(),
      });
      expect(tooLate.stdout).toBe("");

      await build(true);
      const source = await readFile(outfile, "utf8");
      expect(source.startsWith(envBanner)).toBe(true);
      const loaded = await execFileAsync(process.execPath, [outfile], {
        cwd: dir,
        env: childEnv(),
      });
      expect(loaded.stdout).toBe("from-file");
      const kept = await execFileAsync(process.execPath, [outfile], {
        cwd: dir,
        env: childEnv({ ORDER_SENTINEL: "from-env" }),
      });
      expect(kept.stdout).toBe("from-env");
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outfile, { force: true });
    }
  });
});
