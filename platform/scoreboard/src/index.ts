import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import { createLogger } from '@hacktraining/shared';
import { loadConfig } from './config';
import { migrate } from './db';
import { createApp } from './app';
import { bumpTick, ensureRound, getActiveRound } from './scoring';

loadDotenv({ path: path.resolve(__dirname, '..', '.env') });

const log = createLogger({ service: 'scoreboard', team: 'platform' });

async function main(): Promise<void> {
  const cfg = loadConfig();
  const databaseUrl =
    process.env.DATABASE_URL ??
    'postgres://scoreboard:scoreboard@127.0.0.1:5435/scoreboard';

  const pool = new Pool({ connectionString: databaseUrl });
  await migrate(pool);
  // Idempotent: resume active round from PVC-backed DB, or create next/first round.
  await ensureRound(pool, Object.keys(cfg.team_tokens));

  const app = createApp(pool, cfg);
  const port = Number(process.env.PORT ?? 3020);
  app.listen(port, '0.0.0.0', () => {
    log.info({ event: 'bootstrap', port }, 'scoreboard listening');
  });

  // Scoreboard is the single tick clock. Planter/checker only read current_tick.
  setInterval(() => {
    void (async () => {
      try {
        const round = await getActiveRound(pool);
        if (!round) return;
        const updated = await bumpTick(pool);
        log.info(
          { event: 'tick.bump', tick: updated.current_tick, round: updated.n },
          'tick advanced',
        );
      } catch (err) {
        log.error({ err, event: 'tick.fail' }, 'tick bump failed');
      }
    })();
  }, cfg.tick_seconds * 1000);
}

main().catch((err) => {
  log.error({ err }, 'scoreboard failed');
  process.exit(1);
});
