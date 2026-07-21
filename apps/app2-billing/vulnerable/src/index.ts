import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { loadConfig } from './config';
import { createAppLogger } from './context';
import { initDb } from './db';
import { migrateAndSeed } from './seed';
import { createApp } from './app';

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) dotenv.config({ path: envFile });

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createAppLogger(config);
  initDb(config, logger);
  await migrateAndSeed(logger);
  const app = createApp(config, logger);
  app.listen(config.port, () => {
    logger.info({ event: 'bootstrap', port: config.port }, 'app2-billing vulnerable listening');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
