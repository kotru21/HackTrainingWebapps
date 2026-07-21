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

export interface PlanterConfig {
  tick_seconds: number;
  flag_ttl_ticks: number;
  judge_token: string;
  stands: StandConfig[];
  metadata_url: string;
  metadata_plant_token: string;
  scoreboard_url: string;
}

export function loadPlanterConfig(): PlanterConfig {
  const configPath =
    process.env.SCOREBOARD_CONFIG ??
    path.resolve(__dirname, '..', '..', 'scoreboard', 'config.yaml');
  const raw = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  return {
    tick_seconds: Number(raw.tick_seconds ?? 60),
    flag_ttl_ticks: Number(raw.flag_ttl_ticks ?? 3),
    judge_token: String(raw.judge_token ?? 'judge-token'),
    stands: (raw.stands as StandConfig[]) ?? [],
    metadata_url: String(raw.metadata_url ?? 'http://127.0.0.1:3099'),
    metadata_plant_token: String(raw.metadata_plant_token ?? 'metadata-plant-token'),
    scoreboard_url: process.env.SCOREBOARD_URL ?? 'http://127.0.0.1:3020',
  };
}
