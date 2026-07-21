import path from 'node:path';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { AppConfig } from './config';
import type { Logger } from '@hacktraining/shared';
import { requestContextMiddleware } from './types';
import { applySecurityMiddleware } from './middleware/security';
import { optionalAuth } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { ticketsRouter } from './routes/tickets';
import { adminRouter } from './routes/admin';
import { debugRouter } from './routes/debug';

export function createApp(config: AppConfig, logger: Logger): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', config.viewsDir);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(requestContextMiddleware(logger));
  applySecurityMiddleware(app, config);

  // Static root from env (V1.9): `.` leaks .env/.git; `./public` is safe
  const staticRoot = path.isAbsolute(config.serveStaticRoot)
    ? config.serveStaticRoot
    : path.resolve(path.join(__dirname, '..'), config.serveStaticRoot);
  app.use(express.static(staticRoot));

  app.use(optionalAuth(config));

  app.get('/', (req, res) => {
    if (req.user) {
      res.redirect(req.user.role === 'admin' ? '/admin' : '/tickets');
      return;
    }
    res.redirect('/login');
  });

  app.use(healthRouter());
  app.use(authRouter(config));
  app.use(ticketsRouter());
  app.use(adminRouter(config));
  app.use(debugRouter(config));

  app.use(errorHandler(config));
  return app;
}
