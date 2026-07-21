import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export interface StandConfig {
  team: string;
  service: string;
  base_url: string;
  database_url?: string;
  kind: 'billing' | 'helpdesk';
  flag_file_path?: string;
}

export interface ScoreboardConfig {
  tick_seconds: number;
  flag_ttl_ticks: number;
  defense_weight: number;
  first_blood_multiplier: number;
  submit_rate_limit_per_min: number;
  round_minutes: number;
  flag_regex: string;
  team_tokens: Record<string, string>;
  judge_token: string;
  flag_values: Record<string, number>;
  stands: StandConfig[];
  metadata_url: string;
  metadata_plant_token: string;
}

const DEFAULTS: Partial<ScoreboardConfig> = {
  tick_seconds: 60,
  flag_ttl_ticks: 3,
  defense_weight: 500,
  first_blood_multiplier: 1.5,
  submit_rate_limit_per_min: 20,
  round_minutes: 90,
};

export function resolveConfigPath(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  if (process.env.SCOREBOARD_CONFIG) return path.resolve(process.env.SCOREBOARD_CONFIG);
  return path.resolve(__dirname, '..', 'config.yaml');
}

export function loadConfig(configPath?: string): ScoreboardConfig {
  const file = resolveConfigPath(configPath);
  const raw = yaml.load(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  const cfg = { ...DEFAULTS, ...raw } as ScoreboardConfig;
  if (!cfg.team_tokens || !cfg.flag_values || !cfg.stands) {
    throw new Error(`Invalid scoreboard config at ${file}`);
  }
  return cfg;
}

export function tokenToTeam(cfg: ScoreboardConfig, token: string | undefined): string | null {
  if (!token) return null;
  for (const [team, t] of Object.entries(cfg.team_tokens)) {
    if (t === token) return team;
  }
  return null;
}
