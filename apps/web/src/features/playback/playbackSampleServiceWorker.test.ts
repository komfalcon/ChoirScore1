import { describe, expect, it, vi } from 'vitest';
import {
  activatePlaybackSampleCache,
  isVersionedPlaybackSample,
  PLAYBACK_SAMPLE_CACHE_NAME,
  PLAYBACK_SAMPLE_CACHE_PREFIX,
  respondWithCachedSample,
} from './playback-sample-sw.js';

const ORIGIN = 'https://choir.example';
const C3_SAMPLE = `${ORIGIN}/assets/choir-c3-0123abcd.wav`;
const C4_SAMPLE = `${ORIGIN}/assets/choir-c4-89abcdef.wav`;

function makeCacheStorage() {
  const entries = new Map<string, Map<string, Response>>();
  const open = vi.fn(async (name: string) => {
    const bucket = entries.get(name) ?? new Map<string, Response>();
    entries.set(name, bucket);
    return {
      match: async (request: Request) => bucket.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => {
        bucket.set(request.url, response.clone());
      },
      keys: async () => [...bucket.keys()].map((url) => new Request(url)),
      delete: async (request: Request) => bucket.delete(request.url),
    };
  });
  const cacheStorage = {
    open,
    keys: async () => [...entries.keys()],
    delete: async (name: string) => entries.delete(name),
  };
  return { cacheStorage, entries, open };
}

describe('playback sample service worker', () => {
  it('fetches and caches a versioned sample on first Play, then serves it again offline', async () => {
    const { cacheStorage } = makeCacheStorage();
    const request = new Request(C3_SAMPLE);
    const fetchOnline: typeof fetch = vi.fn(
      async () => new Response('c3 sample bytes', { status: 200 })
    );

    const firstPlayResponse = await respondWithCachedSample(request, {
      cacheStorage,
      fetchImpl: fetchOnline,
      origin: ORIGIN,
    });
    expect(await firstPlayResponse.text()).toBe('c3 sample bytes');
    expect(fetchOnline).toHaveBeenCalledOnce();

    const fetchOffline: typeof fetch = vi.fn(async () => {
      throw new Error('Network unavailable.');
    });
    const repeatPlayResponse = await respondWithCachedSample(
      new Request(C3_SAMPLE),
      { cacheStorage, fetchImpl: fetchOffline, origin: ORIGIN }
    );

    expect(await repeatPlayResponse.text()).toBe('c3 sample bytes');
    expect(fetchOffline).not.toHaveBeenCalled();
  });

  it('matches only same-origin, versioned public sample paths and bypasses API/private scores', async () => {
    const { cacheStorage, open } = makeCacheStorage();
    const fetchImpl: typeof fetch = vi.fn(
      async () => new Response('network response', { status: 200 })
    );

    expect(isVersionedPlaybackSample(new Request(C3_SAMPLE), ORIGIN)).toBe(
      true
    );
    expect(
      isVersionedPlaybackSample(
        new Request(`${ORIGIN}/assets/choir-c3.wav`),
        ORIGIN
      )
    ).toBe(false);
    expect(
      isVersionedPlaybackSample(
        new Request(`${ORIGIN}/api/scores/private-score-id`),
        ORIGIN
      )
    ).toBe(false);
    expect(
      isVersionedPlaybackSample(
        new Request('https://cdn.example/assets/choir-c3-0123abcd.wav'),
        ORIGIN
      )
    ).toBe(false);

    const apiResponse = await respondWithCachedSample(
      new Request(`${ORIGIN}/api/scores/private-score-id`),
      { cacheStorage, fetchImpl, origin: ORIGIN }
    );
    expect(await apiResponse.text()).toBe('network response');
    expect(open).not.toHaveBeenCalled();
  });

  it('does not prefetch sample files during worker activation or app startup', async () => {
    const { cacheStorage } = makeCacheStorage();
    const fetchImpl: typeof fetch = vi.fn(async (input) => {
      expect(String(input)).toBe(`${ORIGIN}/playback-samples.json`);
      return new Response(JSON.stringify({ samples: [C3_SAMPLE, C4_SAMPLE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await activatePlaybackSampleCache({
      cacheStorage,
      fetchImpl,
      origin: ORIGIN,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(vi.mocked(fetchImpl).mock.calls[0]?.[0])).toBe(
      `${ORIGIN}/playback-samples.json`
    );
  });

  it('removes older playback caches and prunes obsolete hashed assets on activation', async () => {
    const { cacheStorage, entries } = makeCacheStorage();
    const olderCacheName = `${PLAYBACK_SAMPLE_CACHE_PREFIX}v0`;
    const activeCache = await cacheStorage.open(PLAYBACK_SAMPLE_CACHE_NAME);
    await activeCache.put(new Request(C3_SAMPLE), new Response('old sample'));
    await activeCache.put(
      new Request(C4_SAMPLE),
      new Response('current sample')
    );
    const olderCache = await cacheStorage.open(olderCacheName);
    await olderCache.put(new Request(C3_SAMPLE), new Response('older cache'));
    await cacheStorage.open('unrelated-cache');
    const fetchImpl: typeof fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ samples: [C4_SAMPLE] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );

    await activatePlaybackSampleCache({
      cacheStorage,
      fetchImpl,
      origin: ORIGIN,
    });

    expect(entries.has(olderCacheName)).toBe(false);
    expect(entries.has('unrelated-cache')).toBe(true);
    const remaining = [
      ...(entries.get(PLAYBACK_SAMPLE_CACHE_NAME)?.keys() ?? []),
    ];
    expect(remaining).toEqual([C4_SAMPLE]);
  });
});
