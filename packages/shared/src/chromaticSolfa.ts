export type DiatonicSolfaSyllable = 'd' | 'r' | 'm' | 'f' | 's' | 'l' | 't';
export type ChromaticSolfaSyllable =
  'di' | 'ri' | 'fi' | 'si' | 'li' | 'ra' | 'me' | 'se' | 'le' | 'te';
export type ChromaticAlteration = 'raised' | 'lowered';

/**
 * Modern spelled-degree movable-Do alterations relative to the active
 * diatonic scale. This lookup is spelling/function-based, never melodic-direction-based.
 */
const CHROMATIC_SOLFA: Record<
  DiatonicSolfaSyllable,
  Partial<Record<ChromaticAlteration, ChromaticSolfaSyllable>>
> = {
  d: { raised: 'di' },
  r: { raised: 'ri', lowered: 'ra' },
  m: { lowered: 'me' },
  f: { raised: 'fi' },
  s: { raised: 'si', lowered: 'se' },
  l: { raised: 'li', lowered: 'le' },
  t: { lowered: 'te' },
};

export function chromaticSolfaSyllable(
  degree: DiatonicSolfaSyllable,
  alteration: ChromaticAlteration
): ChromaticSolfaSyllable | undefined {
  return CHROMATIC_SOLFA[degree][alteration];
}
