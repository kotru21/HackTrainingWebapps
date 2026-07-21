import { createLogger } from '@hacktraining/shared';
import { loadCheckerConfig } from './config';
import { runCheckerTick } from './check';
import { startHealthServer } from './health';

const log = createLogger({ service: 'checker', team: 'platform' });

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  const cfg = loadCheckerConfig();
  const healthPort = Number(process.env.HEALTH_PORT ?? '3022');
  if (!once) {
    startHealthServer(healthPort, 'checker');
    log.info({ event: 'bootstrap', healthPort }, 'health server listening');
  }

  const tick = async (): Promise<void> => {
    try {
      await runCheckerTick(cfg);
      log.info({ event: 'tick.done' }, 'checker tick complete');
    } catch (err) {
      log.error({ err, event: 'tick.fail' }, 'checker tick failed');
      if (once) process.exit(1);
    }
  };

  const delayMs = Number(process.env.STARTUP_DELAY_MS ?? '0');
  if (delayMs > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  await tick();
  if (once) return;

  setInterval(() => {
    void tick();
  }, cfg.tick_seconds * 1000);

  log.info({ event: 'bootstrap', tick_seconds: cfg.tick_seconds }, 'checker looping');
}

main().catch((err) => {
  log.error({ err }, 'checker failed');
  process.exit(1);
});
