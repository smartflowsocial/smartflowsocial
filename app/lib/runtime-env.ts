/**
 * The only `process.env` reads in modules that ship to the browser.
 * Vite does not define `process`. When the Vite build lands, this is the
 * file that switches to `import.meta.env`.
 */
export const isDev = process.env.NODE_ENV === "development";
export const isProd = process.env.NODE_ENV === "production";
export const isTest = process.env.NODE_ENV === "test";

/** Dynamic env read for SSR and tests. Guarded so the browser bundle does not touch `process`. */
export function readProcessEnv(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env[name];
}
