import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { loadConfig } from './config';
import { createAppLogger } from './types';
import { initDb } from './db';
import { createApp } from './app';
import { migrateAndSeed } from './db/migrate';
import { startFlagMirror } from './flag-mirror';

/** Load variant .env when HELPDESK_ENV_FILE is set (vulnerable|reference paths). */
function loadEnvFile(): void {
  const explicit = process.env.HELPDESK_ENV_FILE;
  if (explicit && fs.existsSync(explicit)) {
    dotenv.config({ path: explicit });
    return;
  }
  const root = path.join(__dirname, '..');
  const fallback = path.join(root, '.env');
  if (fs.existsSync(fallback)) dotenv.config({ path: fallback });
}

async function main(): Promise<void> {
  loadEnvFile();
  const appRoot = path.join(__dirname, '..');
  const config = loadConfig(appRoot);
  const logger = createAppLogger(config);
  initDb(config, logger);

  await migrateAndSeed(config, logger);
  startFlagMirror(config, logger);

  const app = createApp(config, logger);
  app.listen(config.port, () => {
    logger.info(
      { event: 'bootstrap', port: config.port, nodeEnv: config.nodeEnv },
      'app1-helpdesk listening',
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
