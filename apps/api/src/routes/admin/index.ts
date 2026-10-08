import { Router, type Request } from 'express';
import {
  getAdminSettingsResponseSchema,
  patchAdminSettingsRequestSchema,
  patchAdminSettingsResponseSchema,
} from '@choirscore/shared';
import type { ApiRepository } from '../../db/repository';
import { ApiError } from '../../errors';
import { requireRole } from '../../middleware/auth';
import { runAdminAction } from '../../services/adminAction';

function invalidPayload() {
  return new ApiError(
    400,
    'VALIDATION_ERROR',
    'The request payload is invalid.'
  );
}

export function createAdminRouter(repository: ApiRepository) {
  const router = Router();
  router.use(requireRole(['admin']));

  router.get('/settings', async (req, res) => {
    const settings = getAdminSettingsResponseSchema.parse({
      requirePasswordChangeAtFirstLogin:
        (await repository.getSetting('requirePasswordChangeAtFirstLogin')) !==
        'false',
    });
    await runAdminAction(
      repository,
      req,
      'admin.settings.read',
      'settings',
      'requirePasswordChangeAtFirstLogin',
      { fields: ['requirePasswordChangeAtFirstLogin'] },
      async () => settings
    );
    return res.status(200).json(settings);
  });

  router.patch('/settings', async (req: Request, res) => {
    const parsed = patchAdminSettingsRequestSchema.safeParse(req.body);
    if (!parsed.success) throw invalidPayload();
    const result = await runAdminAction(
      repository,
      req,
      'admin.settings.update',
      'settings',
      'requirePasswordChangeAtFirstLogin',
      { changedFields: ['requirePasswordChangeAtFirstLogin'] },
      async (tx) => {
        const actorId =
          (req as Request & { authUser?: { id: string } }).authUser?.id ?? null;
        await tx.setSetting(
          'requirePasswordChangeAtFirstLogin',
          String(parsed.data.requirePasswordChangeAtFirstLogin),
          actorId,
          new Date().toISOString()
        );
        return parsed.data;
      }
    );
    return res.status(200).json(patchAdminSettingsResponseSchema.parse(result));
  });

  return router;
}
