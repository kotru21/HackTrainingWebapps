import { Router } from 'express';
import type { AppConfig } from '../config';
import { findUserByUsername, toAuthUser, verifyPassword } from '../services/users';
import { signToken } from '../middleware/auth';
import { logEvent } from '@hacktraining/shared';

export function authRouter(config: AppConfig): Router {
  const router = Router();

  router.get('/login', (req, res) => {
    res.render('login', { error: null, user: req.user ?? null });
  });

  router.post('/login', async (req, res) => {
    const username = String(req.body?.username ?? '');
    const password = String(req.body?.password ?? '');
    const user = await findUserByUsername(username);
    const ok = user ? await verifyPassword(user, password) : false;

    if (!user || !ok) {
      logEvent(req.ctx.logger, {
        event: 'auth.login.fail',
        reqId: req.ctx.reqId,
        route: 'POST /login',
        srcIp: req.ip,
        status: 401,
        meta: { user: username },
      });
      if (req.accepts('html')) {
        res.status(401).render('login', { error: 'Invalid credentials', user: null });
        return;
      }
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const authUser = toAuthUser(user);
    const token = signToken(authUser, config);
    logEvent(req.ctx.logger, {
      event: 'auth.login.ok',
      reqId: req.ctx.reqId,
      route: 'POST /login',
      userId: authUser.id,
      srcIp: req.ip,
      status: 200,
      meta: { user: authUser.username, role: authUser.role },
    });

    res.cookie(config.jwtCookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production',
    });

    if (req.accepts('html') && !req.path.startsWith('/api')) {
      res.redirect(authUser.role === 'admin' ? '/admin' : '/tickets');
      return;
    }
    res.json({ token, user: authUser });
  });

  router.post('/api/login', async (req, res) => {
    req.headers.accept = 'application/json';
    const username = String(req.body?.username ?? '');
    const password = String(req.body?.password ?? '');
    const user = await findUserByUsername(username);
    const ok = user ? await verifyPassword(user, password) : false;
    if (!user || !ok) {
      logEvent(req.ctx.logger, {
        event: 'auth.login.fail',
        reqId: req.ctx.reqId,
        route: 'POST /api/login',
        srcIp: req.ip,
        status: 401,
        meta: { user: username },
      });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const authUser = toAuthUser(user);
    const token = signToken(authUser, config);
    logEvent(req.ctx.logger, {
      event: 'auth.login.ok',
      reqId: req.ctx.reqId,
      route: 'POST /api/login',
      userId: authUser.id,
      srcIp: req.ip,
      status: 200,
      meta: { user: authUser.username, role: authUser.role },
    });
    res.cookie(config.jwtCookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production',
    });
    res.json({ token, user: authUser });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(config.jwtCookieName);
    res.redirect('/login');
  });

  return router;
}
