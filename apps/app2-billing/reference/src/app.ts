import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Logger } from '@hacktraining/shared';
import type { AppConfig } from './config';
import { checkDbReady } from './db';
import { requestContext } from './context';
import { optionalAuth } from './middleware/auth';
import { authRoutes } from './routes/auth';
import { invoiceRoutes } from './routes/invoices';
import { profileRoutes } from './routes/profile';

export function createApp(config: AppConfig, logger: Logger): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', config.viewsDir);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: { 'script-src': ["'self'"], 'frame-ancestors': ["'none'"] },
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(requestContext(logger));
  app.use(express.static(config.sharedPublicDir));
  app.use(optionalAuth(config));

  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', async (_req, res) => {
    const db = await checkDbReady();
    if (!db) {
      res.status(503).json({ status: 'not_ready', db: false });
      return;
    }
    res.json({ status: 'ready', db: true });
  });

  app.get('/', (req, res) => {
    if (req.user) {
      res.redirect('/profile');
      return;
    }
    res.redirect('/login');
  });

  app.get('/login', (req, res) => {
    res.render('login', { user: req.user ?? null, error: null });
  });

  app.use(authRoutes(config));
  app.use(invoiceRoutes(config));
  app.use(profileRoutes(config));

  app.use(
    (
      _err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(500).json({ error: 'internal server error' });
    },
  );

  return app;
}
