export const PLAYBACK_SAMPLE_CACHE_PREFIX = 'choirscore-playback-samples-';
export const PLAYBACK_SAMPLE_CACHE_NAME = `${PLAYBACK_SAMPLE_CACHE_PREFIX}v1`;

const VERSIONED_SAMPLE_PATH = /^\/assets\/choir-c[345]-[a-z0-9_-]{8,}\.wav$/i;

export function isVersionedPlaybackSample(request, origin) {
  if (request.method !== 'GET') return false;

  const url = new URL(request.url);
  return url.origin === origin && VERSIONED_SAMPLE_PATH.test(url.pathname);
}

export async function respondWithCachedSample(
  request,
  { cacheStorage, fetchImpl, origin, cacheName = PLAYBACK_SAMPLE_CACHE_NAME }
) {
  if (!isVersionedPlaybackSample(request, origin)) return fetchImpl(request);

  let cache;
  try {
    cache = await cacheStorage.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch {
    // Cache Storage is an optimization; a failure must not block network playback.
  }

  let response;
  try {
    response = await fetchImpl(request);
  } catch (error) {
    if (cache) {
      try {
        const cachedAfterFailure = await cache.match(request);
        if (cachedAfterFailure) return cachedAfterFailure;
      } catch {
        // Preserve the network error when both the network and cache are unavailable.
      }
    }
    throw error;
  }

  if (cache && response.ok && response.type !== 'opaque') {
    try {
      await cache.put(request, response.clone());
    } catch {
      // A cache write failure must not discard a successful network response.
    }
  }
  return response;
}

export async function activatePlaybackSampleCache({
  cacheStorage,
  fetchImpl,
  origin,
  cacheName = PLAYBACK_SAMPLE_CACHE_NAME,
}) {
  let currentSamplePaths;
  try {
    const manifestResponse = await fetchImpl(
      new URL('/playback-samples.json', origin).href,
      { cache: 'no-store' }
    );
    if (!manifestResponse.ok) return;
    const manifest = await manifestResponse.json();
    if (!Array.isArray(manifest.samples)) return;
    currentSamplePaths = new Set(
      manifest.samples
        .map((samplePath) => new URL(samplePath, origin))
        .filter((url) =>
          isVersionedPlaybackSample(new Request(url.href), origin)
        )
        .map((url) => url.pathname)
    );
  } catch {
    // Offline activation still preserves valid cache entries; hashed URLs prevent stale content.
    return;
  }

  const existingCacheNames = await cacheStorage.keys();
  await Promise.all(
    existingCacheNames
      .filter(
        (name) =>
          name.startsWith(PLAYBACK_SAMPLE_CACHE_PREFIX) && name !== cacheName
      )
      .map((name) => cacheStorage.delete(name))
  );

  const currentCache = await cacheStorage.open(cacheName);
  for (const request of await currentCache.keys()) {
    if (!currentSamplePaths.has(new URL(request.url).pathname)) {
      await currentCache.delete(request);
    }
  }
}

const workerScope = typeof self === 'undefined' ? undefined : self;
if (workerScope && typeof workerScope.addEventListener === 'function') {
  workerScope.addEventListener('install', (event) => {
    event.waitUntil(workerScope.skipWaiting());
  });

  workerScope.addEventListener('activate', (event) => {
    event.waitUntil(
      activatePlaybackSampleCache({
        cacheStorage: workerScope.caches,
        fetchImpl: workerScope.fetch.bind(workerScope),
        origin: workerScope.location.origin,
      }).then(() => workerScope.clients.claim())
    );
  });

  workerScope.addEventListener('fetch', (event) => {
    if (
      !isVersionedPlaybackSample(event.request, workerScope.location.origin)
    ) {
      return;
    }
    event.respondWith(
      respondWithCachedSample(event.request, {
        cacheStorage: workerScope.caches,
        fetchImpl: workerScope.fetch.bind(workerScope),
        origin: workerScope.location.origin,
      })
    );
  });
}
