import type { ErrorRequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import type { RequestWithContext } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string
) {
  const recordFailure = res.locals.recordAdminMutationFailure as
    ((status: number, errorCode: string) => Promise<void>) | undefined;
  if (recordFailure) await recordFailure(status, code);
  return res.status(status).json({ error: { code, message } });
}

export const errorHandler: ErrorRequestHandler = async (
  error: unknown,
  req,
  res,
  _next
) => {
  if (res.headersSent) return;
  const requestId = (req as RequestWithContext).context?.requestId;
  if (error instanceof ApiError) {
    await sendApiError(res, error.status, error.code, error.message);
    return;
  }
  if (error instanceof ZodError) {
    await sendApiError(
      res,
      400,
      'VALIDATION_ERROR',
      'The request payload is invalid.'
    );
    return;
  }

  const candidate = error as {
    type?: unknown;
    status?: unknown;
    message?: unknown;
  };
  if (candidate?.type === 'entity.too.large' || candidate?.status === 413) {
    await sendApiError(
      res,
      413,
      'BODY_TOO_LARGE',
      'The request body exceeds the allowed size.'
    );
    return;
  }
  if (candidate?.type === 'entity.parse.failed') {
    await sendApiError(
      res,
      400,
      'INVALID_JSON',
      'The request body must be valid JSON.'
    );
    return;
  }

  const message =
    typeof candidate?.message === 'string' ? candidate.message : '';
  if (
    /UNIQUE constraint failed: users\.username|users\.username/i.test(message)
  ) {
    await sendApiError(
      res,
      409,
      'USERNAME_TAKEN',
      'That username is already in use.'
    );
    return;
  }

  // Deliberately omit exception messages, query data and request bodies from logs.
  console.error(
    JSON.stringify({
      event: 'api_error',
      requestId: requestId ?? null,
      method: req.method,
      path: req.path,
      status: 500,
      errorType: error instanceof Error ? error.name : 'unknown',
    })
  );
  await sendApiError(
    res,
    500,
    'INTERNAL_ERROR',
    'An unexpected error occurred.'
  );
};
