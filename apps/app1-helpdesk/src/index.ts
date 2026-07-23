import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { loadConfig } from './config';
import { createAppLogger } from './types';
import { initDb } from './db';
import { createApp } from './app';
import { migrateAndSeed } from './db/migrate';
import { startFlagMirror } from './flag-mirror';

/**
 * Load the stand .env. In k8s the app runs from the workspace PVC, so this resolves to
 * /workspace/.env — the file Blue edits in code-server. `override: true` makes it win
 * over the container env, so a saved edit actually changes behaviour. Returns the path
 * loaded (for the hot-reload watcher).
 */
function loadEnvFile(): string | null {
  const explicit = process.env.HELPDESK_ENV_FILE;
  if (explicit && fs.existsSync(explicit)) {
    dotenv.config({ path: explicit, override: true });
    return explicit;
  }
  const fallback = path.join(__dirname, '..', '.env');
  if (fs.existsSync(fallback)) {
    dotenv.config({ path: fallback, override: true });
    return fallback;
  }
  return null;
}

/**
 * Hot-reload on stand .env edits. `tsx watch` only reruns on source-file changes, so when
 * the .env changes we bump the entry file's mtime, which triggers tsx to restart the
 * process — it then re-reads the .env with the new values. Dev/training only.
 */
function watchEnvForReload(envPath: string | null): void {
  if (!envPath || process.env.NODE_ENV === 'production') return;
  let pending = false;
  try {
    fs.watch(envPath, { persistent: false }, () => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        try {
          const now = new Date();
          fs.utimesSync(__filename, now, now);
        } catch {
          /* ignore — best effort */
        }
      }, 150);
    });
  } catch {
    /* .env may not exist yet — nothing to watch */
  }
}

async function main(): Promise<void> {
  const envPath = loadEnvFile();
  watchEnvForReload(envPath);
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
