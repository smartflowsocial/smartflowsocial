import { execFile } from "node:child_process";
import { resolve } from "path";

import { defineConfig } from "cypress";
import { config } from "dotenv";

const SUPPORT_SCRIPTS = new Set([
  "tests/e2e/support/create-user.ts",
  "tests/e2e/support/delete-user.ts",
  "tests/e2e/support/create-nostr-user.ts",
  "tests/e2e/support/delete-nostr-user.ts",
  "tests/e2e/support/update-subscription-status.ts",
  "tests/e2e/support/create-draft-post.ts",
  "tests/e2e/support/create-posted-post.ts",
  "tests/e2e/support/create-scheduled-post.ts",
  "tests/e2e/support/create-attached-followup-chain.ts",
  "tests/e2e/support/get-post-schedule.ts",
]);

type SupportScriptTaskInput = {
  script?: string;
  args?: string[];
  env?: Record<string, string>;
};

// Cypress 16 removed cy.exec(). These scripts stay in Node, with an allowlist
// so the browser task cannot run an arbitrary command.
function runSupportScriptTask(
  input: SupportScriptTaskInput
): Promise<{ code: number; stdout: string; stderr: string }> {
  const script = input.script ?? "";
  if (!SUPPORT_SCRIPTS.has(script)) {
    return Promise.resolve({
      code: 1,
      stdout: "",
      stderr: "Refusing to run a script outside the e2e support allowlist",
    });
  }

  const args = (input.args ?? []).map(String);
  if (args.some((arg) => arg.length > 500 || /[\r\n\0]/.test(arg))) {
    return Promise.resolve({
      code: 1,
      stdout: "",
      stderr: "Refusing to run a support script with an invalid argument",
    });
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    E2E_TEST: "true",
    NODE_ENV: process.env["NODE_ENV"] ?? "test",
  };
  for (const [key, value] of Object.entries(input.env ?? {})) {
    if (typeof value === "string") env[key] = value;
  }

  return new Promise((resolveTask) => {
    execFile(
      "npx",
      ["tsx", script, ...args],
      { cwd: process.cwd(), env, encoding: "utf8", timeout: 60_000 },
      (error, stdout, stderr) => {
        const exitCode =
          error &&
          typeof error === "object" &&
          "code" in error &&
          typeof error.code === "number"
            ? error.code
            : error
              ? 1
              : 0;
        resolveTask({
          code: exitCode,
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
        });
      }
    );
  });
}

// Load environment variables from .env file
config({ path: resolve(import.meta.dirname, ".env") });

export default defineConfig({
  expose: {
    ALLOW_HYDRATION_EXCEPTIONS:
      process.env["ALLOW_HYDRATION_EXCEPTIONS"] ?? "false",
  },
  retries: {
    runMode: 1,
    openMode: 0,
  },
  e2e: {
    specPattern: [
      "tests/e2e/smoke/**/*.cy.ts",
      "tests/e2e/core/**/*.cy.ts",
      "tests/e2e/extended/**/*.cy.ts",
    ],
    supportFile: "tests/e2e/support/e2e.ts",
    fixturesFolder: "tests/e2e/fixtures",
    screenshotsFolder: "tests/e2e/screenshots",
    setupNodeEvents: (on, config) => {
      // Keep a single default port across local and CI runs.
      const port = process.env["PORT"] ?? "3000";
      const configOverrides: Partial<Cypress.PluginConfigOptions> = {
        baseUrl: `http://localhost:${port}`,
        screenshotOnRunFailure: true,
        env: {
          ...config.env,
          DATABASE_URL:
            process.env["DATABASE_URL"] ?? process.env["TEST_DATABASE_URL"],
          SESSION_SECRET: process.env["SESSION_SECRET"],
          NOSTR_PUBLISHER_URL: process.env["NOSTR_PUBLISHER_URL"],
          REDIS_URL: process.env["REDIS_URL"],
          ALLOW_HYDRATION_EXCEPTIONS:
            process.env["ALLOW_HYDRATION_EXCEPTIONS"] ?? "false",
        },
      };

      // To use this:
      // cy.task('log', whateverYouWantInTheTerminal)
      on("task", {
        log: (message) => {
          console.log(message);

          return null;
        },
        runSupportScript: runSupportScriptTask,
      });

      return { ...config, ...configOverrides };
    },
  },
});
