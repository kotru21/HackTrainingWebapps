import { Router } from 'express';
import { logEvent } from '@hacktraining/shared';
import type { AppConfig } from '../config';
import { query } from '../db';
import { writeAudit } from '../context';
import { hashPassword, verifyPassword } from '../seed';
import { signToken } from '../middleware/auth';

export function authRoutes(config: AppConfig): Router {
  const r = Router();

  r.post('/api/login', async (req, res) => {
    const username = String(req.body?.username ?? '');
    const password = String(req.body?.password ?? '');
    const result = await query<{
      id: number;
      username: string;
      password_hash: string;
      role: 'user' | 'admin';
    }>('SELECT id, username, password_hash, role FROM users WHERE username = $1', [username]);
    const row = result.rows[0];
    const ok = row ? verifyPassword(password, row.password_hash) : false;
    if (!row || !ok) {
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
    const user = { id: row.id, username: row.username, role: row.role };
    const token = signToken(user, config);
    logEvent(req.ctx.logger, {
      event: 'auth.login.ok',
      reqId: req.ctx.reqId,
      route: 'POST /api/login',
      userId: user.id,
      srcIp: req.ip,
      status: 200,
      meta: { user: user.username, role: user.role },
    });
    // INTENTIONALLY WEAK — training only: no HttpOnly so XSS can steal cookie (V2.3)
    res.cookie(config.jwtCookieName, token, { httpOnly: false, sameSite: 'lax' });
    res.json({ token, user });
  });

  r.post('/api/register', async (req, res) => {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!username || !password) {
      res.status(400).json({ error: 'username and password required' });
      return;
    }
    try {
      const inserted = await query<{ id: number }>(
        `INSERT INTO users (username, password_hash, role, display_name)
         VALUES ($1, $2, 'user', $1) RETURNING id`,
        [username, hashPassword(password)],
      );
      res.status(201).json({ id: inserted.rows[0].id, username });
    } catch {
      res.status(409).json({ error: 'username taken' });
    }
  });

  /** V2.5 — predictable reset token from Date.now() */
  r.post('/api/reset/request', async (req, res) => {
    const username = String(req.body?.username ?? '');
    const user = await query<{ id: number }>(
      'SELECT id FROM users WHERE username = $1',
      [username],
    );
    if (!user.rows[0]) {
      res.json({ status: 'ok' });
      return;
    }
    const token = String(Date.now());
    await query(
      `UPDATE users SET reset_token = $2, reset_expires = (NOW() AT TIME ZONE 'utc') + INTERVAL '1 hour'
       WHERE id = $1`,
      [user.rows[0].id, token],
    );
    logEvent(req.ctx.logger, {
      event: 'reset.request',
      reqId: req.ctx.reqId,
      route: 'POST /api/reset/request',
      userId: user.rows[0].id,
      srcIp: req.ip,
      meta: { user: username },
    });
    await writeAudit(config, {
      actor: username,
      event: 'reset.request',
      route: 'POST /api/reset/request',
      srcIp: req.ip,
      detail: { user: username },
    });
    // Training leak: token returned (predictable anyway)
    res.json({ status: 'ok', resetToken: token });
  });

  r.post('/api/reset/confirm', async (req, res) => {
    const token = String(req.body?.token ?? '');
    const newPassword = String(req.body?.newPassword ?? '');
    const found = await query<{ id: number; username: string }>(
      `SELECT id, username FROM users
       WHERE reset_token = $1 AND reset_expires > (NOW() AT TIME ZONE 'utc')`,
      [token],
    );
    if (!found.rows[0] || !newPassword) {
      res.status(400).json({ error: 'invalid token' });
      return;
    }
    await query(
      `UPDATE users SET password_hash = $2, reset_token = NULL, reset_expires = NULL WHERE id = $1`,
      [found.rows[0].id, hashPassword(newPassword)],
    );
    logEvent(req.ctx.logger, {
      event: 'reset.consume',
      reqId: req.ctx.reqId,
      route: 'POST /api/reset/confirm',
      userId: found.rows[0].id,
      srcIp: req.ip,
      meta: { user: found.rows[0].username },
    });
    await writeAudit(config, {
      actor: found.rows[0].username,
      event: 'reset.consume',
      route: 'POST /api/reset/confirm',
      srcIp: req.ip,
      detail: { user: found.rows[0].username },
    });
    res.json({ status: 'ok' });
  });

  return r;
}
