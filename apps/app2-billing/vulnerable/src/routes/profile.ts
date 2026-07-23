import { Router } from 'express';
import { logEvent } from '@hacktraining/shared';
import type { AppConfig } from '../config';
import { query } from '../db';
import { writeAudit } from '../context';
import { requireAuth, requireAdmin, signToken } from '../middleware/auth';

export function profileRoutes(config: AppConfig): Router {
  const r = Router();

  r.get('/api/profile', requireAuth, async (req, res) => {
    const result = await query(
      `SELECT id, username, role, display_name, avatar_url, bio, private_note
       FROM users WHERE id = $1`,
      [req.user!.id],
    );
    res.json({ user: result.rows[0] });
  });

  /** V2.4 Mass-assignment — Object.assign includes role (id stays from session) */
  r.patch('/api/profile', requireAuth, async (req, res) => {
    const targetId = req.user!.id;
    const current = await query<{
      id: number;
      username: string;
      role: string;
      display_name: string;
      avatar_url: string;
      bio: string;
    }>('SELECT id, username, role, display_name, avatar_url, bio FROM users WHERE id = $1', [
      targetId,
    ]);
    const user = current.rows[0];
    const beforeRole = user.role;
    Object.assign(user, req.body);
    // UPDATE always targets the authenticated user — body must not retarget `id`.
    await query(
      `UPDATE users SET role = $2, display_name = $3, avatar_url = $4, bio = $5 WHERE id = $1`,
      [targetId, user.role, user.display_name, user.avatar_url, user.bio],
    );
    if (user.role !== beforeRole) {
      logEvent(req.ctx.logger, {
        event: 'role.change',
        reqId: req.ctx.reqId,
        route: 'PATCH /api/profile',
        userId: targetId,
        srcIp: req.ip,
        meta: { from: beforeRole, to: user.role },
      });
      await writeAudit(config, {
        actor: String(targetId),
        event: 'role.change',
        route: 'PATCH /api/profile',
        srcIp: req.ip,
        detail: { from: beforeRole, to: user.role },
      });
    }
    if (typeof req.body?.bio === 'string') {
      logEvent(req.ctx.logger, {
        event: 'content.store',
        reqId: req.ctx.reqId,
        route: 'PATCH /api/profile',
        userId: targetId,
        srcIp: req.ip,
        meta: { payload: String(req.body.bio).slice(0, 200) },
      });
    }
    const authUser = {
      id: targetId,
      username: user.username,
      role: user.role as 'user' | 'admin',
    };
    const token = signToken(authUser, config);
    res.cookie(config.jwtCookieName, token, { httpOnly: false, sameSite: 'lax' });
    res.json({
      token,
      user: {
        id: targetId,
        username: user.username,
        role: user.role,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        bio: user.bio,
      },
    });
  });

  /** V2.6 SSRF — fetch avatar URL with no validation */
  r.post('/api/profile/avatar', requireAuth, async (req, res) => {
    const avatarUrl = String(req.body?.avatarUrl ?? req.body?.url ?? '');
    if (!avatarUrl) {
      res.status(400).json({ error: 'avatarUrl required' });
      return;
    }
    logEvent(req.ctx.logger, {
      event: 'upload.url.fetch',
      reqId: req.ctx.reqId,
      route: 'POST /api/profile/avatar',
      userId: req.user!.id,
      srcIp: req.ip,
      meta: { avatarUrl },
    });
    await writeAudit(config, {
      actor: String(req.user!.id),
      event: 'upload.url.fetch',
      route: 'POST /api/profile/avatar',
      srcIp: req.ip,
      detail: { avatarUrl },
    });
    try {
      // X-Stand-Team is only meaningful for the internal metadata SSRF target —
      // do not attach the stand identity to arbitrary attacker-controlled URLs.
      const headers: Record<string, string> = {};
      try {
        const host = new URL(avatarUrl).hostname.toLowerCase();
        if (
          host === 'internal-metadata' ||
          host === 'internal-metadata.platform.svc.cluster.local' ||
          host.endsWith('.internal-metadata.platform.svc.cluster.local')
        ) {
          headers['X-Stand-Team'] = config.team;
        }
      } catch {
        /* invalid URL — fetch will fail below */
      }
      const upstream = await fetch(avatarUrl, { headers });
      const body = await upstream.text();
      await query(`UPDATE users SET avatar_url = $2 WHERE id = $1`, [
        req.user!.id,
        avatarUrl,
      ]);
      res.json({
        status: 'ok',
        avatarUrl,
        fetchedStatus: upstream.status,
        fetchedBodyPreview: body.slice(0, 500),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: 'fetch failed', message });
    }
  });

  r.get('/api/admin/flag', requireAuth, requireAdmin(config), async (req, res) => {
    // Do not log flag value — planted per-tick into secret_flags(admin_flag)
    logEvent(req.ctx.logger, {
      event: 'admin.access',
      reqId: req.ctx.reqId,
      route: 'GET /api/admin/flag',
      userId: req.user!.id,
      srcIp: req.ip,
      meta: { resource: 'admin_flag' },
    });
    const row = await query<{ value: string }>(
      `SELECT value FROM secret_flags WHERE name = 'admin_flag' LIMIT 1`,
    );
    if (!row.rows[0]) {
      res.status(503).json({ error: 'admin flag not planted yet' });
      return;
    }
    res.json({ flag: row.rows[0].value });
  });

  r.get('/api/admin/note', requireAuth, requireAdmin(config), async (_req, res) => {
    const notes = await query<{ body: string }>('SELECT body FROM admin_notes ORDER BY id');
    res.json({ notes: notes.rows });
  });

  r.get('/admin', requireAuth, requireAdmin(config), async (req, res) => {
    const notes = await query<{ body: string }>('SELECT body FROM admin_notes ORDER BY id');
    const comments = await query<{
      body: string;
      username: string;
      invoice_id: number;
    }>(
      `SELECT c.body, u.username, c.invoice_id
       FROM comments c JOIN users u ON u.id = c.author_id
       ORDER BY c.id DESC LIMIT 50`,
    );
    const bios = await query<{ username: string; bio: string }>(
      `SELECT username, bio FROM users WHERE bio <> '' ORDER BY id`,
    );
    res.render('admin', {
      user: req.user,
      notes: notes.rows,
      comments: comments.rows,
      bios: bios.rows,
    });
  });

  r.get('/profile', requireAuth, async (req, res) => {
    const result = await query(
      `SELECT id, username, role, display_name, avatar_url, bio FROM users WHERE id = $1`,
      [req.user!.id],
    );
    res.render('profile', { user: req.user, profile: result.rows[0] });
  });

  return r;
}
