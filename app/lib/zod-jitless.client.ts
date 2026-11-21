import { config } from "zod";

/**
 * Backup for client graphs that import Zod after this module.
 *
 * Route modules on a server-rendered page run first, so the head script from
 * `zodJitlessBootScript` is what stops the CSP `eval` report there.
 */
config({ jitless: true });
