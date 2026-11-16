/**
 * Checks a database that was created only by `prisma migrate deploy`.
 * It does not insert plans and it does not run `db push`.
 */
import { Client } from "pg";

const REQUIRED_PLANS = [
  "free",
  "starter",
  "creator",
  "pro",
  "founder",
  "teams",
] as const;

async function main(): Promise<number> {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    process.stderr.write("DATABASE_URL is required.\n");
    return 1;
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const migrations = await client.query<{
      migration_name: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }>(
      `SELECT migration_name, finished_at, rolled_back_at
       FROM "_prisma_migrations"
       ORDER BY finished_at NULLS LAST`
    );
    if (migrations.rowCount === 0) {
      throw new Error("No Prisma migrations were applied");
    }
    const unfinished = migrations.rows.filter(
      (row) => row.finished_at == null || row.rolled_back_at != null
    );
    if (unfinished.length > 0) {
      throw new Error(
        `Unfinished or rolled-back migrations: ${unfinished
          .map((row) => row.migration_name)
          .join(", ")}`
      );
    }

    const plans = await client.query<{ id: string }>(`SELECT id FROM "Plan"`);
    const ids = new Set(plans.rows.map((row) => row.id));
    const missing = REQUIRED_PLANS.filter((id) => !ids.has(id));
    if (missing.length > 0) {
      throw new Error(
        `migrate deploy did not insert plan rows: ${missing.join(", ")}`
      );
    }

    const index = await client.query<{ indexdef: string }>(
      `SELECT indexdef
       FROM pg_indexes
       WHERE indexname = 'PayoutItem_paymentHash_key'`
    );
    const definition = index.rows[0]?.indexdef ?? "";
    if (!/UNIQUE/i.test(definition)) {
      throw new Error("PayoutItem_paymentHash_key is missing or not unique");
    }

    const contests = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_name = 'ContestFinalizationPayment'`
    );
    if (contests.rowCount !== 1) {
      throw new Error("ContestFinalizationPayment was not created");
    }

    process.stdout.write(
      `Verified ${migrations.rowCount} migrations, plans ${REQUIRED_PLANS.join(", ")}, and PayoutItem_paymentHash_key.\n`
    );
    return 0;
  } finally {
    await client.end();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
