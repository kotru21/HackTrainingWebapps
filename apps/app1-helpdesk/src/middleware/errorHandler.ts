import type { Request, Response, NextFunction } from 'express';
import type { AppConfig } from '../config';
import { logEvent } from '@hacktraining/shared';

export function errorHandler(config: AppConfig) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const error = err instanceof Error ? err : new Error(String(err));
    if (req.ctx?.logger) {
      logEvent(
        req.ctx.logger,
        {
          event: 'http.request',
          reqId: req.ctx.reqId,
          route: `${req.method} ${req.path}`,
          userId: req.user?.id ?? null,
          srcIp: req.ip,
          status: 500,
          meta: {
            errorName: error.name,
            hasStack: Boolean(error.stack),
          },
        },
        'unhandled error',
      );
    }

    if (config.nodeEnv === 'development') {
      res.status(500).json({
        error: error.message,
        stack: error.stack,
      });
      return;
    }
    res.status(500).json({ error: 'internal server error' });
  };
}
