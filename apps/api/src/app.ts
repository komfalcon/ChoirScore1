import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { requestIdMiddleware } from './middleware/requestId';
import { adminRouter } from './routes/admin';
import { aiRouter } from './routes/ai';
import { authRouter } from './routes/auth';
import { scoresRouter } from './routes/scores';
import { usersRouter } from './routes/users';

export function createApp() {
  const app = express();

  const allowedOrigin = process.env.ALLOWED_ORIGIN;

  app.use(helmet());
  app.use(
    cors({
      origin: allowedOrigin ? [allowedOrigin] : false,
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware);

  app.get(['/healthz', '/api/healthz'], (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use('/auth', authRouter);
  app.use('/users', usersRouter);
  app.use('/scores', scoresRouter);
  app.use('/ai', aiRouter);
  app.use('/admin', adminRouter);

  return app;
}
