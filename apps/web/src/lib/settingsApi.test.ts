import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_RANGES } from '@choirscore/shared';
import { getVoiceRanges } from './settingsApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('settings API client', () => {
  it('loads only the member-safe voice-range profile with GET', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(DEFAULT_VOICE_RANGES), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    const ranges = await getVoiceRanges();
    expect(ranges).toEqual(DEFAULT_VOICE_RANGES);
    expect(Object.keys(ranges).sort()).toEqual(['A', 'B', 'S', 'T']);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/settings/voice-ranges');
    expect(init.method).toBeUndefined();
    expect(init.credentials).toBe('same-origin');
  });

  it('rejects malformed range profiles instead of guessing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ S: { comfortable: {}, hard: {} } }), {
          status: 200,
        })
      )
    );
    await expect(getVoiceRanges()).rejects.toThrow(
      'The settings service returned an unexpected voice-range profile.'
    );
  });
});
