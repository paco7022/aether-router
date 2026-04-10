-- ============================================================
-- Nano provider (na/ prefix)
-- Every user gets 200k daily free tokens across all na/ models,
-- resets at UTC midnight, then pay-as-you-go with a 5% margin
-- over upstream cost.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output, margin, is_active, premium_request_cost
) VALUES
  ('na/kimi-k2.5',          'nano', 'moonshotai/kimi-k2.5',            'Kimi K2.5',            0.24, 1.52, 1.05, true, 0),
  ('na/kimi-k2.5-thinking', 'nano', 'moonshotai/kimi-k2.5:thinking',   'Kimi K2.5 Thinking',   0.24, 1.52, 1.05, true, 0),
  ('na/glm-4.7',            'nano', 'zai-org/glm-4.7',                 'GLM 4.7',              0.13, 0.68, 1.05, true, 0),
  ('na/glm-5',              'nano', 'zai-org/glm-5',                   'GLM 5',                0.26, 2.17, 1.05, true, 0),
  ('na/deepseek-v3-0324',   'nano', 'deepseek-v3-0324',                'DeepSeek V3 0324',     0.09, 0.36, 1.05, true, 0),
  ('na/deepseek-r1-0528',   'nano', 'deepseek-ai/DeepSeek-R1-0528',    'DeepSeek R1 0528',     0.34, 1.44, 1.05, true, 0)
ON CONFLICT (id) DO UPDATE SET
  provider = EXCLUDED.provider,
  upstream_model_id = EXCLUDED.upstream_model_id,
  display_name = EXCLUDED.display_name,
  cost_per_m_input = EXCLUDED.cost_per_m_input,
  cost_per_m_output = EXCLUDED.cost_per_m_output,
  margin = EXCLUDED.margin,
  is_active = EXCLUDED.is_active,
  premium_request_cost = EXCLUDED.premium_request_cost;
