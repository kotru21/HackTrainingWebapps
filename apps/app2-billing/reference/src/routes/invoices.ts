import { Router } from 'express';
import { logEvent } from '@hacktraining/shared';
import type { AppConfig } from '../config';
import { query } from '../db';
import { writeAudit } from '../context';
import { requireAuth } from '../middleware/auth';

const SORT_ALLOW = new Set(['id', 'title', 'amount_cents', 'status', 'created_at']);

export function invoiceRoutes(config: AppConfig): Router {
  const r = Router();

  r.post('/api/invoices', requireAuth, async (req, res) => {
    const title = String(req.body?.title ?? '').trim();
    const amount = Number(req.body?.amount_cents ?? 0);
    const memo = String(req.body?.memo ?? '');
    if (!title) {
      res.status(400).json({ error: 'title required' });
      return;
    }
    const result = await query(
      `INSERT INTO invoices (owner_id, title, amount_cents, status, memo)
       VALUES ($1, $2, $3, 'open', $4) RETURNING *`,
      [req.user!.id, title, amount, memo],
    );
    res.status(201).json({ invoice: result.rows[0] });
  });

  r.post('/api/invoices/:id/pay', requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const inv = await query<{ id: number; owner_id: number }>(
      'SELECT id, owner_id FROM invoices WHERE id = $1',
      [id],
    );
    const row = inv.rows[0];
    if (!row || (row.owner_id !== req.user!.id && req.user!.role !== 'admin')) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const updated = await query(
      `UPDATE invoices SET status = 'paid' WHERE id = $1 RETURNING *`,
      [id],
    );
    res.json({ invoice: updated.rows[0], receipt: { invoiceId: id, status: 'paid' } });
  });

  /** V2.1 fix — ownership check; 404 for non-owner */
  r.get('/api/invoices/:id', requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const result = await query(`SELECT * FROM invoices WHERE id = $1`, [id]);
    const invoice = result.rows[0];
    if (!invoice) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const ownerId = Number(invoice.owner_id);
    const allowed = ownerId === req.user!.id || req.user!.role === 'admin';
    if (!allowed) {
      logEvent(req.ctx.logger, {
        event: 'authz.deny',
        reqId: req.ctx.reqId,
        route: 'GET /api/invoices/:id',
        userId: req.user!.id,
        srcIp: req.ip,
        status: 404,
        meta: { resourceOwner: ownerId, requester: req.user!.id },
      });
      await writeAudit(config, {
        actor: String(req.user!.id),
        event: 'authz.deny',
        route: 'GET /api/invoices/:id',
        srcIp: req.ip,
        detail: { resourceOwner: ownerId, requester: req.user!.id },
      });
      res.status(404).json({ error: 'not found' });
      return;
    }
    logEvent(req.ctx.logger, {
      event: 'authz.allow',
      reqId: req.ctx.reqId,
      route: 'GET /api/invoices/:id',
      userId: req.user!.id,
      srcIp: req.ip,
      status: 200,
      meta: { resourceOwner: ownerId, requester: req.user!.id },
    });
    res.json({ invoice });
  });

  /** V2.2 fix — parameterized search + sort allow-list */
  r.get('/api/invoices', requireAuth, async (req, res) => {
    const q = String(req.query.q ?? '');
    const sortRaw = String(req.query.sort ?? 'id');
    const sort = SORT_ALLOW.has(sortRaw) ? sortRaw : 'id';
    try {
      let result;
      if (q) {
        result = await query(
          `SELECT id, title, amount_cents, status, memo FROM invoices
           WHERE owner_id = $1 AND (title ILIKE $2 OR memo ILIKE $2)
           ORDER BY ${sort}`,
          [req.user!.id, `%${q}%`],
        );
      } else {
        result = await query(
          `SELECT id, title, amount_cents, status, memo FROM invoices
           WHERE owner_id = $1 ORDER BY id`,
          [req.user!.id],
        );
      }
      res.json({ invoices: result.rows });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logEvent(req.ctx.logger, {
        event: 'sql.error',
        reqId: req.ctx.reqId,
        route: 'GET /api/invoices',
        userId: req.user!.id,
        srcIp: req.ip,
        status: 500,
        meta: { qPreview: q.slice(0, 80) },
      });
      await writeAudit(config, {
        actor: String(req.user!.id),
        event: 'sql.error',
        route: 'GET /api/invoices',
        srcIp: req.ip,
        detail: { message: message.slice(0, 200) },
      });
      res.status(500).json({ error: 'query failed' });
    }
  });

  r.post('/api/invoices/:id/comments', requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const body = String(req.body?.body ?? '');
    const inv = await query<{ owner_id: number }>(
      'SELECT owner_id FROM invoices WHERE id = $1',
      [id],
    );
    const row = inv.rows[0];
    if (!row || (row.owner_id !== req.user!.id && req.user!.role !== 'admin')) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const inserted = await query(
      `INSERT INTO comments (invoice_id, author_id, body) VALUES ($1, $2, $3) RETURNING *`,
      [id, req.user!.id, body],
    );
    logEvent(req.ctx.logger, {
      event: 'content.store',
      reqId: req.ctx.reqId,
      route: 'POST /api/invoices/:id/comments',
      userId: req.user!.id,
      srcIp: req.ip,
      meta: { payload: body.slice(0, 200) },
    });
    res.status(201).json({ comment: inserted.rows[0] });
  });

  return r;
}
