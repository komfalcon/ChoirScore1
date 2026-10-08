import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import {
  changePasswordRequestSchema,
  changePasswordResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  meResponseSchema,
} from '@choirscore/shared';
import type { ApiConfig } from '../../config';
import type { ApiRepository } from '../../db/repository';
import { ApiError, sendApiError } from '../../errors';
import type { LoginThrottle } from '../../security/loginThrottle';
import {
  hashPassword,
  isPasswordSupportedByBcrypt,
  verifyPassword,
} from '../../security/password';
import {
  clearSessionCookieOptions,
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '../../security/session';
import type { RequestWithContext } from '../../types';
import { toSafeUser } from '../../services/users';

export interface AuthRouteDependencies {
  repository: ApiRepository;
  config: ApiConfig;
  throttle: LoginThrottle;
}

function payloadError() {
  return new ApiError(
    400,
    'VALIDATION_ERROR',
    'The request payload is invalid.'
  );
}

let dummyPasswordHash: Promise<string> | undefined;
function getDummyPasswordHash() {
  dummyPasswordHash ??= hashPassword(randomUUID());
  return dummyPasswordHash;
}

function bodyOf<T>(request: Request) {
  return request.body as T;
}

export function createAuthRouter({
  repository,
  config,
  throttle,
}: AuthRouteDependencies) {
  const router = Router();

  router.post('/login', async (req, res) => {
    const parsed = loginRequestSchema.safeParse(bodyOf<unknown>(req));
    if (!parsed.success) throw payloadError();
    const username = parsed.data.username.trim().toLowerCase();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!throttle.consume(ip, username)) {
      return sendApiError(
        res,
        429,
        'RATE_LIMITED',
        'Too many login attempts. Try again in 15 minutes.'
      );
    }

    const user = await repository.findUserByUsername(username);
    const passwordHash = user?.passwordHash ?? (await getDummyPasswordHash());
    const passwordMatches = await verifyPassword(
      parsed.data.password,
      passwordHash
    );
    if (!user || !user.isActive || !passwordMatches) {
      return sendApiError(
        res,
        401,
        'INVALID_CREDENTIALS',
        'Invalid username or password.'
      );
    }

    const updated = await repository.updateUser(user.id, {
      lastLoginAt: new Date().toISOString(),
    });
    if (!updated || !updated.isActive) {
      return sendApiError(
        res,
        401,
        'INVALID_CREDENTIALS',
        'Invalid username or password.'
      );
    }

    const token = createSessionToken(updated.id, config.jwtSecret);
    res.cookie(
      SESSION_COOKIE,
      token,
      sessionCookieOptions(config.cookieDomain)
    );
    return res
      .status(200)
      .json(loginResponseSchema.parse({ user: toSafeUser(updated) }));
  });

  router.get('/me', (req, res) => {
    const user = (req as RequestWithContext).authUser;
    if (!user)
      throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication is required.');
    return res
      .status(200)
      .json(meResponseSchema.parse({ user: toSafeUser(user) }));
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(
      SESSION_COOKIE,
      clearSessionCookieOptions(config.cookieDomain)
    );
    return res.status(204).end();
  });

  router.post('/change-password', async (req, res) => {
    const request = req as RequestWithContext;
    const user = request.authUser;
    if (!user)
      throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication is required.');
    const parsed = changePasswordRequestSchema.safeParse(bodyOf<unknown>(req));
    if (!parsed.success) throw payloadError();
    if (!isPasswordSupportedByBcrypt(parsed.data.newPassword)) {
      throw payloadError();
    }

    if (
      !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))
    ) {
      return sendApiError(
        res,
        400,
        'CURRENT_PASSWORD_INVALID',
        'Current password is incorrect.'
      );
    }
    const updated = await repository.updateUser(user.id, {
      passwordHash: await hashPassword(parsed.data.newPassword),
      mustChangePassword: false,
    });
    if (!updated || !updated.isActive) {
      return sendApiError(
        res,
        401,
        'UNAUTHENTICATED',
        'Authentication is required.'
      );
    }
    return res
      .status(200)
      .json(changePasswordResponseSchema.parse({ user: toSafeUser(updated) }));
  });

  return router;
}
