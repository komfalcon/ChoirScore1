import { midiForPitch } from './pitch.js';
import { scorePitchSchema } from './scoreModel.js';
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

/** Keep only configured ranges for this score; absent parts need no fit range. */
export function voiceRangesForScoreParts(
  parts: ReadonlyArray<{ id: string }>,
  ranges: VoiceRanges
): VoiceRanges {
  const relevantRanges = Object.create(null) as Record<string, PartVoiceRange>;
  for (const part of parts) {
    if (Object.hasOwn(ranges, part.id)) {
      relevantRanges[part.id] = ranges[part.id]!;
    }
  }
  return relevantRanges;
}
