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
import { readVoiceRanges } from '../../services/voiceRanges';

function invalidPayload() {
  return new ApiError(
    400,
    'VALIDATION_ERROR',
    'The request payload is invalid.'
  );
}

async function readAdminSettings(
  repository: Pick<ApiRepository, 'getSetting'>
) {
  const [passwordSetting, voiceRanges] = await Promise.all([
    repository.getSetting('requirePasswordChangeAtFirstLogin'),
    readVoiceRanges(repository),
  ]);
  return getAdminSettingsResponseSchema.parse({
    requirePasswordChangeAtFirstLogin: passwordSetting !== 'false',
    voiceRanges,
  });
}

export function createAdminRouter(repository: ApiRepository) {
  const router = Router();
  router.use(requireRole(['admin']));

  router.get('/settings', async (req, res) => {
    const settings = await readAdminSettings(repository);
    await runAdminAction(
      repository,
      req,
      'admin.settings.read',
      'settings',
      null,
      { fields: ['requirePasswordChangeAtFirstLogin', 'voiceRanges'] },
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
      () => {
        const changedFields = Object.keys(parsed.data);
        return changedFields.length === 1 && changedFields[0] === 'voiceRanges'
          ? 'voice_ranges_json'
          : changedFields.length === 1
            ? 'requirePasswordChangeAtFirstLogin'
            : null;
      },
      { changedFields: Object.keys(parsed.data) },
      async (tx) => {
        const actorId =
          (req as Request & { authUser?: { id: string } }).authUser?.id ?? null;
        const updatedAt = new Date().toISOString();
        if (parsed.data.requirePasswordChangeAtFirstLogin !== undefined) {
          await tx.setSetting(
            'requirePasswordChangeAtFirstLogin',
            String(parsed.data.requirePasswordChangeAtFirstLogin),
            actorId,
            updatedAt
          );
        }
        if (parsed.data.voiceRanges !== undefined) {
          await tx.setSetting(
            'voice_ranges_json',
            JSON.stringify(parsed.data.voiceRanges),
            actorId,
            updatedAt
          );
        }
        return readAdminSettings(tx);
      }
    );
    return res.status(200).json(patchAdminSettingsResponseSchema.parse(result));
  });

  return router;
}
