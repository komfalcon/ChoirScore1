import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { RequestWithContext } from '../types';

export function requestIdMiddleware(
  req: RequestWithContext,
  res: Response,
  next: NextFunction
) {
  req.context = { requestId: randomUUID() };
  res.setHeader('x-request-id', req.context.requestId);
  next();
}
