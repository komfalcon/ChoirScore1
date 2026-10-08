import type { NextFunction, Request, Response } from 'express';
import type { StructuredLogger } from '../audit';
import type { RequestWithContext } from '../types';

export function requestLogMiddleware(logger: StructuredLogger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    res.once('finish', () => {
      const requestId = (req as RequestWithContext).context?.requestId ?? null;
      logger.info({
        event: 'http_request',
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    next();
  };
}
