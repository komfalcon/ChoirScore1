import { Router, type Request } from 'express';
import {
  aiJobStatusResponseSchema,
  aiJobSubmissionRequestSchema,
  aiJobSubmissionResponseSchema,
  aiQuotaResponseSchema,
} from '@choirscore/shared';
import { newId } from '../../audit';
import type { ApiRepository, NewAiJob } from '../../db/repository';
import { sendApiError } from '../../errors';
import type { RequestWithContext } from '../../types';

function utcDayBounds(now: Date) {
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const nextDayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  return {
    dayStart: dayStart.toISOString(),
    nextDayStart: nextDayStart.toISOString(),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])])
    );
  }
  return value;
}

function parseStoredJson(value: string | null): unknown | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function createAiRouter(
  repository: ApiRepository,
  defaultDailyLimit: number,
  now: () => Date = () => new Date()
) {
  const router = Router();

  router.get('/quota', async (req, res) => {
    const userId = (req as RequestWithContext).authUser?.id;
    if (!userId) {
      return await sendApiError(
        res,
        401,
        'UNAUTHENTICATED',
        'Authentication is required.'
      );
    }
    const currentTime = now();
    const { dayStart, nextDayStart } = utcDayBounds(currentTime);
    const quota = await repository.getAiQuota(
      userId,
      defaultDailyLimit,
      dayStart,
      nextDayStart
    );
    if (!quota) {
      return await sendApiError(
        res,
        401,
        'UNAUTHENTICATED',
        'Authentication is required.'
      );
    }
    const response = aiQuotaResponseSchema.parse({
      dailyLimit: quota.limit,
      used: quota.used,
      remaining: Math.max(0, quota.limit - quota.used),
      available:
        quota.globalEnabled && quota.userEnabled && quota.used < quota.limit,
      resetsAt: nextDayStart,
    });
    return res.status(200).json(response);
  });

  router.post('/jobs', async (req: Request, res) => {
    const parsed = aiJobSubmissionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return await sendApiError(
        res,
        400,
        'VALIDATION_ERROR',
        'The request payload is invalid.'
      );
    }
    const userId = (req as RequestWithContext).authUser?.id;
    if (!userId) {
      return await sendApiError(
        res,
        401,
        'UNAUTHENTICATED',
        'Authentication is required.'
      );
    }

    const currentTime = now();
    const { dayStart, nextDayStart } = utcDayBounds(currentTime);
    let inputJson: string;
    try {
      inputJson = JSON.stringify(canonicalize(parsed.data.input));
    } catch {
      return await sendApiError(
        res,
        400,
        'VALIDATION_ERROR',
        'The request payload is invalid.'
      );
    }
    const job: NewAiJob = {
      id: newId(),
      requestId: parsed.data.requestId,
      userId,
      feature: parsed.data.feature,
      inputJson,
      createdAt: currentTime.toISOString(),
    };
    const result = await repository.submitAiJob(
      job,
      defaultDailyLimit,
      dayStart,
      nextDayStart
    );

    if (result.status === 'idempotency_conflict') {
      return await sendApiError(
        res,
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'This request ID was already used for a different AI request.'
      );
    }
    if (result.status === 'inactive_user') {
      return await sendApiError(
        res,
        401,
        'UNAUTHENTICATED',
        'Authentication is required.'
      );
    }
    if (result.status === 'ai_disabled') {
      return await sendApiError(
        res,
        503,
        'AI_DISABLED',
        'AI requests are currently disabled.'
      );
    }
    if (result.status === 'ai_access_disabled') {
      return await sendApiError(
        res,
        403,
        'AI_ACCESS_DISABLED',
        'AI access is disabled for this account.'
      );
    }
    if (result.status === 'quota_exceeded') {
      return await sendApiError(
        res,
        429,
        'AI_QUOTA_EXCEEDED',
        'The daily AI request limit has been reached.'
      );
    }
    if (result.status === 'active_limit') {
      return await sendApiError(
        res,
        429,
        'AI_ACTIVE_LIMIT_REACHED',
        'The maximum number of active AI jobs has been reached.'
      );
    }
    if (!('job' in result)) {
      return await sendApiError(
        res,
        500,
        'INTERNAL_ERROR',
        'An unexpected error occurred.'
      );
    }

    const response = aiJobSubmissionResponseSchema.parse({
      jobId: result.job.id,
      status: result.job.status,
    });
    return res.status(202).json(response);
  });

  router.get('/jobs/:id', async (req, res) => {
    const userId = (req as RequestWithContext).authUser?.id;
    if (!userId) {
      return await sendApiError(
        res,
        401,
        'UNAUTHENTICATED',
        'Authentication is required.'
      );
    }
    const id = req.params.id;
    if (typeof id !== 'string') {
      return await sendApiError(
        res,
        404,
        'NOT_FOUND',
        'The requested AI job was not found.'
      );
    }
    const job = await repository.findAiJobById(id);
    if (!job || job.userId !== userId) {
      return await sendApiError(
        res,
        404,
        'NOT_FOUND',
        'The requested AI job was not found.'
      );
    }
    const response = aiJobStatusResponseSchema.parse({
      jobId: job.id,
      feature: job.feature,
      status: job.status,
      result: parseStoredJson(job.resultJson),
      warnings:
        job.warningsJson === null ? null : parseStoredJson(job.warningsJson),
      error: job.error,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
    });
    return res.status(200).json(response);
  });

  return router;
}
