/**
 * Apply migrations to the explicit test database.
 * Does not fall back to DATABASE_URL and does not run `db push --accept-data-loss`.
 */
import { spawnSync } from "node:child_process";

import { requireTestDatabaseUrl } from "../app/lib/test-database-target";

function main(): number {
  let decision: ReturnType<typeof requireTestDatabaseUrl>;
  try {
    decision = requireTestDatabaseUrl(process.env);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }

  process.stdout.write(`Applying migrations to ${decision.target}.\n`);
  const result = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: decision.url },
    stdio: "inherit",
  });
  if ((result.status ?? 1) !== 0) {
    process.stderr.write(
      "Migration failed. This command will not run prisma db push --accept-data-loss.\n"
    );
    if (decision.disposableLoopback) {
      process.stderr.write(
        "For an empty loopback test database, a destructive reset is separate: CONFIRM_DESTRUCTIVE_TEST_DB_RESET=reset-test-database pnpm test:db:reset\n"
      );
    }
    return result.status ?? 1;
  }
  return 0;
}

process.exit(main());
