-- ============================================================
-- Plans, Subscriptions & Credit Packages
-- ============================================================

-- Plans definition
CREATE TABLE plans (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  price_usd       NUMERIC(8,2) NOT NULL DEFAULT 0,
  credits_per_day INTEGER NOT NULL DEFAULT 0,
  credits_per_month INTEGER NOT NULL DEFAULT 0,
  bonus_pct       INTEGER NOT NULL DEFAULT 0,
  is_popular      BOOLEAN NOT NULL DEFAULT false,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active plans" ON plans FOR SELECT USING (is_active = true);

-- Credit packages (one-time purchases)
CREATE TABLE credit_packages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  credits     INTEGER NOT NULL,
  price_usd   NUMERIC(8,2) NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE credit_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active packages" ON credit_packages FOR SELECT USING (is_active = true);

-- Subscriptions
CREATE TABLE subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id                 TEXT NOT NULL REFERENCES plans(id),
  status                  TEXT NOT NULL DEFAULT 'active',
  current_period_start    TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  credits_granted_today   BOOLEAN NOT NULL DEFAULT false,
  last_grant_date         DATE,
  stripe_subscription_id  TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own subscriptions" ON subscriptions FOR SELECT USING (auth.uid() = user_id);

-- Add current plan to profiles for quick access
ALTER TABLE profiles ADD COLUMN plan_id TEXT REFERENCES plans(id) DEFAULT 'free';

-- ============================================================
-- Daily credit grant function
-- Called by cron or edge function once per day
-- ============================================================
CREATE OR REPLACE FUNCTION grant_daily_credits()
RETURNS INTEGER AS $$
DECLARE
  granted INTEGER := 0;
  sub RECORD;
BEGIN
  FOR sub IN
    SELECT s.id, s.user_id, p.credits_per_day
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.status = 'active'
      AND p.credits_per_day > 0
      AND (s.last_grant_date IS NULL OR s.last_grant_date < CURRENT_DATE)
  LOOP
    -- Add daily credits
    PERFORM add_credits(sub.user_id, sub.credits_per_day);

    -- Log transaction
    INSERT INTO transactions (user_id, amount, balance, type, description)
    SELECT sub.user_id, sub.credits_per_day, p.credits, 'daily_grant',
           'Daily plan credits'
    FROM profiles p WHERE p.id = sub.user_id;

    -- Mark as granted today
    UPDATE subscriptions
    SET last_grant_date = CURRENT_DATE,
        credits_granted_today = true,
        updated_at = now()
    WHERE id = sub.id;

    granted := granted + 1;
  END LOOP;

  -- Reset flag for tomorrow
  UPDATE subscriptions
  SET credits_granted_today = false
  WHERE credits_granted_today = true
    AND last_grant_date < CURRENT_DATE;

  RETURN granted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Seed: Plans
-- Base: $1 = 10,000 credits
-- Each tier = X% better value than buying credits directly
-- ============================================================
INSERT INTO plans (id, name, description, price_usd, credits_per_day, credits_per_month, bonus_pct, is_popular, sort_order) VALUES
  ('free',    'Free',    'Get started for free',       0,     400,    12000,    0, false, 0),
  ('basic',   'Basic',   'For casual users',           3,    1100,    33000,   10, false, 1),
  ('pro',     'Pro',     'Best value for daily use',   6,    2400,    72000,   20, true,  2),
  ('creator', 'Creator', 'For power users',           12,    5200,   156000,   30, false, 3),
  ('master',  'Master',  'Heavy usage, premium models',25,  11667,   350000,   40, false, 4),
  ('ultra',   'Ultra',   'Unlimited-style, all models',50,  25000,   750000,   50, false, 5);

-- ============================================================
-- Seed: Credit Packages (one-time purchase)
-- $1 = 10,000 credits, no bonus
-- ============================================================
INSERT INTO credit_packages (id, name, credits, price_usd, sort_order) VALUES
  ('10k',   '10K Credits',   10000,   1,  0),
  ('50k',   '50K Credits',   50000,   5,  1),
  ('100k',  '100K Credits', 100000,  10,  2);

-- Auto-subscribe new users to free plan
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name, plan_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'free'
  );

  -- Create free subscription
  INSERT INTO subscriptions (user_id, plan_id, status)
  VALUES (NEW.id, 'free', 'active');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
