import { createLogger } from '@hacktraining/shared';
import { loadPlanterConfig } from './config';
import { startHealthServer } from './health';
import { closePlantPools, runTick } from './plant';

const log = createLogger({ service: 'flag-planter', team: 'platform' });

async function shutdown(): Promise<void> {
  try {
    await closePlantPools();
  } catch (err) {
    log.warn({ err, event: 'shutdown.pools' }, 'error closing plant pools');
  }
}

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  const cfg = loadPlanterConfig();
  const healthPort = Number(process.env.HEALTH_PORT ?? '3021');
  if (!once) {
    startHealthServer(healthPort, 'flag-planter');
    log.info({ event: 'bootstrap', healthPort }, 'health server listening');
  }

  const tick = async (): Promise<void> => {
    try {
      const n = await runTick(cfg);
      log.info({ event: 'tick.done', tick: n }, 'planter tick complete');
    } catch (err) {
      log.error({ err, event: 'tick.fail' }, 'planter tick failed');
      if (once) {
        await shutdown();
        process.exit(1);
      }
    }
  };

  // Optional startup delay so depends_on apps finish seeding
  const delayMs = Number(process.env.STARTUP_DELAY_MS ?? '0');
  if (delayMs > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  await tick();
  if (once) {
    await shutdown();
    return;
  }

  setInterval(() => {
    void tick();
  }, cfg.tick_seconds * 1000);

  const onSignal = (): void => {
    void shutdown().finally(() => process.exit(0));
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  log.info(
    { event: 'bootstrap', tick_seconds: cfg.tick_seconds },
    'flag-planter looping',
  );
}

main().catch(async (err) => {
  log.error({ err }, 'flag-planter failed');
  await shutdown();
  process.exit(1);
});
