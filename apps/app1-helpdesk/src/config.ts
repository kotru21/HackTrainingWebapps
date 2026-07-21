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

export function loadConfig(appRoot: string = path.join(__dirname, '..')): AppConfig {
  const securityHeadersRaw = envString('SECURITY_HEADERS', 'off').toLowerCase();
  return {
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
}
