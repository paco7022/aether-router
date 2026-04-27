-- ============================================================
-- Strip "(DLab)" suffix from db/ display_names. We don't expose
-- the upstream provider identity to end users.
-- ============================================================

UPDATE models
SET display_name = regexp_replace(display_name, '\s*\(DLab\)\s*$', '')
WHERE provider = 'dlab'
  AND display_name LIKE '%(DLab)%';
