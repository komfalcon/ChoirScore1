import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiFetch,
  subscribeToPasswordChangeRequired,
} from './apiClient';
import { jsonRequest } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch contract behavior', () => {
  it('adds the ChoirScore requested-with header to mutations and keeps the cookie session same-origin', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/auth/logout', { method: 'POST', body: '{}' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('X-Requested-With')).toBe('choirscore');
    expect(init.credentials).toBe('same-origin');
  });

  it('requires the CSRF header on auth, user, and settings mutations and never widens cookie scope', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const requests: Array<[string, RequestInit]> = [
      ['/auth/login', { method: 'POST', credentials: 'include' }],
      ['/auth/logout', { method: 'POST' }],
      ['/auth/change-password', { method: 'POST' }],
      ['/users', { method: 'POST' }],
      ['/users/bulk', { method: 'POST' }],
      ['/users/user-id', { method: 'PATCH' }],
      ['/users/user-id/reset-password', { method: 'POST' }],
      ['/users/user-id/deactivate', { method: 'POST' }],
      ['/users/user-id/activate', { method: 'POST' }],
      ['/admin/settings', { method: 'PATCH' }],
    ];

    for (const [path, init] of requests) await apiFetch(path, init);

    for (const [, init] of fetchMock.mock.calls as Array<
      [string, RequestInit]
    >) {
      expect(new Headers(init.headers).get('X-Requested-With')).toBe(
        'choirscore'
      );
      expect(init.credentials).toBe('same-origin');
    }
  });

  it('does not add the mutation header to reads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/auth/me');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has('X-Requested-With')).toBe(false);
  });

  it('preserves structured server code/message and status from the frozen error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Username or password is incorrect.',
            },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    await expect(
      apiFetch('/auth/login', { method: 'POST', body: '{}' })
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Username or password is incorrect.',
    } satisfies Partial<ApiError>);
  });

  it('notifies the signed-in app when a later protected request requires password setup', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToPasswordChangeRequired(listener);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'PASSWORD_CHANGE_REQUIRED',
            message: 'A password change is required.',
          },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(apiFetch('/users')).rejects.toMatchObject({
        status: 403,
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
      expect(listener).toHaveBeenCalledOnce();

      listener.mockClear();
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 'FORBIDDEN', message: 'Forbidden.' },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        )
      );
      await expect(apiFetch('/users')).rejects.toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
      });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('creates body-less requests without an empty JSON body or content type', () => {
    expect(jsonRequest('POST')).toEqual({ method: 'POST' });
  });
});
