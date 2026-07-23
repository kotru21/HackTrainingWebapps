import { Router } from 'express';
import type { AppConfig } from '../config';
import { logEvent } from '@hacktraining/shared';
import { query } from '../db';

/**
 * Debug endpoint — gated solely by EXPOSE_DEBUG env (V1.3).
 * When enabled, leaks env/DB connection shape and the rotating CFG-LEAK flag.
 */
export function debugRouter(config: AppConfig): Router {
  const router = Router();

  router.get('/internal/debug', async (req, res) => {
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

    // CFG-LEAK scoring flag: the flag-planter rotates `leak_flag` into the stand DB each
    // tick. Surface it here so the debug leak is a capturable, scoring vuln. Fall back to
    // the static DEBUG_CANARY_FLAG when no planted row exists (dev / planter down).
    let canaryFlag: string | null = config.debugCanaryFlag || null;
    try {
      const leak = await query<{ value: string }>(
        `SELECT value FROM admin_secrets WHERE name = 'leak_flag'`,
      );
      if (leak.rows[0]?.value) {
        canaryFlag = leak.rows[0].value;
      }
    } catch {
      // ignore — fall back to the static canary
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
        // Rotating CFG-LEAK flag (falls back to static canary) — SPEC V1.3
        canary_flag: canaryFlag,
      },
      flagFilePath: config.flagFilePath,
    });
  });

  return router;
}
