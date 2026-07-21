import type { Request, Response, NextFunction } from 'express';
import {
  createLogger,
  logEvent,
  newReqId,
  SECURITY_AUDIT_INSERT_SQL,
  toAuditParams,
  type Logger,
} from '@hacktraining/shared';
import type { AppConfig } from './config';
import { query } from './db';

export interface AuthUser {
  id: number;
  username: string;
  role: 'user' | 'admin';
}

declare global {
  namespace Express {
    interface Request {
      ctx: { reqId: string; logger: Logger };
      user?: AuthUser;
    }
  }
}

export function createAppLogger(config: AppConfig): Logger {
  return createLogger({ service: 'app2-billing', team: config.team });
}

export function requestContext(base: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const reqId = (req.headers['x-request-id'] as string) || newReqId();
    req.ctx = { reqId, logger: base.child({ reqId }) };
    res.setHeader('X-Request-Id', reqId);
    const t0 = Date.now();
    res.on('finish', () => {
      logEvent(req.ctx.logger, {
        event: 'http.request',
        reqId,
        route: `${req.method} ${req.route?.path ?? req.path}`,
        userId: req.user?.id ?? null,
        srcIp: req.ip,
        status: res.statusCode,
        latMs: Date.now() - t0,
      });
    });
    next();
  };
}

export async function writeAudit(
  config: AppConfig,
  fields: {
    actor: string | null;
    event: string;
    route: string;
    srcIp?: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await query(
    SECURITY_AUDIT_INSERT_SQL,
    toAuditParams({
      team: config.team,
      actor: fields.actor,
      event: fields.event,
      route: fields.route,
      src_ip: fields.srcIp ?? null,
      detail: fields.detail,
    }),
  );
}
