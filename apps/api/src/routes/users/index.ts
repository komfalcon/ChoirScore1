import { Router, type Request } from 'express';
import {
  bulkCreateUsersRequestSchema,
  bulkCreateUsersResponseSchema,
  createUserRequestSchema,
  createUserResponseSchema,
  resetPasswordRequestSchema,
  resetPasswordResponseSchema,
  updateUserRequestSchema,
  updateUserResponseSchema,
  userListResponseSchema,
  userRoleVoicePartSchema,
  userResponseSchema,
} from '@choirscore/shared';
import type { ApiRepository, UserPatch } from '../../db/repository';
import { ApiError } from '../../errors';
import { requireRole } from '../../middleware/auth';
import {
  generateReadablePassword,
  hashPassword,
} from '../../security/password';
import { runAdminAction } from '../../services/adminAction';
import {
  createAccount,
  normalizeUsername,
  toSafeUser,
} from '../../services/users';

type CreatedAccount = NonNullable<Awaited<ReturnType<typeof createAccount>>>;

function requestBody<T>(request: Request) {
  return request.body as T;
}

function invalidPayload() {
  return new ApiError(
    400,
    'VALIDATION_ERROR',
    'The request payload is invalid.'
  );
}

function notFound() {
  return new ApiError(404, 'NOT_FOUND', 'The requested user was not found.');
}

function assertBodyless(request: Request) {
  if (request.body !== undefined) throw invalidPayload();
}

export function createUsersRouter(repository: ApiRepository) {
  const router = Router();
  router.use(requireRole(['admin']));

  router.get('/', async (req, res) => {
    const query =
      typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
    if (query && query.length > 100) throw invalidPayload();
    const users = await repository.listUsers(query);
    const response = userListResponseSchema.parse({
      users: users.map(toSafeUser),
    });
    await runAdminAction(
      repository,
      req,
      'users.list',
      'users',
      null,
      { searchApplied: Boolean(query) },
      async () => response
    );
    return res.status(200).json(response);
  });

  router.post('/', async (req, res) => {
    const parsed = createUserRequestSchema.safeParse(requestBody<unknown>(req));
    if (!parsed.success) throw invalidPayload();
    const created = await runAdminAction(
      repository,
      req,
      'users.create',
      'user',
      (result: CreatedAccount) => result.user.id,
      { credentialSecretsRedacted: true },
      async (tx) => {
        const requireChange =
          (await tx.getSetting('requirePasswordChangeAtFirstLogin')) !==
          'false';
        const account = await createAccount(
          tx,
          parsed.data,
          requireChange,
          new Set()
        );
        if (!account)
          throw new ApiError(
            409,
            'USERNAME_TAKEN',
            'That username is already in use.'
          );
        return account;
      }
    );
    return res.status(201).json(createUserResponseSchema.parse(created));
  });

  router.post('/bulk', async (req, res) => {
    const parsed = bulkCreateUsersRequestSchema.safeParse(
      requestBody<unknown>(req)
    );
    if (!parsed.success) throw invalidPayload();
    const created = await runAdminAction(
      repository,
      req,
      'users.bulk_create',
      'users',
      null,
      (result: CreatedAccount[]) => ({
        count: result.length,
        credentialSecretsRedacted: true,
      }),
      async (tx) => {
        const requireChange =
          (await tx.getSetting('requirePasswordChangeAtFirstLogin')) !==
          'false';
        const reserved = new Set<string>();
        const accounts = [];
        for (const row of parsed.data.users) {
          const account = await createAccount(tx, row, requireChange, reserved);
          if (!account)
            throw new ApiError(
              409,
              'USERNAME_TAKEN',
              'That username is already in use.'
            );
          accounts.push(account);
        }
        return accounts;
      }
    );
    return res
      .status(201)
      .json(bulkCreateUsersResponseSchema.parse({ users: created }));
  });

  router.patch('/:id', async (req, res) => {
    const parsed = updateUserRequestSchema.safeParse(requestBody<unknown>(req));
    if (!parsed.success) throw invalidPayload();
    const update = parsed.data;
    const allowedFields = Object.keys(update);
    const updated = await runAdminAction(
      repository,
      req,
      'users.update',
      'user',
      req.params.id,
      { changedFields: allowedFields },
      async (tx) => {
        const current = await tx.findUserById(req.params.id);
        if (!current) throw notFound();
        const role = update.role ?? current.role;
        const voicePart =
          update.voicePart ??
          (update.role && update.role !== 'member'
            ? 'none'
            : current.voicePart);
        const roleVoice = userRoleVoicePartSchema.safeParse({
          role,
          voicePart,
        });
        if (!roleVoice.success) throw invalidPayload();

        const patch: UserPatch = {
          ...update,
          ...(update.username !== undefined
            ? { username: normalizeUsername(update.username) }
            : {}),
          role: roleVoice.data.role,
          voicePart: roleVoice.data.voicePart,
        };
        const result = await tx.updateUser(current.id, patch);
        if (!result) throw notFound();
        return toSafeUser(result);
      }
    );
    return res
      .status(200)
      .json(updateUserResponseSchema.parse({ user: updated }));
  });

  router.post('/:id/reset-password', async (req, res) => {
    const parsed = resetPasswordRequestSchema.safeParse(req.body);
    if (!parsed.success) throw invalidPayload();
    const credentials = await runAdminAction(
      repository,
      req,
      'users.reset_password',
      'user',
      req.params.id,
      { credentialSecretsRedacted: true },
      async (tx) => {
        const current = await tx.findUserById(req.params.id);
        if (!current) throw notFound();
        const password = generateReadablePassword();
        const requireChange =
          (await tx.getSetting('requirePasswordChangeAtFirstLogin')) !==
          'false';
        const updated = await tx.updateUser(current.id, {
          passwordHash: await hashPassword(password),
          mustChangePassword: requireChange,
        });
        if (!updated) throw notFound();
        return { username: updated.username, password };
      }
    );
    return res
      .status(200)
      .json(resetPasswordResponseSchema.parse({ credentials }));
  });

  router.post('/:id/activate', async (req, res) => {
    assertBodyless(req);
    const user = await runAdminAction(
      repository,
      req,
      'users.activate',
      'user',
      req.params.id,
      {},
      async (tx) => {
        const updated = await tx.updateUser(req.params.id, { isActive: true });
        if (!updated) throw notFound();
        return toSafeUser(updated);
      }
    );
    return res.status(200).json(userResponseSchema.parse({ user }));
  });

  router.post('/:id/deactivate', async (req, res) => {
    assertBodyless(req);
    const user = await runAdminAction(
      repository,
      req,
      'users.deactivate',
      'user',
      req.params.id,
      {},
      async (tx) => {
        const updated = await tx.updateUser(req.params.id, { isActive: false });
        if (!updated) throw notFound();
        return toSafeUser(updated);
      }
    );
    return res.status(200).json(userResponseSchema.parse({ user }));
  });

  return router;
}
