import type { Prisma } from "@prisma/client";

import { singleFlight } from "~/features/payments/finalization-invoice-guard";
import { prisma } from "~/lib/prisma.server";

const FINALIZATION_CREATE_LOCK_MS = 70_000;

/**
 * One create for a campaign configuration.
 * Callers in this process share the in-flight result. Callers in other
 * processes take the same Postgres advisory lock, so only one of them asks
 * the wallet. The lock is held until the invoice row commits.
 */
export async function runLockedFinalizationCreate<T>(
  lockKey: string,
  run: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return singleFlight(lockKey, async () =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            ('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint
          )
        `;
        return run(tx as unknown as Prisma.TransactionClient);
      },
      { timeout: FINALIZATION_CREATE_LOCK_MS, maxWait: 15_000 }
    )
  );
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
