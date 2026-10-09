import { midiForPitch } from './pitch.js';
import { scorePitchSchema } from './scoreModel.js';
import { VoiceMappingError } from './voiceMappingError.js';
import { z } from 'zod';

export const VOICE_PART_IDS = ['S', 'A', 'T', 'B'] as const;
export const voicePartIdSchema = z.enum(VOICE_PART_IDS);
export type VoicePartId = z.infer<typeof voicePartIdSchema>;

export interface PitchRange {
  low: string;
  high: string;
}

export interface PartVoiceRange {
  comfortable: PitchRange;
  hard: PitchRange;
}

/** Ranges are keyed by the stable shared-model part id. */
export type VoiceRanges = Readonly<Record<string, PartVoiceRange>>;

function pitchRangeSchema(label: string) {
  return z
    .object({ low: scorePitchSchema, high: scorePitchSchema })
    .strict()
    .superRefine((range, context) => {
      let low: number;
      let high: number;
      try {
        low = midiForPitch(range.low);
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['low'],
          message: `${label} lower endpoint must be a supported scientific pitch.`,
        });
        return;
      }
      try {
        high = midiForPitch(range.high);
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['high'],
          message: `${label} upper endpoint must be a supported scientific pitch.`,
        });
        return;
      }
      if (low > high) {
        context.addIssue({
          code: 'custom',
          path: ['low'],
          message: `${label} lower endpoint must not be above its upper endpoint.`,
        });
      }
    });
}

export const partVoiceRangeSchema = z
  .object({
    comfortable: pitchRangeSchema('Comfortable range'),
    hard: pitchRangeSchema('Hard range'),
  })
  .strict()
  .superRefine((range, context) => {
    try {
      const comfortableLow = midiForPitch(range.comfortable.low);
      const comfortableHigh = midiForPitch(range.comfortable.high);
      const hardLow = midiForPitch(range.hard.low);
      const hardHigh = midiForPitch(range.hard.high);
      if (comfortableLow < hardLow || comfortableHigh > hardHigh) {
        context.addIssue({
          code: 'custom',
          path: ['comfortable'],
          message: 'Comfortable range must be contained within its hard range.',
        });
      }
    } catch {
      // The nested pitch-range schemas provide the endpoint validation issues.
    }
  });

/** Exact SATB settings profile shared by the admin API and M4 range-fit UI. */
export const voiceRangesSchema = z
  .object({
    S: partVoiceRangeSchema,
    A: partVoiceRangeSchema,
    T: partVoiceRangeSchema,
    B: partVoiceRangeSchema,
  })
  .strict();
export type VoicePartRanges = z.infer<typeof voiceRangesSchema>;

/** PRD §10.5 defaults. Keep the sole source of defaults here. */
export const DEFAULT_VOICE_RANGES: VoicePartRanges = Object.freeze(
  voiceRangesSchema.parse({
    S: {
      comfortable: { low: 'C4', high: 'G5' },
      hard: { low: 'B3', high: 'A5' },
    },
    A: {
      comfortable: { low: 'G3', high: 'D5' },
      hard: { low: 'F3', high: 'E5' },
    },
    T: {
      comfortable: { low: 'C3', high: 'G4' },
      hard: { low: 'B2', high: 'A4' },
    },
    B: {
      comfortable: { low: 'E2', high: 'D4' },
      hard: { low: 'D2', high: 'F4' },
    },
  })
);

export function isVoicePartId(value: string): value is VoicePartId {
  return voicePartIdSchema.safeParse(value).success;
}

const VOICE_PART_NAMES: Readonly<Record<VoicePartId, string>> = {
  S: 'Soprano',
  A: 'Alto',
  T: 'Tenor',
  B: 'Bass',
};

export interface ScoreVoicePartMapping {
  /** Canonical SATB identity for each opaque score-part ID. */
  byPartId: Readonly<Record<string, VoicePartId>>;
  /** Actual score-part ID for each uniquely mapped SATB identity. */
  byVoicePart: Readonly<Partial<Record<VoicePartId, string>>>;
}

function compareScorePartIds(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function canonicalVoicePartName(name: string | undefined): VoicePartId | null {
  const normalized = name?.trim().toLocaleLowerCase('en-US');
  if (!normalized) return null;
  return (
    VOICE_PART_IDS.find(
      (voicePart) =>
        normalized === voicePart.toLowerCase() ||
        normalized === VOICE_PART_NAMES[voicePart].toLowerCase()
    ) ?? null
  );
}

/**
 * Resolve only exact canonical SATB IDs or names. IDs remain opaque outside
 * this explicit boundary; P1–P4 imports are resolved from their part names.
 * Any missing, conflicting, or duplicate identity fails closed.
 */
export function mapScorePartsToVoiceParts(
  parts: ReadonlyArray<{ id: string; name?: string }>
): ScoreVoicePartMapping {
  const sortedParts = [...parts].sort((first, second) =>
    compareScorePartIds(first.id, second.id)
  );
  const seenIds = new Set<string>();
  for (const part of sortedParts) {
    if (seenIds.has(part.id)) {
      throw new VoiceMappingError(
        'duplicate-part-id',
        [part.id],
        'Score part IDs must be unique for voice-range mapping.'
      );
    }
    seenIds.add(part.id);
  }

  const byPartId = Object.create(null) as Record<string, VoicePartId>;
  const byVoicePart = Object.create(null) as Partial<
    Record<VoicePartId, string>
  >;

  for (const part of sortedParts) {
    const idVoicePart = isVoicePartId(part.id) ? part.id : null;
    const nameVoicePart = canonicalVoicePartName(part.name);
    if (idVoicePart && nameVoicePart && idVoicePart !== nameVoicePart) {
      throw new VoiceMappingError(
        'conflicting-identities',
        [part.id],
        `Score part ${part.id} has conflicting canonical voice identities (${idVoicePart} ID, ${nameVoicePart} name).`
      );
    }
    const voicePart = idVoicePart ?? nameVoicePart;
    if (!voicePart) {
      throw new VoiceMappingError(
        'unmapped-part',
        [part.id],
        `Score part ${part.id} has no canonical SATB ID or voice name.`
      );
    }
    const previousPartId = byVoicePart[voicePart];
    if (previousPartId !== undefined) {
      throw new VoiceMappingError(
        'duplicate-identity',
        [previousPartId, part.id],
        `Ambiguous voice-range mapping: score parts ${previousPartId} and ${part.id} both map to ${VOICE_PART_NAMES[voicePart]} (${voicePart}).`
      );
    }
    byPartId[part.id] = voicePart;
    byVoicePart[voicePart] = part.id;
  }

  return { byPartId, byVoicePart };
}

/** Resolve a member's canonical profile voice part to its actual score ID. */
export function scorePartIdForVoicePart(
  parts: ReadonlyArray<{ id: string; name?: string }>,
  voicePart: VoicePartId
): string | null {
  return mapScorePartsToVoiceParts(parts).byVoicePart[voicePart] ?? null;
}

/** Map canonical settings ranges onto actual, uniquely identified score IDs. */
export function voiceRangesForScoreParts(
  parts: ReadonlyArray<{ id: string; name?: string }>,
  ranges: VoiceRanges
): VoiceRanges {
  const mapping = mapScorePartsToVoiceParts(parts);
  const invalidProfileKey = Object.keys(ranges)
    .filter((key) => !isVoicePartId(key))
    .sort(compareScorePartIds)[0];
  if (invalidProfileKey !== undefined) {
    throw new VoiceMappingError(
      'noncanonical-profile-key',
      [],
      `Voice-range settings key ${invalidProfileKey} is not a canonical SATB profile key.`
    );
  }

  const relevantRanges = Object.create(null) as Record<string, PartVoiceRange>;
  for (const part of [...parts].sort((first, second) =>
    compareScorePartIds(first.id, second.id)
  )) {
    const voicePart = mapping.byPartId[part.id]!;
    if (!Object.hasOwn(ranges, voicePart)) {
      throw new VoiceMappingError(
        'missing-profile-range',
        [part.id],
        `No configured voice range is available for score part ${part.id} (${voicePart}).`
      );
    }
    relevantRanges[part.id] = ranges[voicePart]!;
  }
  return relevantRanges;
}
