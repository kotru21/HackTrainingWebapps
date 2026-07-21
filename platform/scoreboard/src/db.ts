import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';

export async function migrate(pool: Pool): Promise<void> {
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
}
