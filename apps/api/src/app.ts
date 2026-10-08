import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { ApiConfig } from './config';
import type { ApiRepository } from './db/repository';
import { errorHandler, sendApiError } from './errors';
import { authenticationMiddleware } from './middleware/auth';
import { requireCsrfHeader } from './middleware/csrf';
import { requestIdMiddleware } from './middleware/requestId';
import { requestLogMiddleware } from './middleware/requestLog';
import { createAdminRouter } from './routes/admin';
import { aiRouter } from './routes/ai';
import { createAuthRouter } from './routes/auth';
import { scoresRouter } from './routes/scores';
import { createUsersRouter } from './routes/users';
import { LoginThrottle } from './security/loginThrottle';
import { structuredLogger, type StructuredLogger } from './audit';

export interface AppOptions {
  repository: ApiRepository;
  config: ApiConfig;
  logger?: StructuredLogger;
  throttle?: LoginThrottle;
  trustProxyHops?: number;
}

export function createApp({
  repository,
  config,
  logger = structuredLogger,
  throttle = new LoginThrottle(),
  trustProxyHops = config.trustProxyHops,
}: AppOptions) {
  const app = express();
  const allowedOrigins = new Set(config.allowedOrigins);
  app.set('trust proxy', trustProxyHops);

  app.use(helmet());
  app.use(requestIdMiddleware);
  app.use(requestLogMiddleware(logger));
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, Boolean(origin && allowedOrigins.has(origin))),
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Requested-With'],
      maxAge: 600,
    })
  );
  app.use((req, res, next) => {
    const origin = req.get('Origin');
    if (origin && !allowedOrigins.has(origin)) {
      return sendApiError(
        res,
        403,
        'ORIGIN_NOT_ALLOWED',
        'This request origin is not allowed.'
      );
    }
    next();
  });
  app.use(cookieParser());
  app.use('/scores', express.json({ limit: '6mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(requireCsrfHeader);
  app.use(authenticationMiddleware(repository, config));

  app.get(['/healthz', '/api/healthz'], (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use('/auth', createAuthRouter({ repository, config, throttle }));
  app.use('/users', createUsersRouter(repository));
  app.use('/scores', scoresRouter);
  app.use('/ai', aiRouter);
  app.use('/admin', createAdminRouter(repository));

  app.use((_req, res) => {
    sendApiError(
      res,
      404,
      'NOT_FOUND',
      'The requested resource was not found.'
    );
  });
  app.use(errorHandler);

  return app;
}
