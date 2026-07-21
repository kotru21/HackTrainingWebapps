import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export interface StandConfig {
  team: string;
  service: string;
  base_url: string;
  kind: 'billing' | 'helpdesk';
}

export interface CheckerConfig {
  tick_seconds: number;
  judge_token: string;
  stands: StandConfig[];
  scoreboard_url: string;
  timeout_ms: number;
}

export function loadCheckerConfig(): CheckerConfig {
  const configPath =
    process.env.SCOREBOARD_CONFIG ??
    path.resolve(__dirname, '..', '..', 'scoreboard', 'config.yaml');
  const raw = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  return {
    tick_seconds: Number(raw.tick_seconds ?? 60),
    judge_token: String(raw.judge_token ?? 'judge-token'),
    stands: (raw.stands as StandConfig[]) ?? [],
    scoreboard_url: process.env.SCOREBOARD_URL ?? 'http://127.0.0.1:3020',
    timeout_ms: Number(process.env.CHECKER_TIMEOUT_MS ?? 8000),
  };
}
