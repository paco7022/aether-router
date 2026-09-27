-- ad/ (Anthropic direct): real cache-write price, for usage_logs.cost_usd.
-- Was 0, so cache writes looked free in the logs. Anthropic bills 5-minute
-- cache writes at 1.25x the input price (1-hour writes at 2x; the system
-- prompt uses 1h, the conversation tail 5m — 1.25x is the closer average for
-- agent loops). Accounting only: the custom keys on ad/ are unbilled.
UPDATE models SET cost_per_m_cache_write = cost_per_m_input * 1.25
WHERE provider = 'anthropic';
