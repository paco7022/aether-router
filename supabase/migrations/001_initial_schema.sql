-- ============================================================
-- Aether Router - Initial Schema
-- ============================================================

-- Profiles (extends Supabase Auth)
CREATE TABLE profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  display_name TEXT,
  credits      BIGINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- API Keys
CREATE TABLE api_keys (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key_hash   TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT 'Default',
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used  TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own keys" ON api_keys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own keys" ON api_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own keys" ON api_keys FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own keys" ON api_keys FOR DELETE USING (auth.uid() = user_id);

-- Models
CREATE TABLE models (
  id                TEXT PRIMARY KEY,
  provider          TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  cost_per_m_input  NUMERIC(10,4) NOT NULL,
  cost_per_m_output NUMERIC(10,4) NOT NULL,
  margin            NUMERIC(5,4) NOT NULL DEFAULT 1.55,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  context_length    INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active models" ON models FOR SELECT USING (is_active = true);

-- Usage Logs
CREATE TABLE usage_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id),
  api_key_id        UUID NOT NULL REFERENCES api_keys(id),
  model_id          TEXT NOT NULL,
  prompt_tokens     INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  total_tokens      INTEGER NOT NULL,
  credits_charged   BIGINT NOT NULL,
  cost_usd          NUMERIC(12,6) NOT NULL,
  status            TEXT NOT NULL DEFAULT 'success',
  duration_ms       INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_user_created ON usage_logs(user_id, created_at DESC);

ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own usage" ON usage_logs FOR SELECT USING (auth.uid() = user_id);

-- Transactions (credit ledger)
CREATE TABLE transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id),
  amount      BIGINT NOT NULL,
  balance     BIGINT NOT NULL,
  type        TEXT NOT NULL,
  reference   TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_user ON transactions(user_id, created_at DESC);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own transactions" ON transactions FOR SELECT USING (auth.uid() = user_id);

-- Atomic credit deduction function
CREATE OR REPLACE FUNCTION deduct_credits(p_user_id UUID, p_amount BIGINT)
RETURNS BIGINT AS $$
DECLARE
  new_balance BIGINT;
BEGIN
  UPDATE profiles
  SET credits = credits - p_amount, updated_at = now()
  WHERE id = p_user_id AND credits >= p_amount
  RETURNING credits INTO new_balance;

  IF NOT FOUND THEN
    RETURN -1;
  END IF;

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic credit addition function
CREATE OR REPLACE FUNCTION add_credits(p_user_id UUID, p_amount BIGINT)
RETURNS BIGINT AS $$
DECLARE
  new_balance BIGINT;
BEGIN
  UPDATE profiles
  SET credits = credits + p_amount, updated_at = now()
  WHERE id = p_user_id
  RETURNING credits INTO new_balance;

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Seed: api.airforce models
-- ============================================================
INSERT INTO models (id, provider, display_name, cost_per_m_input, cost_per_m_output) VALUES
  ('nemotron-3-super',               'airforce', 'Nemotron 3 Super',                1.30, 1.30),
  ('gpt-5.4',                        'airforce', 'GPT-5.4',                         1.50, 1.50),
  ('claude-sonnet-4.6-uncensored',   'airforce', 'Claude Sonnet 4.6 Uncensored',    1.50, 1.50),
  ('glm-5',                          'airforce', 'GLM-5',                           0.80, 0.80),
  ('minimax-m2.5',                   'airforce', 'MiniMax M2.5',                    1.50, 1.50),
  ('gemini-3-flash',                 'airforce', 'Gemini 3 Flash',                  0.20, 0.20),
  ('claude-sonnet-4.5-uncensored',   'airforce', 'Claude Sonnet 4.5 Uncensored',    1.00, 1.00),
  ('claude-opus-4.5-uncensored',     'airforce', 'Claude Opus 4.5 Uncensored',      3.00, 3.00),
  ('claude-opus-4.6-uncensored',     'airforce', 'Claude Opus 4.6 Uncensored',      2.50, 2.50),
  ('gemini-3-pro',                   'airforce', 'Gemini 3 Pro',                    2.20, 2.20),
  ('gemini-3.1-pro',                 'airforce', 'Gemini 3.1 Pro',                  2.20, 2.20),
  ('deepseek-r1',                    'airforce', 'DeepSeek R1',                     0.20, 0.20),
  ('deepseek-v3.2',                  'airforce', 'DeepSeek V3.2',                   0.01, 0.01),
  ('deepseek-v3.2-speciale',         'airforce', 'DeepSeek V3.2 Speciale',          0.10, 0.10),
  ('kimi-k2.5',                      'airforce', 'Kimi K2.5',                       0.60, 0.60),
  ('kimi-k2-0905',                   'airforce', 'Kimi K2 0905',                    0.10, 0.10),
  ('grok-4.1-fast-non-reasoning',    'airforce', 'Grok 4.1 Fast (Non-Reasoning)',   0.18, 0.18),
  ('grok-4.20-beta',                 'airforce', 'Grok 4.20 Beta',                  3.00, 3.00),
  ('mimo-v2-pro',                    'airforce', 'Mimo V2 Pro',                     0.40, 0.40);

-- ============================================================
-- Seed: gemini-cli models (via geminicli2api → Google account)
-- Prices = official Google API pricing x 0.75 (25% discount)
-- margin = 1.0 (discount already baked in, no additional markup)
-- ============================================================
INSERT INTO models (id, provider, display_name, cost_per_m_input, cost_per_m_output, margin) VALUES
  -- Gemini 2.5 Pro (official: $1.25 in / $10.00 out → x0.75)
  ('gemini-2.5-pro',                 'gemini-cli', 'Gemini 2.5 Pro',                  0.9375, 7.5000, 1.0),
  ('gemini-2.5-pro-nothinking',      'gemini-cli', 'Gemini 2.5 Pro (No Thinking)',    0.9375, 7.5000, 1.0),
  ('gemini-2.5-pro-search',          'gemini-cli', 'Gemini 2.5 Pro (Search)',         0.9375, 7.5000, 1.0),
  -- Gemini 2.5 Flash (official: $0.25 in / $1.50 out → x0.75, same as 3.1 flash)
  ('gemini-2.5-flash',               'gemini-cli', 'Gemini 2.5 Flash',               0.1875, 1.1250, 1.0),
  ('gemini-2.5-flash-nothinking',    'gemini-cli', 'Gemini 2.5 Flash (No Thinking)',  0.1875, 1.1250, 1.0),
  -- Gemini 3.0 Pro (official: $5.00 in / $12.00 out → x0.75, same as 3.1)
  ('gemini-3-pro-preview',           'gemini-cli', 'Gemini 3.0 Pro Preview',          3.7500, 9.0000, 1.0),
  ('gemini-3-flash-preview',         'gemini-cli', 'Gemini 3.0 Flash Preview',        0.1875, 1.1250, 1.0),
  -- Gemini 3.1 Pro (official: $5.00 in / $12.00 out → x0.75)
  ('gemini-3.1-pro-preview',         'gemini-cli', 'Gemini 3.1 Pro Preview',          3.7500, 9.0000, 1.0),
  ('gemini-3.1-flash-preview',       'gemini-cli', 'Gemini 3.1 Flash Preview',        0.1875, 1.1250, 1.0);
