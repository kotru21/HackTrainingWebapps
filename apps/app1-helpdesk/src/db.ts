import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import type { AppConfig } from './config';
import type { Logger } from '@hacktraining/shared';

let pool: Pool | undefined;

export function initDb(config: AppConfig, logger: Logger): Pool {
  pool = new Pool({ connectionString: config.databaseUrl });
  pool.on('error', (err) => {
    logger.error({ err }, 'postgres pool error');
  });
  return pool;
}

export function getPool(): Pool {
  if (!pool) throw new Error('Database pool not initialized');
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function checkDbReady(): Promise<boolean> {
  try {
    await query('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}
