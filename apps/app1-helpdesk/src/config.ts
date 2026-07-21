import path from 'node:path';

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function envString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

/**
 * All security-sensitive behaviour is driven by these env values.
 * vulnerable/ vs reference/ differ only in the values they supply — not in code branches by variant name.
 */
export interface AppConfig {
  port: number;
  team: string;
  nodeEnv: string;
  databaseUrl: string;
  jwtSecret: string;
  jwtCookieName: string;
  exposeDebug: boolean;
  corsOrigin: string;
  corsCredentials: boolean;
  securityHeaders: boolean;
  seedAdminPassword: string;
  serveStaticRoot: string;
  flagFilePath: string;
  debugCanaryFlag: string;
  viewsDir: string;
  publicDir: string;
}

/** Known training-weak values that must never survive into a production run. */
const WEAK_SECRETS = new Set(['', 'change-me', 'secret', 'billing-secret', 'password']);
const WEAK_ADMIN_PW = new Set(['', 'change-me', 'admin', 'admin123', 'password']);

/**
 * Fail-closed guard: in production, refuse to boot on a fallback/weak secret so a
 * misconfigured reference deploy cannot silently reintroduce V1.1/V1.5.
 * Vulnerable stands run NODE_ENV=development, so this never blocks the training vulns.
 */
function assertProdSecrets(cfg: AppConfig): void {
  if (cfg.nodeEnv !== 'production') return;
  const problems: string[] = [];
  if (WEAK_SECRETS.has(cfg.jwtSecret)) problems.push('JWT_SECRET is empty/weak');
  if (WEAK_ADMIN_PW.has(cfg.seedAdminPassword)) problems.push('SEED_ADMIN_PASSWORD is empty/weak');
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with insecure config: ${problems.join('; ')}. ` +
        'Inject strong values via env/Secret.',
    );
  }
}

export function loadConfig(appRoot: string = path.join(__dirname, '..')): AppConfig {
  const securityHeadersRaw = envString('SECURITY_HEADERS', 'off').toLowerCase();
  const cfg: AppConfig = {
    port: Number(envString('PORT', '3000')),
    team: envString('TEAM', 'dev'),
    nodeEnv: envString('NODE_ENV', 'development'),
    databaseUrl: envString(
      'DATABASE_URL',
      'postgres://helpdesk:helpdesk@127.0.0.1:5432/helpdesk',
    ),
    jwtSecret: envString('JWT_SECRET', 'change-me'),
    jwtCookieName: envString('JWT_COOKIE_NAME', 'hd_token'),
    exposeDebug: envBool('EXPOSE_DEBUG', false),
    corsOrigin: envString('CORS_ORIGIN', 'https://helpdesk.local'),
    corsCredentials: envBool('CORS_CREDENTIALS', true),
    securityHeaders: securityHeadersRaw === 'on' || securityHeadersRaw === 'true',
    seedAdminPassword: envString('SEED_ADMIN_PASSWORD', 'admin123'),
    serveStaticRoot: envString('SERVE_STATIC_ROOT', './public'),
    flagFilePath: envString('FLAG_FILE_PATH', '/flags/app1.flag'),
    debugCanaryFlag: envString('DEBUG_CANARY_FLAG', ''),
    viewsDir: path.join(appRoot, 'views'),
    publicDir: path.join(appRoot, 'public'),
  };
  assertProdSecrets(cfg);
  return cfg;
}
