-- Basic was only ever assigned manually for testing (no real Stripe
-- subscribers). Migrate any remaining holders down to free and drop the row.
UPDATE profiles
SET plan_id = 'free'
WHERE plan_id = 'basic';

DELETE FROM subscriptions
WHERE plan_id = 'basic';

DELETE FROM plans
WHERE id = 'basic';
