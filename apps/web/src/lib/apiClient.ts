import type { ApiErrorResponse } from '@choirscore/shared';

const DEFAULT_API_BASE = '/api';
const CSRF_HEADER = 'X-Requested-With';
const CSRF_VALUE = 'choirscore';

export type ApiErrorBody = ApiErrorResponse['error'];

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
  }
}

export function isUsernameTakenError(error: unknown) {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.code === 'USERNAME_TAKEN'
  );
}

type PasswordChangeRequiredListener = () => void;
const passwordChangeRequiredListeners =
  new Set<PasswordChangeRequiredListener>();

export function subscribeToPasswordChangeRequired(
  listener: PasswordChangeRequiredListener
) {
  passwordChangeRequiredListeners.add(listener);
  return () => {
    passwordChangeRequiredListeners.delete(listener);
  };
}

export function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE ?? DEFAULT_API_BASE;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set(CSRF_HEADER, CSRF_VALUE);
  }

  const response = await fetch(`${getApiBaseUrl()}${normalizedPath}`, {
    ...init,
    credentials: 'same-origin',
    headers,
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const errorPayload =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'object' &&
      payload.error !== null
        ? payload.error
        : null;
    const body: ApiErrorBody =
      errorPayload &&
      'code' in errorPayload &&
      typeof errorPayload.code === 'string' &&
      'message' in errorPayload &&
      typeof errorPayload.message === 'string'
        ? { code: errorPayload.code, message: errorPayload.message }
        : {
            code: `HTTP_${response.status}`,
            message: `The request failed with status ${response.status}.`,
          };

    const error = new ApiError(response.status, body);
    if (error.status === 403 && error.code === 'PASSWORD_CHANGE_REQUIRED') {
      for (const listener of passwordChangeRequiredListeners) {
        try {
          listener();
        } catch {
          // Preserve the API error even if an observer fails.
        }
      }
    }
    throw error;
  }

  return response;
}
