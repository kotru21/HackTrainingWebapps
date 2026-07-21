import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import type { Logger } from '@hacktraining/shared';
import type { AppConfig } from './config';

let pool: Pool | undefined;

export function initDb(config: AppConfig, logger: Logger): Pool {
  pool = new Pool({ connectionString: config.databaseUrl });
  pool.on('error', (err) => logger.error({ err }, 'pg pool error'));
  return pool;
}

export function getPool(): Pool {
  if (!pool) throw new Error('db not initialized');
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function checkDbReady(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
