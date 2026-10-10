import { Router, type Request } from 'express';
import {
  getAdminAiUsageResponseSchema,
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

const USAGE_WINDOW_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function emptyUsageDay(date: string) {
  return {
    date,
    requests: 0,
    succeededRequests: 0,
    failedRequests: 0,
    pendingRequests: 0,
    tokensIn: 0,
    tokensOut: 0,
    totalTokens: 0,
  };
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
  defaultDailyLimit = 20,
  now: () => Date = () => new Date()
) {
  const router = Router();
  router.use(requireRole(['admin']));

  router.get('/usage', async (req, res) => {
    const asOf = now();
    const todayStartMs = Date.UTC(
      asOf.getUTCFullYear(),
      asOf.getUTCMonth(),
      asOf.getUTCDate()
    );
    const windowStartMs =
      todayStartMs - (USAGE_WINDOW_DAYS - 1) * MILLISECONDS_PER_DAY;
    const windowEndExclusiveMs = todayStartMs + MILLISECONDS_PER_DAY;
    const windowStart = new Date(windowStartMs).toISOString();
    const windowEndExclusive = new Date(windowEndExclusiveMs).toISOString();
    const { users, daily: aggregateDays } =
      await repository.getAiUsageDashboard(
        windowStart,
        windowEndExclusive,
        new Date(todayStartMs).toISOString()
      );
    const dayByDate = new Map(aggregateDays.map((day) => [day.date, day]));
    const daily = Array.from({ length: USAGE_WINDOW_DAYS }, (_, index) => {
      const date = new Date(windowStartMs + index * MILLISECONDS_PER_DAY)
        .toISOString()
        .slice(0, 10);
      return dayByDate.get(date) ?? emptyUsageDay(date);
    });
    const response = getAdminAiUsageResponseSchema.parse({
      asOf: asOf.toISOString(),
      windowStart,
      windowEndExclusive,
      days: USAGE_WINDOW_DAYS,
      users,
      daily,
    });
    await runAdminAction(
      repository,
      req,
      'admin.ai_usage.read',
      'ai_usage',
      null,
      { windowDays: USAGE_WINDOW_DAYS },
      async () => response
    );
    return res.status(200).json(response);
  });

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
