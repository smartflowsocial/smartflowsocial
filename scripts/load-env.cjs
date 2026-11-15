/**
 * Loads `.env` from the working directory before the server or worker bundle runs.
 *
 * esbuild initializes imported modules before the config() call inside server.ts
 * and worker.ts, so environment validation never saw the file. This script is
 * required from the top of the bundle, ahead of that initialization.
 *
 * Variables already set in the environment are left as they are. A missing file
 * is not an error.
 */
const path = require("node:path");

const { config } = require("dotenv");

const result = config({
  path: path.resolve(process.cwd(), ".env"),
  quiet: true,
});

if (result.error && result.error.code !== "ENOENT") {
  throw result.error;
}
