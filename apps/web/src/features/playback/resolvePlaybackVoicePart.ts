import type { ScorePart } from '@choirscore/shared';

const CANONICAL_PART_NAMES: Record<string, string> = {
  S: 'soprano',
  A: 'alto',
  T: 'tenor',
  B: 'bass',
};

/** Resolve a profile voice label to one stable model part ID, or fail closed. */
export function resolvePlaybackVoicePart(
  parts: readonly Pick<ScorePart, 'id' | 'name'>[],
  voicePart: string | null | undefined
): string | null {
  const voice = voicePart?.trim().toUpperCase();
  const canonicalName = voice ? CANONICAL_PART_NAMES[voice] : undefined;
  if (!voice || !canonicalName) return null;

  const matchingIds = new Set(
    parts
      .filter(
        (part) =>
          part.id.trim().toUpperCase() === voice ||
          part.name?.trim().toLowerCase() === canonicalName
      )
      .map((part) => part.id)
  );

  return matchingIds.size === 1 ? [...matchingIds][0] : null;
}
