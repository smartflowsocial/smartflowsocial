import { config } from "zod";

/**
 * Production `script-src` does not allow `'unsafe-eval'`. Zod otherwise
 * probes with `Function("")` the first time a schema parses, and Chrome
 * reports that caught call as a CSP violation. Parsing still works.
 */
config({ jitless: true });
