import type { Request, Response, NextFunction } from 'express';
import { createLogger, logEvent, newReqId, type Logger } from '@hacktraining/shared';
import type { AppConfig } from './config';

export interface RequestContext {
  reqId: string;
  logger: Logger;
}

declare global {
  namespace Express {
    interface Request {
      ctx: RequestContext;
      user?: AuthUser;
    }
  }
}

export interface AuthUser {
  id: number;
  username: string;
  role: 'user' | 'admin';
}

export function createAppLogger(config: AppConfig): Logger {
  return createLogger({ service: 'app1-helpdesk', team: config.team });
}

export function requestContextMiddleware(baseLogger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const reqId = (req.headers['x-request-id'] as string | undefined) || newReqId();
    const logger = baseLogger.child({ reqId });
    req.ctx = { reqId, logger };
    res.setHeader('X-Request-Id', reqId);
    const started = Date.now();
    res.on('finish', () => {
      logEvent(logger, {
        event: 'http.request',
        reqId,
        route: `${req.method} ${req.route?.path ?? req.path}`,
        userId: req.user?.id ?? null,
        srcIp: req.ip,
        status: res.statusCode,
        latMs: Date.now() - started,
        meta: { origin: req.get('origin') ?? null },
      });
    });
    next();
  };
}
