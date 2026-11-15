const GENERATE_PLACEHOLDER =
  "postgresql://prisma-generate:unused@127.0.0.1:5432/prisma_generate_placeholder";

/**
 * `prisma generate` needs a URL string and does not connect.
 * migrate and db commands connect, so they must not inherit that placeholder.
 */
export function datasourceUrlForPrismaCommand(
  env: Record<string, string | undefined>,
  argv: readonly string[]
): string {
  const command = argv.join(" ");
  const connects = /\b(?:migrate|db)\b/.test(command);
  const configured = env["DATABASE_URL"]?.trim() ?? "";
  if (configured) return configured;
  if (connects) {
    throw new Error(
      "DATABASE_URL is required for Prisma migrate and db commands. Refusing the generate placeholder."
    );
  }
  return GENERATE_PLACEHOLDER;
}
