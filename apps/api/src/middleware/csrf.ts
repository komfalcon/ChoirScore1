import type { NextFunction, Request, Response } from 'express';
import { sendApiError } from '../errors';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function requireCsrfHeader(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (
    STATE_CHANGING_METHODS.has(req.method.toUpperCase()) &&
    req.get('X-Requested-With') !== 'choirscore'
  ) {
    return sendApiError(
      res,
      403,
      'CSRF_HEADER_REQUIRED',
      'This request is missing the required request-origin header.'
    );
  }
  next();
}
