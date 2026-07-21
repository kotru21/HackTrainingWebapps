-- Seed flag rows (values are training TRN{32 hex})
INSERT INTO secret_flags (name, value) VALUES
  ('sqli_flag', 'TRN{a2022222222222222222222222222222}')
ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;
