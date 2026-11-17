-- Fresh databases have no Plan rows. The next migration updates basic and premium
-- and inserts their prices. Those statements are no-ops or foreign-key failures
-- when the rows were only created by prisma/seed.ts.
-- Existing databases already have these ids, so the insert does nothing.

INSERT INTO "Plan" (
  id,
  name,
  price,
  description,
  features,
  "isActive",
  "sortOrder",
  "planBillingModel",
  "purchasable",
  "visibleOnPricingPage",
  "isComingSoon",
  "isSpecialOffering",
  "enableBasicScheduling",
  "createdAt",
  "updatedAt"
)
VALUES
  (
    'free',
    'Free',
    0,
    'Learn the system',
    '{}'::jsonb,
    true,
    10,
    'free',
    false,
    true,
    false,
    false,
    true,
    now(),
    now()
  ),
  (
    'basic',
    'Creator',
    7,
    'Creator plan',
    '{}'::jsonb,
    true,
    30,
    'recurring',
    true,
    true,
    false,
    false,
    true,
    now(),
    now()
  ),
  (
    'premium',
    'Pro',
    17,
    'Pro plan',
    '{}'::jsonb,
    true,
    40,
    'recurring',
    true,
    true,
    false,
    false,
    true,
    now(),
    now()
  ),
  (
    'founder',
    'Founder',
    899,
    'Founder plan',
    '{}'::jsonb,
    true,
    100,
    'lifetime',
    true,
    true,
    false,
    true,
    true,
    now(),
    now()
  ),
  (
    'teams',
    'Teams',
    0,
    'Teams plan',
    '{}'::jsonb,
    true,
    50,
    'disabled',
    false,
    false,
    true,
    false,
    true,
    now(),
    now()
  )
ON CONFLICT (id) DO NOTHING;
