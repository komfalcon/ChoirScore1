import type { NextFunction, Request, Response } from 'express';
import { recordAdminMutationFailure } from '../audit';
import type { ApiConfig } from '../config';
import type { ApiRepository } from '../db/repository';
import { SESSION_COOKIE, verifySessionToken } from '../security/session';
import { AnonymousSecurityEvents } from '../security/anonymousSecurityEvents';
import type { StructuredLogger } from '../audit';
import type { AdminMutationAuditAttempt, RequestWithContext } from '../types';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function identifyAttempt(req: Request): AdminMutationAuditAttempt | null {
  const method = req.method.toUpperCase();
  if (!STATE_CHANGING_METHODS.has(method)) return null;

  const path = req.path.replace(/^\/api(?=\/|$)/, '').replace(/\/$/, '') || '/';
  if (path === '/users' && method === 'POST') {
    return { action: 'users.create', targetType: 'user', targetId: null };
  }
  if (path === '/users/bulk' && method === 'POST') {
    return { action: 'users.bulk_create', targetType: 'users', targetId: null };
  }

  const userRoute = /^\/users\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if (userRoute) {
    const [, targetId, operation] = userRoute;
    const action =
      method === 'PATCH' && !operation
        ? 'users.update'
        : method === 'POST' && operation === 'reset-password'
          ? 'users.reset_password'
          : method === 'POST' && operation === 'activate'
            ? 'users.activate'
            : method === 'POST' && operation === 'deactivate'
              ? 'users.deactivate'
              : 'users.mutation';
    return { action, targetType: 'user', targetId };
  }

  if (path === '/admin/settings' && method === 'PATCH') {
    return {
      action: 'admin.settings.update',
      targetType: 'settings',
      targetId: null,
    };
  }
  if (path === '/admin' || path.startsWith('/admin/')) {
    return { action: 'admin.mutation', targetType: 'admin', targetId: null };
  }
  if (path === '/scores' && method === 'POST') {
    return { action: 'scores.create', targetType: 'score', targetId: null };
  }
  const scoreRoute =
    /^\/scores\/([^/]+)(?:\/(versions|autosaves|access))?$/.exec(path);
  if (scoreRoute) {
    const [, scoreId, operation] = scoreRoute;
    if (method === 'PATCH' && !operation) {
      return {
        action: 'scores.update',
        targetType: 'score',
        targetId: scoreId!,
      };
    }
    if (method === 'POST' && operation === 'versions') {
      return {
        action: 'scores.version.create',
        targetType: 'score',
        targetId: scoreId!,
      };
    }
    if (method === 'POST' && operation === 'autosaves') {
      return {
        action: 'scores.autosave.create',
        targetType: 'score',
        targetId: scoreId!,
      };
    }
    if (method === 'PUT' && operation === 'access') {
      return {
        action: 'scores.access.update',
        targetType: 'score',
        targetId: scoreId!,
      };
    }
  }
  if (path === '/scores' || path.startsWith('/scores/')) {
    return {
      action: 'scores.mutation',
      targetType: 'score',
      targetId: path.split('/')[2] || null,
    };
  }
  if (path === '/users' || path.startsWith('/users/')) {
    return { action: 'users.mutation', targetType: 'users', targetId: null };
  }
  return null;
}

export function adminMutationAuditMiddleware(
  repository: ApiRepository,
  config: ApiConfig,
  logger: StructuredLogger
) {
  const anonymousSecurityEvents = new AnonymousSecurityEvents(logger);
  return async (req: Request, res: Response, next: NextFunction) => {
    const attempt = identifyAttempt(req);
    if (!attempt) return next();

    const request = req as RequestWithContext;
    const isScoreMutation = attempt.targetType === 'score';
    if (!isScoreMutation) request.adminMutationAuditAttempt = attempt;
    const sessionToken = request.cookies?.[SESSION_COOKIE] as unknown;
    const claims = verifySessionToken(sessionToken, config.jwtSecret);
    let actor: Awaited<ReturnType<ApiRepository['findUserById']>> = null;
    if (claims) {
      try {
        actor = await repository.findUserById(claims.userId);
      } catch {
        // Attribution is best effort; the normal auth middleware remains authoritative.
      }
    }
    if (isScoreMutation) {
      if (!actor?.isActive || actor.role !== 'admin') return next();
      request.adminMutationAuditAttempt = attempt;
      request.adminMutationActorId = actor.id;
    } else if (actor?.isActive) {
      request.adminMutationActorId = actor.id;
    }
    res.locals.recordAdminMutationFailure = async (
      status: number,
      errorCode: string
    ) => {
      if (request.adminMutationAuditRecorded) return;
      request.adminMutationAuditRecorded = true;
      const actorId = request.authUser?.id ?? request.adminMutationActorId;
      if (!actorId) {
        anonymousSecurityEvents.record(errorCode);
        return;
      }
      try {
        await recordAdminMutationFailure(
          repository,
          request,
          attempt,
          status >= 500 ? 'failed' : 'rejected',
          errorCode,
          actorId
        );
      } catch {
        // Keep the response safe and avoid logging database or request details.
        console.error(
          JSON.stringify({
            event: 'admin_mutation_audit_write_failed',
            requestId: request.context?.requestId ?? null,
          })
        );
      }
    };
    next();
  };
}
