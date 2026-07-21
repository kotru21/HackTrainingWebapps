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

/** Persist security event to security_audit (SPEC §7.2). Never put flags in detail. */
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
