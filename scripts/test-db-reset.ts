/**
 * Destructive schema reset for a loopback test database only.
 * Requires CONFIRM_DESTRUCTIVE_TEST_DB_RESET=reset-test-database.
 */
import { spawnSync } from "node:child_process";

import { requireTestDatabaseUrl } from "../app/lib/test-database-target";

const CONFIRMATION = "reset-test-database";

function main(): number {
  if (process.env["CONFIRM_DESTRUCTIVE_TEST_DB_RESET"] !== CONFIRMATION) {
    process.stderr.write(
      `Refusing to reset the schema. Set CONFIRM_DESTRUCTIVE_TEST_DB_RESET=${CONFIRMATION} for this command only.\n`
    );
    return 1;
  }

  let decision: ReturnType<typeof requireTestDatabaseUrl>;
  try {
    decision = requireTestDatabaseUrl(process.env);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }
  if (!decision.disposableLoopback) {
    process.stderr.write(
      `Refusing to reset ${decision.target}. Destructive reset is limited to a loopback database whose name identifies it as a test database.\n`
    );
    return 1;
  }

  process.stdout.write(`Resetting schema on ${decision.target}.\n`);
  const result = spawnSync(
    "pnpm",
    ["exec", "prisma", "db", "push", "--accept-data-loss"],
    {
      env: { ...process.env, DATABASE_URL: decision.url },
      stdio: "inherit",
    }
  );
  return result.status ?? 1;
}

process.exit(main());
