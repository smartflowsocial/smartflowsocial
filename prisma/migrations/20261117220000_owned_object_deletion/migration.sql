-- Durable owned-object deletion intents.
--
-- Account deletion used to drop media rows before object storage confirmed
-- the delete. These rows keep the object key, with no foreign key to "User",
-- so a storage outage can be retried after the account is gone and after the
-- worker restarts. Successful deletes remove the row. Failed and rejected
-- rows stay.

CREATE TYPE "OwnedObjectDeletionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REJECTED');

CREATE TABLE "OwnedObjectDeletion" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "OwnedObjectDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnedObjectDeletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OwnedObjectDeletion_idempotencyKey_key" ON "OwnedObjectDeletion"("idempotencyKey");

CREATE INDEX "OwnedObjectDeletion_status_nextAttemptAt_idx" ON "OwnedObjectDeletion"("status", "nextAttemptAt");

CREATE INDEX "OwnedObjectDeletion_accountId_status_idx" ON "OwnedObjectDeletion"("accountId", "status");
