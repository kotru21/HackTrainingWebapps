import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  addAttachment,
  createTicket,
  getTicket,
  listAttachments,
  listTicketsForUser,
  updateTicketStatus,
  type TicketStatus,
} from '../services/tickets';

const STATUSES: TicketStatus[] = ['open', 'in_progress', 'closed'];

export function ticketsRouter(): Router {
  const router = Router();

  router.get('/tickets', requireAuth, async (req, res) => {
    const tickets = await listTicketsForUser(req.user!.id, req.user!.role === 'admin');
    if (req.accepts('html')) {
      res.render('tickets/list', { tickets, user: req.user });
      return;
    }
    res.json({ tickets });
  });

  router.get('/api/tickets', requireAuth, async (req, res) => {
    const tickets = await listTicketsForUser(req.user!.id, req.user!.role === 'admin');
    res.json({ tickets });
  });

  router.post('/api/tickets', requireAuth, async (req, res) => {
    const title = String(req.body?.title ?? '').trim();
    const body = String(req.body?.body ?? '').trim();
    if (!title || !body) {
      res.status(400).json({ error: 'title and body required' });
      return;
    }
    const ticket = await createTicket(req.user!.id, title, body);
    res.status(201).json({ ticket });
  });

  router.post('/tickets', requireAuth, async (req, res) => {
    const title = String(req.body?.title ?? '').trim();
    const body = String(req.body?.body ?? '').trim();
    if (!title || !body) {
      res.status(400).render('tickets/list', {
        tickets: await listTicketsForUser(req.user!.id, req.user!.role === 'admin'),
        user: req.user,
        error: 'title and body required',
      });
      return;
    }
    const ticket = await createTicket(req.user!.id, title, body);
    res.redirect(`/tickets/${ticket.id}`);
  });

  /**
   * Ticket detail — spreads req.query into res.render.
   * On ejs < 3.1.7, Express→ejs path honours settings['view options'].outputFunctionName
   * (CVE-2022-29078 / V1.2). Fix is dependency bump only; this code stays unchanged.
   */
  router.get('/tickets/:id', requireAuth, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const ticket = await getTicket(id);
      if (!ticket) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      if (req.user!.role !== 'admin' && ticket.owner_id !== req.user!.id) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      const attachments = await listAttachments(ticket.id);
      // Intentional: query (incl. settings[view options]) merges into ejs options on old ejs.
      res.render('tickets/detail', {
        ticket,
        attachments,
        user: req.user,
        ...req.query,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/tickets/:id', requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const ticket = await getTicket(id);
    if (!ticket) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (req.user!.role !== 'admin' && ticket.owner_id !== req.user!.id) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const attachments = await listAttachments(ticket.id);
    res.json({ ticket, attachments });
  });

  router.patch('/api/tickets/:id', requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const ticket = await getTicket(id);
    if (!ticket) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (req.user!.role !== 'admin' && ticket.owner_id !== req.user!.id) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const status = String(req.body?.status ?? '') as TicketStatus;
    if (!STATUSES.includes(status)) {
      res.status(400).json({ error: 'invalid status' });
      return;
    }
    const updated = await updateTicketStatus(id, status);
    res.json({ ticket: updated });
  });

  router.post('/api/tickets/:id/attachments', requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const ticket = await getTicket(id);
    if (!ticket) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (req.user!.role !== 'admin' && ticket.owner_id !== req.user!.id) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const filename = String(req.body?.filename ?? 'note.txt');
    const contentType = String(req.body?.contentType ?? 'text/plain');
    const attachment = await addAttachment(id, filename, contentType);
    res.status(201).json({ attachment });
  });

  return router;
}
