import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAdminSettings,
  updateFirstLoginPasswordSetting,
  updateVoiceRangesSetting,
} from './adminSettings';
import { DEFAULT_VOICE_RANGES } from '@choirscore/shared';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('admin first-login password setting API', () => {
  it('reads the direct settings shape from GET /admin/settings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          requirePasswordChangeAtFirstLogin: true,
          voiceRanges: DEFAULT_VOICE_RANGES,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getAdminSettings()).resolves.toEqual({
      requirePasswordChangeAtFirstLogin: true,
      voiceRanges: DEFAULT_VOICE_RANGES,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/settings');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBeUndefined();
  });

  it('patches the direct settings shape with the required mutation header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          requirePasswordChangeAtFirstLogin: false,
          voiceRanges: DEFAULT_VOICE_RANGES,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(updateFirstLoginPasswordSetting(false)).resolves.toEqual({
      requirePasswordChangeAtFirstLogin: false,
      voiceRanges: DEFAULT_VOICE_RANGES,
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

  it('patches voice ranges through the existing admin settings endpoint', async () => {
    const updatedRanges = structuredClone(DEFAULT_VOICE_RANGES);
    updatedRanges.T.comfortable = { low: 'D3', high: 'G4' };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          requirePasswordChangeAtFirstLogin: true,
          voiceRanges: updatedRanges,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(updateVoiceRangesSetting(updatedRanges)).resolves.toEqual({
      requirePasswordChangeAtFirstLogin: true,
      voiceRanges: updatedRanges,
    });
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/admin/settings');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      voiceRanges: updatedRanges,
    });
    expect(new Headers(init.headers).get('X-Requested-With')).toBe(
      'choirscore'
    );
  });
});
