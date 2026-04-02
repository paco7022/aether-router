-- ============================================================
-- Stripe Integration
-- ============================================================

-- Add Stripe customer ID to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;

-- Add Stripe price IDs to plans and credit_packages
ALTER TABLE plans ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
ALTER TABLE credit_packages ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;

-- Index for fast customer lookup
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer ON profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Index for webhook subscription lookup
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
