import { Router } from 'express';
import type { AppConfig } from '../config';
import { logEvent } from '@hacktraining/shared';

/**
 * Debug endpoint — gated solely by EXPOSE_DEBUG env (V1.3).
 * When enabled, leaks env/DB connection shape and canary flag.
 */
export function debugRouter(config: AppConfig): Router {
  const router = Router();

  router.get('/internal/debug', (req, res) => {
    logEvent(req.ctx.logger, {
      event: 'http.request',
      reqId: req.ctx.reqId,
      route: 'GET /internal/debug',
      srcIp: req.ip,
      status: config.exposeDebug ? 200 : 404,
      meta: { exposeDebug: config.exposeDebug },
    });

    if (!config.exposeDebug) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    // Canary flag is returned in body for training; never written to logs.
    res.json({
      service: 'app1-helpdesk',
      nodeEnv: config.nodeEnv,
      versions: process.versions,
      env: {
        NODE_ENV: config.nodeEnv,
        EXPOSE_DEBUG: config.exposeDebug,
        CORS_ORIGIN: config.corsOrigin,
        SECURITY_HEADERS: config.securityHeaders ? 'on' : 'off',
        SERVE_STATIC_ROOT: config.serveStaticRoot,
        TEAM: config.team,
      },
      database: {
        url: config.databaseUrl,
        // Canary embedded in debug DB block (SPEC V1.3)
        canary_flag: config.debugCanaryFlag || null,
      },
      flagFilePath: config.flagFilePath,
    });
  });

  return router;
}
