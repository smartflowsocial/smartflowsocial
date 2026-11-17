-- Campaign payouts can be in flight or have an unknown wallet result.
-- `paying` and `unknown` stay out of automatic retry.
-- PostgreSQL allows this ALTER TYPE inside the migration transaction, and the
-- new values are not used until a later statement commits.

ALTER TYPE "PayoutItemStatus" ADD VALUE IF NOT EXISTS 'paying';
ALTER TYPE "PayoutItemStatus" ADD VALUE IF NOT EXISTS 'unknown';
ALTER TYPE "PayoutAttemptStatus" ADD VALUE IF NOT EXISTS 'unknown';

-- One invoice payment hash can belong to only one campaign payout item.
-- Items that have not been submitted keep a null hash, and Postgres unique
-- indexes allow more than one null.
CREATE UNIQUE INDEX IF NOT EXISTS "PayoutItem_paymentHash_key" ON "PayoutItem"("paymentHash");
