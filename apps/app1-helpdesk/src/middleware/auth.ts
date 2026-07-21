import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AppConfig } from '../config';
import { logEvent } from '@hacktraining/shared';
import type { AuthUser } from '../types';

interface HelpdeskTokenClaims {
  sub: number;
  username: string;
  role: 'user' | 'admin';
  iat?: number;
}

function readToken(req: Request, config: AppConfig): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookie = req.cookies?.[config.jwtCookieName] as string | undefined;
  return cookie;
}

export function signToken(user: AuthUser, config: AppConfig): string {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: '8h' },
  );
}

export function optionalAuth(config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = readToken(req, config);
    if (!token) {
      next();
      return;
    }
    try {
      const payload = jwt.verify(token, config.jwtSecret) as unknown as HelpdeskTokenClaims;
      req.user = {
        id: Number(payload.sub),
        username: payload.username,
        role: payload.role,
      };
      logEvent(req.ctx.logger, {
        event: 'auth.token.verified',
        reqId: req.ctx.reqId,
        route: `${req.method} ${req.path}`,
        userId: Number(payload.sub),
        srcIp: req.ip,
        meta: { role: payload.role, iat: payload.iat ?? null, username: payload.username },
      });
    } catch {
      // Invalid token — leave unauthenticated; routes decide 401
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

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    logEvent(req.ctx.logger, {
      event: 'authz.deny',
      reqId: req.ctx.reqId,
      route: `${req.method} ${req.path}`,
      userId: req.user?.id ?? null,
      srcIp: req.ip,
      status: 403,
      meta: { reason: 'admin_required' },
    });
    res.status(403).json({ error: 'admin required' });
    return;
  }
  logEvent(req.ctx.logger, {
    event: 'authz.allow',
    reqId: req.ctx.reqId,
    route: `${req.method} ${req.path}`,
    userId: req.user.id,
    srcIp: req.ip,
    status: 200,
    meta: { role: 'admin' },
  });
  next();
}
