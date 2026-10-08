import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAdminSettings,
  updateFirstLoginPasswordSetting,
} from './adminSettings';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('admin first-login password setting API', () => {
  it('reads the direct settings shape from GET /admin/settings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ requirePasswordChangeAtFirstLogin: true }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getAdminSettings()).resolves.toEqual({
      requirePasswordChangeAtFirstLogin: true,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/settings');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBeUndefined();
  });

  it('patches the direct settings shape with the required mutation header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ requirePasswordChangeAtFirstLogin: false }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(updateFirstLoginPasswordSetting(false)).resolves.toEqual({
      requirePasswordChangeAtFirstLogin: false,
    });
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/admin/settings');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      requirePasswordChangeAtFirstLogin: false,
    });
    expect(new Headers(init.headers).get('X-Requested-With')).toBe(
      'choirscore'
    );
    expect(init.credentials).toBe('same-origin');
  });
});
