import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logEvent } from '@hacktraining/shared';
import type { AppConfig } from '../config';
import { writeAudit, type AuthUser } from '../context';

interface Claims {
  sub: number;
  username: string;
  role: 'user' | 'admin';
}

export function signToken(user: AuthUser, config: AppConfig): string {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: '8h' },
  );
}

function readToken(req: Request, config: AppConfig): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return req.cookies?.[config.jwtCookieName] as string | undefined;
}

export function optionalAuth(config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = readToken(req, config);
    if (!token) return next();
    try {
      const p = jwt.verify(token, config.jwtSecret) as unknown as Claims;
      req.user = { id: Number(p.sub), username: p.username, role: p.role };
      logEvent(req.ctx.logger, {
        event: 'auth.token.verified',
        reqId: req.ctx.reqId,
        route: `${req.method} ${req.path}`,
        userId: req.user.id,
        srcIp: req.ip,
        meta: { role: p.role, username: p.username },
      });
    } catch {
      logEvent(req.ctx.logger, {
        event: 'auth.token.forged',
        reqId: req.ctx.reqId,
        route: `${req.method} ${req.path}`,
        srcIp: req.ip,
        meta: { reason: 'verify_failed' },
      });
      void writeAudit(config, {
        actor: null,
        event: 'auth.token.forged',
        route: `${req.method} ${req.path}`,
        srcIp: req.ip,
        detail: { reason: 'verify_failed' },
      });
    }
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }
  next();
}

export function requireAdmin(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || req.user.role !== 'admin') {
      logEvent(req.ctx.logger, {
        event: 'authz.deny',
        reqId: req.ctx.reqId,
        route: `${req.method} ${req.path}`,
        userId: req.user?.id ?? null,
        srcIp: req.ip,
        status: 403,
      });
      void writeAudit(config, {
        actor: req.user ? String(req.user.id) : null,
        event: 'authz.deny',
        route: `${req.method} ${req.path}`,
        srcIp: req.ip,
        detail: { reason: 'admin_required' },
      });
      res.status(403).json({ error: 'admin required' });
      return;
    }
    next();
  };
}
