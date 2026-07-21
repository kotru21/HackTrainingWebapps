import path from 'node:path';

export interface AppConfig {
  port: number;
  team: string;
  nodeEnv: string;
  databaseUrl: string;
  jwtSecret: string;
  jwtCookieName: string;
  adminFlag: string;
  viewsDir: string;
  publicDir: string;
  sharedPublicDir: string;
}

/** Training-weak secrets that must not survive into a production run. */
const WEAK_SECRETS = new Set(['', 'change-me', 'secret', 'billing-secret', 'billing-secret-ref']);

export function loadConfig(): AppConfig {
  const root = path.join(__dirname, '..');
  const sharedRoot = path.join(root, '..', 'shared');
  const cfg: AppConfig = {
    port: Number(process.env.PORT ?? '3012'),
    team: process.env.TEAM ?? 'dev',
    nodeEnv: process.env.NODE_ENV ?? 'development',
    databaseUrl:
      process.env.DATABASE_URL ??
      'postgres://billing:billing@127.0.0.1:5434/billing',
    jwtSecret: process.env.JWT_SECRET ?? 'billing-secret',
    jwtCookieName: process.env.JWT_COOKIE_NAME ?? 'bill_token',
    adminFlag: process.env.ADMIN_FLAG ?? 'TRN{a2044444444444444444444444444444}',
    viewsDir: path.join(root, 'views'),
    publicDir: path.join(root, 'public'),
    sharedPublicDir: path.join(sharedRoot, 'public'),
  };
  // Fail-closed: never boot production on a fallback/weak JWT secret.
  if (cfg.nodeEnv === 'production' && WEAK_SECRETS.has(cfg.jwtSecret)) {
    throw new Error('Refusing to start in production with a weak/empty JWT_SECRET.');
  }
  return cfg;
}
