import type { NextFunction, Request, Response } from 'express';

export function requireAuth(
  _req: Request,
  _res: Response,
  _next: NextFunction
) {
  // TODO: implement JWT/cookie auth verification.
  return;
}

export function requireRole(_roles: string[]) {
  return (_req: Request, _res: Response, _next: NextFunction) => {
    // TODO: implement role-based access control.
    return;
  };
}
