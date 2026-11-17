-- Operators must not release a campaign payout while its NWC attempt can
-- still be running. The deadline is the pay wait, the reconciliation race,
-- the follow-up lookup, and a safety margin, computed when the attempt starts.
-- Rows created before this column use the maximum permitted budget instead.

ALTER TABLE "PayoutAttempt" ADD COLUMN "resolutionNotBefore" TIMESTAMP(3);
