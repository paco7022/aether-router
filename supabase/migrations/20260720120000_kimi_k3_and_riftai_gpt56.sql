-- ============================================================
-- New models 2026-07-20
--
-- 1) Kimi K3 on both premium resellers that carry it upstream:
--      oc/ (opencode, GET https://opencode.ai/zen/go/v1/models -> "kimi-k3")
--      r/  (riftai,   GET https://riftai.su/v1/models          -> "kimi-k3")
--    Owner-set tier: x5 premium requests (above the K2.x rows, which sit at
--    3 on oc/ and 1 on r/ — K3 is the new flagship Moonshot model).
--
-- 2) RiftAI (r/) GPT-5.6 family, all three confirmed live in the r/ catalog:
--      gpt-5.6-luna  -> x3   (same tier as sh/gpt-5.6-luna)
--      gpt-5.6-terra -> x8
--      gpt-5.6-sol   -> x15  (flagship)
--
-- Premium-pool providers: per-token cost_per_m stays 0 (billing is flat
-- 1 credit/request + premium_request_cost against the daily pool; these
-- resellers also inflate reported input tokens, so per-token would be wrong).
--
-- payg_credits_per_m_* (opt-in pay-as-you-go mode only) follows the class
-- convention: Kimi = 300/2000 (same as oc/r kimi-k2.x). GPT-5.x base is
-- 2000/30000 (r/gpt-5.5, sh/gpt-5.6-luna); terra and sol are scaled by the
-- same ratio as their request tiers so PAYG users don't get the expensive
-- variants at flagship-lite prices.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost,
  payg_credits_per_m_input, payg_credits_per_m_output,
  capabilities
) VALUES
  -- Kimi K3
  ('oc/kimi-k3',      'opencode', 'kimi-k3',       'Kimi K3',        0, 0, 0, 0, 1.0000, true,  5.00,   300,   2000, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('r/kimi-k3',       'riftai',   'kimi-k3',       'Kimi K3',        0, 0, 0, 0, 1.0000, true,  5.00,   300,   2000, '["tool_calling", "streaming", "system_message"]'::jsonb),
  -- RiftAI GPT-5.6 family
  ('r/gpt-5.6-luna',  'riftai',   'gpt-5.6-luna',  'GPT-5.6 Luna',   0, 0, 0, 0, 1.5500, true,  3.00,  2000,  30000, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('r/gpt-5.6-terra', 'riftai',   'gpt-5.6-terra', 'GPT-5.6 Terra',  0, 0, 0, 0, 1.5500, true,  8.00,  5300,  80000, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('r/gpt-5.6-sol',   'riftai',   'gpt-5.6-sol',   'GPT-5.6 Sol',    0, 0, 0, 0, 1.5500, true, 15.00, 10000, 150000, '["tool_calling", "streaming", "system_message"]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  provider                  = EXCLUDED.provider,
  upstream_model_id         = EXCLUDED.upstream_model_id,
  display_name              = EXCLUDED.display_name,
  cost_per_m_input          = EXCLUDED.cost_per_m_input,
  cost_per_m_output         = EXCLUDED.cost_per_m_output,
  cost_per_m_cache_read     = EXCLUDED.cost_per_m_cache_read,
  cost_per_m_cache_write    = EXCLUDED.cost_per_m_cache_write,
  margin                    = EXCLUDED.margin,
  is_active                 = EXCLUDED.is_active,
  premium_request_cost      = EXCLUDED.premium_request_cost,
  payg_credits_per_m_input  = EXCLUDED.payg_credits_per_m_input,
  payg_credits_per_m_output = EXCLUDED.payg_credits_per_m_output,
  capabilities              = EXCLUDED.capabilities;
