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
  repository: Pick<ApiRepository, 'getSetting'>,
  defaultDailyLimit: number
) {
  const [passwordSetting, voiceRanges, aiGlobalSetting, aiLimitSetting] =
    await Promise.all([
      repository.getSetting('requirePasswordChangeAtFirstLogin'),
      readVoiceRanges(repository),
      repository.getSetting('ai_global_enabled'),
      repository.getSetting('ai_default_daily_limit'),
    ]);
  const storedDailyLimit = Number(aiLimitSetting);
  const aiDefaultDailyLimit =
    aiLimitSetting !== null &&
    Number.isSafeInteger(storedDailyLimit) &&
    storedDailyLimit >= 0
      ? storedDailyLimit
      : defaultDailyLimit;
  return getAdminSettingsResponseSchema.parse({
    requirePasswordChangeAtFirstLogin: passwordSetting !== 'false',
    voiceRanges,
    aiGlobalEnabled: aiGlobalSetting === null || aiGlobalSetting === 'true',
    aiDefaultDailyLimit,
  });
}

export function createAdminRouter(
  repository: ApiRepository,
  defaultDailyLimit = 20
) {
  const router = Router();
  router.use(requireRole(['admin']));

  router.get('/settings', async (req, res) => {
    const settings = await readAdminSettings(repository, defaultDailyLimit);
    await runAdminAction(
      repository,
      req,
      'admin.settings.read',
      'settings',
      null,
      {
        fields: [
          'requirePasswordChangeAtFirstLogin',
          'voiceRanges',
          'aiGlobalEnabled',
          'aiDefaultDailyLimit',
        ],
      },
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
        const settingKeys: Record<string, string> = {
          requirePasswordChangeAtFirstLogin:
            'requirePasswordChangeAtFirstLogin',
          voiceRanges: 'voice_ranges_json',
          aiGlobalEnabled: 'ai_global_enabled',
          aiDefaultDailyLimit: 'ai_default_daily_limit',
        };
        return changedFields.length === 1
          ? (settingKeys[changedFields[0]!] ?? null)
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
        if (parsed.data.aiGlobalEnabled !== undefined) {
          await tx.setSetting(
            'ai_global_enabled',
            String(parsed.data.aiGlobalEnabled),
            actorId,
            updatedAt
          );
        }
        if (parsed.data.aiDefaultDailyLimit !== undefined) {
          await tx.setSetting(
            'ai_default_daily_limit',
            String(parsed.data.aiDefaultDailyLimit),
            actorId,
            updatedAt
          );
        }
        return readAdminSettings(tx, defaultDailyLimit);
      }
    );
    return res.status(200).json(patchAdminSettingsResponseSchema.parse(result));
  });

  return router;
}
