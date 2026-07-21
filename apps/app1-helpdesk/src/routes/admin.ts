import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { listAdminSecrets, listTicketsForUser } from '../services/tickets';
import { logEvent } from '@hacktraining/shared';

export function adminRouter(): Router {
  const router = Router();

  router.get('/admin', requireAuth, requireAdmin, async (req, res) => {
    logEvent(req.ctx.logger, {
      event: 'admin.access',
      reqId: req.ctx.reqId,
      route: 'GET /admin',
      userId: req.user!.id,
      srcIp: req.ip,
      meta: { role: req.user!.role },
    });
    const tickets = await listTicketsForUser(req.user!.id, true);
    const secrets = await listAdminSecrets();
    if (req.accepts('html')) {
      res.render('admin', { tickets, secrets, user: req.user });
      return;
    }
    res.json({ tickets, secrets });
  });

  router.get('/api/admin/secrets', requireAuth, requireAdmin, async (req, res) => {
    logEvent(req.ctx.logger, {
      event: 'admin.access',
      reqId: req.ctx.reqId,
      route: 'GET /api/admin/secrets',
      userId: req.user!.id,
      srcIp: req.ip,
      meta: { role: req.user!.role },
    });
    // Return secrets to admin; do not log values (may contain flags)
    const secrets = await listAdminSecrets();
    res.json({ secrets });
  });

  return router;
}
