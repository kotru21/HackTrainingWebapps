-- Seed flag rows (values are training TRN{32 hex}; planter overwrites each tick)
INSERT INTO secret_flags (name, value) VALUES
  ('sqli_flag', 'TRN{a2022222222222222222222222222222}'),
  ('admin_flag', 'TRN{a2044444444444444444444444444444}')
ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;
