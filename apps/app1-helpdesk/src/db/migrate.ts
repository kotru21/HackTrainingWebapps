import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '@hacktraining/shared';
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

/** Training flag for forged-JWT / default-admin path (V1.1 / V1.5). */
const ADMIN_SECRET_FLAG = 'TRN{a1b2c3d4e5f60718293a4b5c6d7e8f90}';

export async function migrateAndSeed(config: AppConfig, logger: Logger): Promise<void> {
  await query(SCHEMA_SQL);
  await ensureSeedUsers(config.seedAdminPassword);

  await query(
    `INSERT INTO admin_secrets (name, value)
     VALUES ('round_flag', $1)
     ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
    [ADMIN_SECRET_FLAG],
  );

  // Ensure RCE target file exists for local/dev (planter replaces in real rounds)
  try {
    const flagDir = path.dirname(config.flagFilePath);
    fs.mkdirSync(flagDir, { recursive: true });
    if (!fs.existsSync(config.flagFilePath)) {
      const rceFlag = 'TRN{c0ffee1234567890abcdef1234567890}';
      fs.writeFileSync(config.flagFilePath, rceFlag, 'utf8');
    }
  } catch (err) {
    logger.warn({ err }, 'could not ensure flag file (ok if read-only root)');
  }

  logger.info({ event: 'bootstrap' }, 'schema migrated and seed applied');
}
