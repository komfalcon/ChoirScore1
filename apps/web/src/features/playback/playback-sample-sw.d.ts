interface PlaybackSampleCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  keys(): Promise<Request[]>;
  delete(request: Request): Promise<boolean>;
}

interface PlaybackSampleCacheStorage {
  open(name: string): Promise<PlaybackSampleCache>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

interface PlaybackSampleCacheOptions {
  cacheStorage: PlaybackSampleCacheStorage;
  fetchImpl: typeof fetch;
  origin: string;
  cacheName?: string;
}

export const PLAYBACK_SAMPLE_CACHE_PREFIX: string;
export const PLAYBACK_SAMPLE_CACHE_NAME: string;
export function isVersionedPlaybackSample(
  request: Request,
  origin: string
): boolean;
export function respondWithCachedSample(
  request: Request,
  options: PlaybackSampleCacheOptions
): Promise<Response>;
export function activatePlaybackSampleCache(
  options: PlaybackSampleCacheOptions
): Promise<void>;
