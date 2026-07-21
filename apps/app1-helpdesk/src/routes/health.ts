import { Router } from 'express';
import { checkDbReady } from '../db';

export function healthRouter(): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  router.get('/readyz', async (_req, res) => {
    const dbOk = await checkDbReady();
    if (!dbOk) {
      res.status(503).json({ status: 'not_ready', db: false });
      return;
    }
    res.status(200).json({ status: 'ready', db: true });
  });

  return router;
}
