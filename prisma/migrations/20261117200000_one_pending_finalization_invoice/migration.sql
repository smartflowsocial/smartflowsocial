-- Two simultaneous finalization requests must not leave two payable invoices
-- for the same campaign configuration. Keep the newest pending row and expire
-- any older duplicate before the unique index is created.

WITH ranked AS (
  SELECT
    id,
    "paymentId",
    ROW_NUMBER() OVER (
      PARTITION BY "contestId", "lockConfigHash"
      ORDER BY "createdAt" DESC
    ) AS n
  FROM "ContestFinalizationPayment"
  WHERE status = 'PENDING'
),
updated AS (
  UPDATE "ContestFinalizationPayment" AS row
  SET status = 'EXPIRED'
  FROM ranked
  WHERE row.id = ranked.id
    AND ranked.n > 1
  RETURNING ranked."paymentId"
)
UPDATE "Payment"
SET status = 'EXPIRED', "updatedAt" = CURRENT_TIMESTAMP
WHERE status = 'PENDING'
  AND id IN (
    SELECT "paymentId" FROM updated WHERE "paymentId" IS NOT NULL
  );

WITH ranked AS (
  SELECT
    id,
    "paymentId",
    ROW_NUMBER() OVER (
      PARTITION BY "giveawayId", "lockConfigHash"
      ORDER BY "createdAt" DESC
    ) AS n
  FROM "GiveawayFinalizationPayment"
  WHERE status = 'PENDING'
),
updated AS (
  UPDATE "GiveawayFinalizationPayment" AS row
  SET status = 'EXPIRED'
  FROM ranked
  WHERE row.id = ranked.id
    AND ranked.n > 1
  RETURNING ranked."paymentId"
)
UPDATE "Payment"
SET status = 'EXPIRED', "updatedAt" = CURRENT_TIMESTAMP
WHERE status = 'PENDING'
  AND id IN (
    SELECT "paymentId" FROM updated WHERE "paymentId" IS NOT NULL
  );

CREATE UNIQUE INDEX "ContestFinalizationPayment_one_pending_config"
  ON "ContestFinalizationPayment" ("contestId", "lockConfigHash")
  WHERE status = 'PENDING';

CREATE UNIQUE INDEX "GiveawayFinalizationPayment_one_pending_config"
  ON "GiveawayFinalizationPayment" ("giveawayId", "lockConfigHash")
  WHERE status = 'PENDING';
