import { createHash } from 'node:crypto';

/**
 * Embed the generated sample manifest identity in the worker source. Browsers
 * compare service-worker bytes when checking for updates, so asset-only hash
 * changes must also change this source to trigger manifest refresh/old-cache
 * pruning on activation.
 */
export function withPlaybackSampleManifestDigest(
  workerSource: string,
  manifestSource: string
): string {
  const digest = createHash('sha256').update(manifestSource).digest('hex');
  return `// playback sample manifest sha256: ${digest}\n${workerSource}`;
}
