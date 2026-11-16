/**
 * The only `process.env` reads in modules that ship to the browser.
 * Vite does not define `process`. When the Vite build lands, this is the
 * file that switches to `import.meta.env`.
 */
function mode(): string | undefined {
  if (typeof process !== "undefined") return process.env["NODE_ENV"];
  return import.meta.env.MODE;
}

const currentMode = mode();
export const isDev = currentMode === "development";
export const isProd = currentMode === "production";
export const isTest = currentMode === "test";

/** Dynamic env read for SSR and tests. Guarded so the browser bundle does not touch `process`. */
export function readProcessEnv(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env[name];
}
