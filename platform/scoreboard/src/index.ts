import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import { createLogger } from '@hacktraining/shared';
import { loadConfig } from './config';
import { migrate } from './db';
import { createApp } from './app';
import { ensureRound } from './scoring';

loadDotenv({ path: path.resolve(__dirname, '..', '.env') });

const log = createLogger({ service: 'scoreboard', team: 'platform' });

async function main(): Promise<void> {
  const cfg = loadConfig();
  const databaseUrl =
    process.env.DATABASE_URL ??
    'postgres://scoreboard:scoreboard@127.0.0.1:5435/scoreboard';

  const pool = new Pool({ connectionString: databaseUrl });
  await migrate(pool);
  await ensureRound(pool, Object.keys(cfg.team_tokens));

  const app = createApp(pool, cfg);
  const port = Number(process.env.PORT ?? 3020);
  app.listen(port, '0.0.0.0', () => {
    log.info({ event: 'bootstrap', port }, 'scoreboard listening');
  });
}

main().catch((err) => {
  log.error({ err }, 'scoreboard failed');
  process.exit(1);
});
