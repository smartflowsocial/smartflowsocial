/**
 * Classic inline script for the document `<head>`.
 *
 * The server bootstrap imports route modules before `entry.client` runs.
 * Zod calls `Function("")` when an object schema is constructed, so
 * `config({ jitless: true })` in the entry module is already too late.
 * This writes the global Zod reads, without importing Zod.
 */
export function zodJitlessBootScript(): string {
  return "globalThis.__zod_globalConfig=Object.assign(globalThis.__zod_globalConfig||{},{jitless:true});";
}
