-- The account-deletion transaction sets this while it holds the user row.
-- Upload finalization locks the same row and stops when the column is set.
ALTER TABLE "User" ADD COLUMN "deletionStartedAt" TIMESTAMP(3);
