import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Logger } from '@hacktraining/shared';
import { query } from './db';

/** INTENTIONALLY WEAK — training only (V2.5 MD5) */
export function hashPassword(password: string): string {
  return createHash('md5').update(password).digest('hex');
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

const FLAGS = {
  IDOR: 'TRN{a2011111111111111111111111111111}',
  SQLI: 'TRN{a2022222222222222222222222222222}',
  XSS: 'TRN{a2033333333333333333333333333333}',
  MASSASSIGN: 'TRN{a2044444444444444444444444444444}',
  CRYPTO: 'TRN{a2055555555555555555555555555555}',
};

export async function migrateAndSeed(logger: Logger): Promise<void> {
  const schemaPath = path.join(__dirname, '..', '..', 'shared', 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await query(schema);

  await query(
    `INSERT INTO users (username, password_hash, role, display_name, bio, private_note)
     VALUES
       ('admin', $1, 'admin', 'Billing Admin', 'Ops', ''),
       ('alice', $2, 'user', 'Alice', 'Customer', ''),
       ('bob', $3, 'user', 'Bob Victim', 'Victim account', ''),
       ('carol', $4, 'user', 'Carol', 'Reset target', $5)
     ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       private_note = COALESCE(NULLIF(EXCLUDED.private_note, ''), users.private_note)`,
    [
      hashPassword('admin123'),
      hashPassword('alice123'),
      hashPassword('bob123'),
      hashPassword('carol123'),
      FLAGS.CRYPTO,
    ],
  );

  const bob = await query<{ id: number }>(`SELECT id FROM users WHERE username = 'bob'`);
  const alice = await query<{ id: number }>(`SELECT id FROM users WHERE username = 'alice'`);
  const bobId = bob.rows[0].id;
  const aliceId = alice.rows[0].id;

  await query(`DELETE FROM invoices WHERE owner_id = $1 AND title = 'Confidential retainer'`, [
    bobId,
  ]);
  await query(
    `INSERT INTO invoices (owner_id, title, amount_cents, status, memo)
     VALUES ($1, 'Confidential retainer', 99900, 'open', $2)`,
    [bobId, FLAGS.IDOR],
  );
  await query(
    `INSERT INTO invoices (owner_id, title, amount_cents, status, memo)
     SELECT $1, 'Alice office supplies', 4200, 'open', 'routine'
     WHERE NOT EXISTS (
       SELECT 1 FROM invoices WHERE owner_id = $1 AND title = 'Alice office supplies'
     )`,
    [aliceId],
  );

  await query(
    `INSERT INTO secret_flags (name, value) VALUES ('sqli_flag', $1), ('admin_flag', $2)
     ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
    [FLAGS.SQLI, FLAGS.MASSASSIGN],
  );

  await query(`DELETE FROM admin_notes`);
  await query(`INSERT INTO admin_notes (body) VALUES ($1)`, [
    `Private ops note containing ${FLAGS.XSS}`,
  ]);

  logger.info({ event: 'bootstrap' }, 'app2 vulnerable schema+seed ready');
}
