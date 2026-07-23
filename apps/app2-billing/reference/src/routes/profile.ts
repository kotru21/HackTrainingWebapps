import { Router } from 'express';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { logEvent } from '@hacktraining/shared';
import type { AppConfig } from '../config';
import { query } from '../db';
import { writeAudit } from '../context';
import { requireAuth, requireAdmin } from '../middleware/auth';

const PROFILE_ALLOW = new Set(['display_name', 'avatar_url', 'bio']);

/** Allowed URL schemes for avatar fetch (SSRF-guard). */
const AVATAR_SCHEMES = new Set(['http:', 'https:']);

function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (!v) return false;
  if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd') || ip.toLowerCase().startsWith('fe80')) {
    return true;
  }
  const m = /^172\.(\d+)\./.exec(ip);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

/**
 * V2.6 SSRF-guard: scheme allow-list + resolve host→all IPs and reject any private range.
 * Blocks DNS-rebinding to ClusterIP / loopback (incl. FQDN
 * internal-metadata.platform.svc.cluster.local). Redirects rejected at fetch time.
 */
async function assertSafeAvatarUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid url');
  }
  if (!AVATAR_SCHEMES.has(url.protocol)) {
    throw new Error('scheme not allowed');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('host not allowed');
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('host not allowed');
    return url;
  }
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error('host not allowed');
  }
  if (addrs.length === 0) throw new Error('host not allowed');
  for (const { address } of addrs) {
    if (isPrivateIp(address)) throw new Error('host not allowed');
  }
  return url;
}

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

  /** V2.4 fix — allow-list fields only */
  r.patch('/api/profile', requireAuth, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const patch: Record<string, string> = {};
    for (const key of PROFILE_ALLOW) {
      if (typeof body[key] === 'string') patch[key] = body[key] as string;
    }
    if (typeof body.role !== 'undefined') {
      logEvent(req.ctx.logger, {
        event: 'authz.deny',
        reqId: req.ctx.reqId,
        route: 'PATCH /api/profile',
        userId: req.user!.id,
        srcIp: req.ip,
        meta: { reason: 'role_not_allowed_on_profile' },
      });
    }
    const current = await query<{
      id: number;
      username: string;
      role: string;
      display_name: string;
      avatar_url: string;
      bio: string;
    }>('SELECT id, username, role, display_name, avatar_url, bio FROM users WHERE id = $1', [
      req.user!.id,
    ]);
    const user = current.rows[0];
    const displayName = patch.display_name ?? user.display_name;
    const avatarUrl = patch.avatar_url ?? user.avatar_url;
    const bio = patch.bio ?? user.bio;
    await query(
      `UPDATE users SET display_name = $2, avatar_url = $3, bio = $4 WHERE id = $1`,
      [user.id, displayName, avatarUrl, bio],
    );
    if (typeof patch.bio === 'string') {
      logEvent(req.ctx.logger, {
        event: 'content.store',
        reqId: req.ctx.reqId,
        route: 'PATCH /api/profile',
        userId: user.id,
        srcIp: req.ip,
        meta: { payload: patch.bio.slice(0, 200) },
      });
    }
    res.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        display_name: displayName,
        avatar_url: avatarUrl,
        bio,
      },
    });
  });

  r.post('/api/profile/avatar', requireAuth, async (req, res) => {
    const avatarUrl = String(req.body?.avatarUrl ?? req.body?.url ?? '');
    if (!avatarUrl) {
      res.status(400).json({ error: 'avatarUrl required' });
      return;
    }
    try {
      const url = await assertSafeAvatarUrl(avatarUrl);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const upstream = await fetch(url, { signal: controller.signal, redirect: 'error' });
      clearTimeout(timer);
      const body = await upstream.text();
      await query(`UPDATE users SET avatar_url = $2 WHERE id = $1`, [
        req.user!.id,
        url.toString(),
      ]);
      logEvent(req.ctx.logger, {
        event: 'upload.url.fetch',
        reqId: req.ctx.reqId,
        route: 'POST /api/profile/avatar',
        userId: req.user!.id,
        srcIp: req.ip,
        meta: { avatarUrl: url.toString(), allowed: true },
      });
      res.json({
        status: 'ok',
        avatarUrl: url.toString(),
        fetchedStatus: upstream.status,
        fetchedBodyPreview: body.slice(0, 200),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logEvent(req.ctx.logger, {
        event: 'ssrf.blocked',
        reqId: req.ctx.reqId,
        route: 'POST /api/profile/avatar',
        userId: req.user!.id,
        srcIp: req.ip,
        status: 400,
        meta: { avatarUrl },
      });
      await writeAudit(config, {
        actor: String(req.user!.id),
        event: 'ssrf.blocked',
        route: 'POST /api/profile/avatar',
        srcIp: req.ip,
        detail: { avatarUrl, reason: message },
      });
      res.status(400).json({ error: 'avatar url rejected', message });
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
