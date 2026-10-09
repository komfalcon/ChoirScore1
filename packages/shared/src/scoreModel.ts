import { z } from 'zod';

export const scoreKeyModeSchema = z.enum([
  'major',
  'minor',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'aeolian',
  'ionian',
  'locrian',
  'none',
]);
export type ScoreKeyMode = z.infer<typeof scoreKeyModeSchema>;

export const scoreKeySchema = z
  .object({
    fifths: z.number().int().min(-7).max(7),
    mode: scoreKeyModeSchema,
  })
  .strict();
export type ScoreKey = z.infer<typeof scoreKeySchema>;

export const scoreTimeSchema = z
  .object({
    beats: z.number().int().positive(),
    beatType: z.number().int().positive(),
  })
  .strict();
export type ScoreTime = z.infer<typeof scoreTimeSchema>;

export const scoreClefSchema = z.enum(['treble', 'bass', 'treble8vb']);
export type ScoreClef = z.infer<typeof scoreClefSchema>;

export const scoreSyllabicSchema = z.enum(['single', 'begin', 'middle', 'end']);
export type ScoreSyllabic = z.infer<typeof scoreSyllabicSchema>;

export const scoreLyricSchema = z
  .object({
    text: z.string(),
    syllabic: scoreSyllabicSchema.optional(),
    /** MusicXML lyric verse number; omitted values default to their array order. */
    verse: z.number().int().positive().max(64).optional(),
  })
  .strict();
export type ScoreLyric = z.infer<typeof scoreLyricSchema>;

export const scoreTupletSchema = z
  .object({
    actualNotes: z.number().int().positive(),
    normalNotes: z.number().int().positive(),
    normalType: z
      .enum(['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th'])
      .optional(),
  })
  .strict();
export type ScoreTuplet = z.infer<typeof scoreTupletSchema>;

export const scorePitchSchema = z
  .string()
  .regex(
    /^[A-G](?:#{1,2}|b{1,2})?-?\d+$/,
    'Expected scientific pitch, e.g. F#4 or Bb3.'
  );

export const scoreNoteSchema = z
  .object({
    /** Scientific pitch; null represents a rest. */
    pitch: scorePitchSchema.nullable(),
    /** Performed duration in quarter-note units; fractional tuplets are valid. */
    dur: z.number().finite().positive().max(64),
    /** True when this note is tied to the following note. */
    tie: z.boolean().default(false),
    lyric: scoreLyricSchema.optional(),
    /** Additional lyric verses; `lyric` remains the first-verse compatibility field. */
    lyrics: z.array(scoreLyricSchema).min(1).max(64).optional(),
    /** MusicXML voice number/name; retained for multiple voices per staff. */
    voice: z.string().trim().min(1).max(32).default('1'),
    /** MusicXML staff number; retained for multi-staff parts. */
    staff: z.number().int().positive().default(1),
    /** Onset from the beginning of the measure, in quarter-note units. */
    onset: z.number().finite().nonnegative().optional(),
    /** MusicXML chord member sharing the preceding note's onset. */
    chord: z.boolean().default(false),
    /** Tuplet ratio metadata; `dur` remains the performed duration. */
    tuplet: scoreTupletSchema.optional(),
  })
  .strict();
export type ScoreNote = z.infer<typeof scoreNoteSchema>;
export type ScoreNoteInput = z.input<typeof scoreNoteSchema>;

export const scoreMeasureSchema = z
  .object({
    number: z.number().int().nonnegative(),
    /** Present only where the global key changes at this measure. */
    key: scoreKeySchema.optional(),
    notes: z.array(scoreNoteSchema).default([]),
  })
  .strict();
export type ScoreMeasure = z.infer<typeof scoreMeasureSchema>;
export type ScoreMeasureInput = z.input<typeof scoreMeasureSchema>;

export const scorePartSchema = z
  .object({
    /** Stable MusicXML part id; SATB parts conventionally use S, A, T and B. */
    id: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/),
    name: z.string().trim().min(1).max(256).optional(),
    clef: scoreClefSchema,
    measures: z.array(scoreMeasureSchema).min(1),
  })
  .strict();
export type ScorePart = z.infer<typeof scorePartSchema>;
export type ScorePartInput = z.input<typeof scorePartSchema>;

/** Shared score model used by converters, API payloads and notation clients. */
export const scoreModelSchema = z
  .object({
    title: z.string().trim().min(1).max(512),
    composer: z.string().trim().max(512).nullable().optional(),
    key: scoreKeySchema,
    time: scoreTimeSchema,
    tempo: z.number().int().min(20).max(300).default(90),
    parts: z.array(scorePartSchema).min(1).max(64),
  })
  .strict();
export type ScoreModel = z.infer<typeof scoreModelSchema>;
export type ScoreModelInput = z.input<typeof scoreModelSchema>;

/** Explicit wire alias; converter-only metadata is added only in the converter follow-on. */
export const scoreModelWireSchema = scoreModelSchema;
export type ScoreModelWire = ScoreModel;
export type ScoreModelWireInput = ScoreModelInput;
