-- Platform scoring schema (docs/scoring.md §5)
CREATE TABLE IF NOT EXISTS planted_flags (
  id SERIAL PRIMARY KEY,
  flag TEXT NOT NULL UNIQUE,
  team TEXT NOT NULL,
  service TEXT NOT NULL,
  vuln_id TEXT NOT NULL,
  tick INTEGER NOT NULL,
  planted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  submitter_team TEXT NOT NULL,
  flag TEXT NOT NULL,
  vuln_id TEXT,
  points INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  first_blood BOOLEAN NOT NULL DEFAULT false,
  src_ip TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submitter_team, flag)
);

CREATE TABLE IF NOT EXISTS sla_samples (
  id SERIAL PRIMARY KEY,
  team TEXT NOT NULL,
  service TEXT NOT NULL,
  tick INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('up', 'down', 'mumble')),
  latency_ms INTEGER,
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  excluded BOOLEAN NOT NULL DEFAULT false,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS rounds (
  id SERIAL PRIMARY KEY,
  n INTEGER NOT NULL UNIQUE,
  attacker_team TEXT NOT NULL,
  defender_team TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  current_tick INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_planted_flags_flag ON planted_flags(flag);
CREATE INDEX IF NOT EXISTS idx_submissions_team ON submissions(submitter_team);
CREATE INDEX IF NOT EXISTS idx_sla_samples_team_tick ON sla_samples(team, tick);
