-- Databases that already had creator/pro kept the older basic/premium rows.
-- Point every billing reference at the canonical id, then delete the leftover
-- plan. A row that still has a subscription is hidden instead of deleted.

UPDATE "Subscription"
SET "plan" = 'creator', "updatedAt" = now()
WHERE "plan" = 'basic';

UPDATE "Subscription"
SET "plan" = 'pro', "updatedAt" = now()
WHERE "plan" = 'premium';

UPDATE "SubscriptionNotificationAttempt"
SET "planId" = 'creator', "updatedAt" = now()
WHERE "planId" = 'basic';

UPDATE "SubscriptionNotificationAttempt"
SET "planId" = 'pro', "updatedAt" = now()
WHERE "planId" = 'premium';

UPDATE "Subscription"
SET
  "metadata" = jsonb_set("metadata"::jsonb, '{scheduledPlanId}', '"creator"', false),
  "updatedAt" = now()
WHERE "metadata" IS NOT NULL
  AND jsonb_typeof("metadata"::jsonb) = 'object'
  AND "metadata"::jsonb ->> 'scheduledPlanId' = 'basic';

UPDATE "Subscription"
SET
  "metadata" = jsonb_set("metadata"::jsonb, '{scheduledPlanId}', '"pro"', false),
  "updatedAt" = now()
WHERE "metadata" IS NOT NULL
  AND jsonb_typeof("metadata"::jsonb) = 'object'
  AND "metadata"::jsonb ->> 'scheduledPlanId' = 'premium';

UPDATE "Subscription"
SET "planId" = 'creator', "updatedAt" = now()
WHERE "planId" = 'basic'
  AND EXISTS (SELECT 1 FROM "Plan" WHERE id = 'creator');

UPDATE "Subscription"
SET "planId" = 'pro', "updatedAt" = now()
WHERE "planId" = 'premium'
  AND EXISTS (SELECT 1 FROM "Plan" WHERE id = 'pro');

-- No canonical row yet: rename. PlanPrice and Subscription.planId follow ON UPDATE CASCADE.
UPDATE "Plan"
SET id = 'creator', "updatedAt" = now()
WHERE id = 'basic'
  AND NOT EXISTS (SELECT 1 FROM "Plan" WHERE id = 'creator');

UPDATE "Plan"
SET id = 'pro', "updatedAt" = now()
WHERE id = 'premium'
  AND NOT EXISTS (SELECT 1 FROM "Plan" WHERE id = 'pro');

UPDATE "PlanPrice"
SET "isActive" = false, "updatedAt" = now()
WHERE "planId" IN ('basic', 'premium');

DELETE FROM "Plan"
WHERE id = 'basic'
  AND EXISTS (SELECT 1 FROM "Plan" WHERE id = 'creator')
  AND NOT EXISTS (SELECT 1 FROM "Subscription" WHERE "planId" = 'basic');

DELETE FROM "Plan"
WHERE id = 'premium'
  AND EXISTS (SELECT 1 FROM "Plan" WHERE id = 'pro')
  AND NOT EXISTS (SELECT 1 FROM "Subscription" WHERE "planId" = 'premium');

UPDATE "Plan"
SET
  "purchasable" = false,
  "visibleOnPricingPage" = false,
  "isActive" = false,
  "updatedAt" = now()
WHERE id IN ('basic', 'premium');
