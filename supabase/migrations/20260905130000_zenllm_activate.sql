-- ============================================================
-- ZenLLM (z/) — activación del catálogo relanzado
-- 2026-09-05
--
-- Se separa de 20260905120000 a propósito: aquella sembró los 13 modelos
-- con is_active=false porque el código con el gate `payg_only`, el recargo
-- `context_surcharge_per_10k` y el default OFF de ZENLLM_FREE_UNLIMITED aún
-- no estaba desplegado. Activarlos antes habría servido Opus/Fable zero-cost
-- y sin cap de contexto a ultra/ultimate/max sobre un upstream per-token.
--
-- Se aplica DESPUÉS del deploy (Cloudflare + PC) y con la key nueva cargada
-- en los dos nodos.
-- ============================================================

UPDATE models SET is_active = true
WHERE provider = 'zenllm'
  AND id IN (
    'z/claude-fable-5', 'z/claude-fable-5.1',
    'z/claude-opus-4.8', 'z/claude-opus-4.7', 'z/claude-opus-4.6',
    'z/claude-sonnet-5', 'z/claude-sonnet-4.6',
    'z/gpt-6-astra', 'z/gpt-5.6-terra', 'z/gpt-5.6-sol', 'z/gpt-5.6-luna',
    'z/gemini-3.1-pro', 'z/gemini-3.7-flash'
  );
