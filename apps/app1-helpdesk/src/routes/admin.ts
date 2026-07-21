import { Router } from 'express';
import type { AppConfig } from '../config';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { listAdminSecrets, listTicketsForUser } from '../services/tickets';
import { logEvent } from '@hacktraining/shared';
import { writeAudit } from '../types';

export function adminRouter(config: AppConfig): Router {
  const router = Router();

  router.get('/admin', requireAuth, requireAdmin(config), async (req, res) => {
    logEvent(req.ctx.logger, {
      event: 'admin.access',
      reqId: req.ctx.reqId,
      route: 'GET /admin',
      userId: req.user!.id,
      srcIp: req.ip,
      meta: { role: req.user!.role },
    });
    await writeAudit(config, {
      actor: String(req.user!.id),
      event: 'admin.access',
      route: 'GET /admin',
      srcIp: req.ip,
      detail: { role: req.user!.role },
    });
    const tickets = await listTicketsForUser(req.user!.id, true);
    const secrets = await listAdminSecrets();
    if (req.accepts('html')) {
      res.render('admin', { tickets, secrets, user: req.user });
      return;
    }
    res.json({ tickets, secrets });
  });

  router.get('/api/admin/secrets', requireAuth, requireAdmin(config), async (req, res) => {
    logEvent(req.ctx.logger, {
      event: 'admin.access',
      reqId: req.ctx.reqId,
      route: 'GET /api/admin/secrets',
      userId: req.user!.id,
      srcIp: req.ip,
      meta: { role: req.user!.role },
    });
    await writeAudit(config, {
      actor: String(req.user!.id),
      event: 'admin.access',
      route: 'GET /api/admin/secrets',
      srcIp: req.ip,
      detail: { role: req.user!.role },
    });
    // Do not log secret values (may contain flags)
    const secrets = await listAdminSecrets();
    res.json({ secrets });
  });

  return router;
}
