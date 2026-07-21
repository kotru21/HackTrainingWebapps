import fs from 'node:fs';
import path from 'node:path';
import { generateFlag, type Logger } from '@hacktraining/shared';
import type { AppConfig } from '../config';
import { query } from '../db';
import { ensureSeedUsers } from '../services/users';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'closed')),
  owner_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS admin_secrets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS security_audit (
  id SERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
  team TEXT NOT NULL,
  actor TEXT,
  event TEXT NOT NULL,
  route TEXT,
  src_ip TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);
`;

export async function migrateAndSeed(config: AppConfig, logger: Logger): Promise<void> {
  await query(SCHEMA_SQL);
  await ensureSeedUsers(config.seedAdminPassword);

  // Seed rotating training flags. The flag-planter overwrites these each tick during
  // a scored round; the app is the source of truth for both delivery channels:
  //   round_flag -> admin_secrets, read via forged-admin JWT (CFG-JWT)
  //   rce_flag   -> mirrored to FLAG_FILE_PATH, read via the ejs RCE (CFG-RCE)
  const jwtFlag = generateFlag();
  const rceFlag = generateFlag();
  await query(
    `INSERT INTO admin_secrets (name, value)
     VALUES ('round_flag', $1), ('rce_flag', $2)
     ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
    [jwtFlag, rceFlag],
  );

  // Initial mirror of the RCE flag to the file the payload reads. The flag-mirror
  // loop (see startFlagMirror) keeps it in sync as the planter rotates rce_flag.
  try {
    fs.mkdirSync(path.dirname(config.flagFilePath), { recursive: true });
    fs.writeFileSync(config.flagFilePath, `${rceFlag}\n`, 'utf8');
  } catch (err) {
    logger.warn({ err }, 'could not seed flag file (ok if read-only root)');
  }

  logger.info({ event: 'bootstrap' }, 'schema migrated and seed applied');
}
