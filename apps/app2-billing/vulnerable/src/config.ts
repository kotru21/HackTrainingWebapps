import path from 'node:path';

export interface AppConfig {
  port: number;
  team: string;
  nodeEnv: string;
  databaseUrl: string;
  jwtSecret: string;
  jwtCookieName: string;
  viewsDir: string;
  publicDir: string;
  sharedPublicDir: string;
}

/** Training-weak secrets that must not survive into a production run. */
const WEAK_SECRETS = new Set(['', 'change-me', 'secret', 'billing-secret', 'billing-secret-ref']);

export function loadConfig(): AppConfig {
  const root = path.join(__dirname, '..');
  const sharedRoot = path.join(root, '..', 'shared');
  const teamRaw = process.env.TEAM;
  const team = (teamRaw ?? '').trim();
  // SSRF flag delivery depends on X-Stand-Team = TEAM; refuse empty/unset.
  if (!team) {
    throw new Error(
      'TEAM is required (empty/unset). SSRF metadata flags are keyed by stand TEAM.',
    );
  }
  const cfg: AppConfig = {
    port: Number(process.env.PORT ?? '3011'),
    team,
    nodeEnv: process.env.NODE_ENV ?? 'development',
    databaseUrl:
      process.env.DATABASE_URL ??
      'postgres://billing:billing@127.0.0.1:5434/billing',
    jwtSecret: process.env.JWT_SECRET ?? 'billing-secret',
    jwtCookieName: process.env.JWT_COOKIE_NAME ?? 'bill_token',
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
