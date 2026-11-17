import { execPath } from "node:process";

const BENIGN_MIGRATION_STDERR = [
  /^npm warn config production Use `--omit=dev` instead\.$/,
  /^Loaded Prisma config from .+\.$/,
  /^Prisma schema loaded from .+\.$/,
];

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Local Prisma CLI. Avoids npx, which warns when NODE_ENV=production. */
export function prismaMigrateDeployCommand(
  nodePath: string = execPath
): string {
  return `${shellQuote(nodePath)} ./node_modules/prisma/build/index.js migrate deploy`;
}

/**
 * Prisma writes its config notice to stderr. npm does the same for the
 * deprecated production config. Those lines are not a failed migration.
 */
export function reportableMigrationStderr(stderr: string): string {
  const withoutAnsi = stderr.replace(
    new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
    ""
  );
  return withoutAnsi
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter(
      (line) => !BENIGN_MIGRATION_STDERR.some((pattern) => pattern.test(line))
    )
    .join("\n");
}
