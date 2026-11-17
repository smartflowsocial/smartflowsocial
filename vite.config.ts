import fs from "node:fs";
import path from "node:path";

import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const serverStubPrefix = "\0server-only:";

function isServerModuleId(id: string): boolean {
  return id.endsWith(".server") || /\.server\.[cm]?[jt]sx?$/.test(id);
}

function runtimeExportNames(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const names = new Set<string>();
  for (const match of withoutComments.matchAll(
    /export\s+(?:async\s+)?function\s+(\w+)/g
  )) {
    const name = match[1];
    if (name) names.add(name);
  }
  for (const match of withoutComments.matchAll(
    /export\s+(?:const|let|var|class|enum)\s+(\w+)/g
  )) {
    const name = match[1];
    if (name) names.add(name);
  }
  for (const match of withoutComments.matchAll(/export\s*\{([^}]+)\}/g)) {
    const group = match[1];
    if (!group) continue;
    for (const part of group.split(",")) {
      const cleaned = part.replace(/\btype\b/g, "").trim();
      if (!cleaned) continue;
      const alias = cleaned.split(/\s+as\s+/);
      const name = (alias[1] ?? alias[0] ?? "").trim();
      if (/^\w+$/.test(name)) names.add(name);
    }
  }
  return [...names];
}

function collectExportNames(file: string, seen: Set<string>): string[] {
  if (seen.has(file) || !fs.existsSync(file)) return [];
  seen.add(file);
  const source = fs.readFileSync(file, "utf8");
  const names = runtimeExportNames(source);
  const dir = path.dirname(file);
  for (const match of source.matchAll(
    /export\s+\*\s+from\s+["'](\.[^"']+)["']/g
  )) {
    const spec = match[1];
    if (!spec) continue;
    const candidates = [
      path.resolve(dir, spec),
      path.resolve(dir, `${spec}.ts`),
      path.resolve(dir, `${spec}.tsx`),
      path.resolve(dir, `${spec}.js`),
      path.resolve(dir, spec, "index.ts"),
      path.resolve(dir, spec, "index.tsx"),
    ];
    const found = candidates.find(
      (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    );
    if (found) names.push(...collectExportNames(found, seen));
  }
  return names;
}

function resolveServerFile(
  id: string,
  importer: string | undefined
): string | undefined {
  const bases: string[] = [];
  if (path.isAbsolute(id)) bases.push(id);
  if (id.startsWith("~/")) bases.push(path.resolve("app", id.slice(2)));
  if (importer && (id.startsWith("./") || id.startsWith("../"))) {
    const from = importer.startsWith(serverStubPrefix)
      ? importer.slice(serverStubPrefix.length)
      : importer;
    bases.push(path.resolve(path.dirname(from.split("?")[0] ?? from), id));
  }
  for (const base of bases) {
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.mjs`,
    ];
    const found = candidates.find(
      (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    );
    if (found) return found;
  }
  return undefined;
}

function stubSource(file: string | undefined): string {
  const names = file ? collectExportNames(file, new Set()) : [];
  const unique = [...new Set(names)];
  const named = unique
    .map((name) => `export const ${name} = serverOnly;`)
    .join("\n");
  return `
    function serverOnly() {
      throw new Error("Server-only module was imported by client code");
    }
    ${named}
    export default serverOnly;
  `;
}

/**
 * Remix replaced `.server` modules with an empty module in the browser
 * bundle. React Router fails the client build instead. Barrels still
 * re-export those modules next to client components, so the client build
 * stubs them. Dev serves native ESM, which needs the real export names.
 * Calling one from the browser throws.
 */
function externalNonceContext(): Plugin {
  return {
    name: "external-nonce-context",
    enforce: "pre",
    resolveId(id) {
      if (this.environment?.name === "client") return null;
      if (
        id === "#nonce-context" ||
        id.endsWith("/scripts/nonce-context.mjs") ||
        id.endsWith("\\scripts\\nonce-context.mjs")
      ) {
        return { id: "#nonce-context", external: true };
      }
      return null;
    },
  };
}

function stubServerModulesInClient(): Plugin {
  return {
    name: "stub-server-modules-in-client",
    enforce: "pre",
    resolveId(id, importer) {
      if (this.environment.name !== "client") return null;
      if (id.startsWith(serverStubPrefix) || id.includes("node_modules")) {
        return null;
      }
      if (!isServerModuleId(id)) return null;
      // Do not call this.resolve. React Router's resolver throws on
      // client imports of .server modules before a stub can replace them.
      const file = resolveServerFile(id, importer);
      return serverStubPrefix + (file ?? id);
    },
    load(id) {
      if (!id.startsWith(serverStubPrefix)) return null;
      const file = id.slice(serverStubPrefix.length);
      return {
        code: stubSource(fs.existsSync(file) ? file : undefined),
        syntheticNamedExports: true,
      };
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [
    // Vite's dev module runner cannot load a bare #import marked external.
    // Production Node can, and that is what keeps one copy in the image.
    ...(command === "build" ? [externalNonceContext()] : []),
    stubServerModulesInClient(),
    reactRouter(),
    tsconfigPaths(),
  ],
  ssr:
    command === "build"
      ? {
          external: ["#nonce-context"],
        }
      : undefined,
}));
