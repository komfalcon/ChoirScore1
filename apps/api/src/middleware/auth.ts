import type { NextFunction, Request, Response } from 'express';
import type { ApiRepository } from '../db/repository';
import { sendApiError } from '../errors';
import { SESSION_COOKIE, verifySessionToken } from '../security/session';
import type { ApiConfig } from '../config';
import type { RequestWithContext } from '../types';

function isPublicRequest(method: string, path: string) {
  return (
    (method === 'GET' && ['/healthz', '/api/healthz'].includes(path)) ||
    (method === 'POST' && path === '/auth/login')
  );
}

function isLogoutRequest(method: string, path: string) {
  return method === 'POST' && path === '/auth/logout';
}

function allowedWhilePasswordChangeIsRequired(method: string, path: string) {
  return (
    (method === 'POST' && path === '/auth/change-password') ||
    (method === 'POST' && path === '/auth/logout')
  );
}

export function authenticationMiddleware(
  repository: ApiRepository,
  config: ApiConfig
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (isPublicRequest(req.method.toUpperCase(), req.path)) return next();

    const request = req as RequestWithContext;
    const token = request.cookies?.[SESSION_COOKIE] as unknown;
    const claims = verifySessionToken(token, config.jwtSecret);
    if (!claims) {
      if (isLogoutRequest(req.method.toUpperCase(), req.path)) return next();
      return sendApiError(
        res,
        401,
        'UNAUTHENTICATED',
        'Authentication is required.'
      );
    }

    const user = await repository.findUserById(claims.userId);
    if (!user || !user.isActive) {
      return sendApiError(
        res,
        401,
        'UNAUTHENTICATED',
        'Authentication is required.'
      );
    }
    request.authUser = user;

    if (
      user.mustChangePassword &&
      !allowedWhilePasswordChangeIsRequired(req.method.toUpperCase(), req.path)
    ) {
      return sendApiError(
        res,
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'Change your password before using this service.'
      );
    }
    next();
  };
}

export function requireRole(roles: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as RequestWithContext).authUser;
    if (!user || !roles.includes(user.role)) {
      return sendApiError(
        res,
        403,
        'FORBIDDEN',
        'You are not permitted to perform this action.'
      );
    }
    next();
  };
}
