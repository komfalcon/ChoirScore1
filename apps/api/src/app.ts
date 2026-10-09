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
import { adminMutationAuditMiddleware } from './middleware/adminMutationAudit';
import { createAdminRouter } from './routes/admin';
import { aiRouter } from './routes/ai';
import { createAuthRouter } from './routes/auth';
import { createScoresRouter } from './routes/scores';
import { createSettingsRouter } from './routes/settings';
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
  throttle,
  trustProxyHops = config.trustProxyHops,
}: AppOptions) {
  const app = express();
  const loginThrottle = throttle ?? new LoginThrottle(repository);
  const allowedOrigins = new Set(config.allowedOrigins);
  app.set('trust proxy', trustProxyHops);

  app.use(helmet());
  app.use(requestIdMiddleware);
  app.use(cookieParser());
  app.use(adminMutationAuditMiddleware(repository, config, logger));
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
  app.use(async (req, res, next) => {
    const origin = req.get('Origin');
    if (origin && !allowedOrigins.has(origin)) {
      return await sendApiError(
        res,
        403,
        'ORIGIN_NOT_ALLOWED',
        'This request origin is not allowed.'
      );
    }
    next();
  });
  app.use('/scores', express.json({ limit: '6mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(requireCsrfHeader);
  app.use(authenticationMiddleware(repository, config));

  app.get(['/healthz', '/api/healthz'], (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use(
    '/auth',
    createAuthRouter({ repository, config, throttle: loginThrottle })
  );
  app.use('/users', createUsersRouter(repository));
  app.use('/scores', createScoresRouter(repository, config.jwtSecret));
  app.use('/ai', aiRouter);
  app.use('/settings', createSettingsRouter(repository));
  app.use('/admin', createAdminRouter(repository));

  app.use(async (_req, res) => {
    await sendApiError(
      res,
      404,
      'NOT_FOUND',
      'The requested resource was not found.'
    );
  });
  app.use(errorHandler);

  return app;
}
