import cors from 'cors';
import helmet from 'helmet';
import type { Express, RequestHandler } from 'express';
import type { AppConfig } from '../config';

export function applySecurityMiddleware(app: Express, config: AppConfig): void {
  if (config.securityHeaders) {
    app.use(
      helmet({
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            'script-src': ["'self'"],
            'frame-ancestors': ["'none'"],
          },
        },
        hsts: { maxAge: 31536000, includeSubDomains: true },
      }),
    );
  }

  let originOption: boolean | string | string[] = config.corsOrigin;
  if (config.corsOrigin === '*') {
    originOption = true;
  } else if (config.corsOrigin.includes(',')) {
    originOption = config.corsOrigin.split(',').map((o) => o.trim());
  }

  app.use(
    cors({
      origin: originOption,
      credentials: config.corsCredentials,
    }) as RequestHandler,
  );
}
