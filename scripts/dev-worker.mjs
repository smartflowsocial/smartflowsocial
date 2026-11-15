/**
 * Builds the worker bundle and runs it, for `pnpm dev`.
 *
 * esbuild keeps running. A successful rebuild restarts the worker. In CI, or
 * when E2E_TEST=true, the process exits if the bundle is not produced or the
 * worker never becomes ready. A worker that was ready and then exits is
 * restarted, and more than five of those exits in a minute stops `pnpm dev`.
 * Locally, a bundle error leaves the web server running, and a later worker
 * exit waits for the next build.
 */
import { spawn } from "node:child_process";

import * as esbuild from "esbuild";

import { bundleOptions } from "./bundle-node.mjs";

const workerPath = "build/worker.js";
const strict = process.env.CI === "true" || process.env.E2E_TEST === "true";
const BOOT_TIMEOUT_MS = 90_000;
const BUILD_TIMEOUT_MS = 120_000;

let child = null;
let shuttingDown = false;
let restarting = false;
let sawReady = false;
let startedOnce = false;
let bootTimer = null;
let restartTimer = null;
const crashTimes = [];

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(bootTimer);
  clearTimeout(restartTimer);
  const finish = () => process.exit(code);
  if (child === null || child.exitCode !== null || child.signalCode !== null) {
    finish();
    return;
  }
  child.once("exit", finish);
  child.kill("SIGTERM");
  setTimeout(() => {
    if (
      child !== null &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      child.kill("SIGKILL");
    }
  }, 5_000).unref();
}

function watchStream(stream, destination) {
  stream.setEncoding("utf8");
  let pending = "";
  stream.on("data", (text) => {
    destination.write(text);
    pending = (pending + text).slice(-300);
    if (pending.includes("Worker metrics ready")) {
      sawReady = true;
      clearTimeout(bootTimer);
    }
  });
}

function startWorker() {
  clearTimeout(bootTimer);
  sawReady = false;
  child = spawn(process.execPath, [workerPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  watchStream(child.stdout, process.stdout);
  watchStream(child.stderr, process.stderr);
  bootTimer = setTimeout(() => {
    if (!sawReady && !shuttingDown) {
      console.error("[dev] worker did not become ready within 90s");
      shutdown(1);
    }
  }, BOOT_TIMEOUT_MS);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    clearTimeout(bootTimer);
    if (restarting) {
      restarting = false;
      startWorker();
      return;
    }
    const status = signal ?? code;
    if (!sawReady) {
      console.error(`[dev] worker exited (${status}) before it was ready`);
      shutdown(typeof code === "number" && code !== 0 ? code : 1);
      return;
    }
    if (strict) {
      const now = Date.now();
      while (crashTimes.length > 0 && now - crashTimes[0] >= 60_000) {
        crashTimes.shift();
      }
      crashTimes.push(now);
      if (crashTimes.length > 5) {
        console.error("[dev] worker crashed more than 5 times in a minute");
        shutdown(1);
        return;
      }
      console.error(`[dev] worker exited (${status}). Restarting.`);
      startWorker();
      return;
    }
    console.error(
      `[dev] worker exited (${status}). It will start again on the next build.`
    );
  });
}

function scheduleRestart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (shuttingDown) return;
    if (child === null || child.exitCode !== null) {
      startWorker();
      return;
    }
    restarting = true;
    child.kill("SIGTERM");
  }, 300);
}

if (strict) {
  setTimeout(() => {
    if (!startedOnce && !shuttingDown) {
      console.error("[dev] worker bundle was not built within 120s");
      shutdown(1);
    }
  }, BUILD_TIMEOUT_MS);
}

const context = await esbuild.context({
  ...bundleOptions("worker.ts", { watch: true }),
  plugins: [
    {
      name: "run-worker",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length > 0 || shuttingDown) return;
          if (!startedOnce) {
            startedOnce = true;
            startWorker();
            return;
          }
          scheduleRestart();
        });
      },
    },
  ],
});

await context.watch();

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
