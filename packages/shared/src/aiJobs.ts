import { z } from 'zod';
import { isoUtcTimestampSchema } from './timestamps.js';
import {
  scoreKeySchema,
  scoreModelSchema,
  scorePitchSchema,
  scoreTimeSchema,
} from './scoreModel.js';

export const aiJobFeatureSchema = z.enum(['harmonize', 'draft', 'simplify']);
export type AiJobFeature = z.infer<typeof aiJobFeatureSchema>;

export const aiJobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
]);
export type AiJobStatus = z.infer<typeof aiJobStatusSchema>;

export const aiJobResultSchema = z.record(z.string(), z.unknown());
export type AiJobResult = z.infer<typeof aiJobResultSchema>;

const PROMPT_TEXT_MAX_LENGTH = 4_000;
const promptTextSchema = z.string().trim().min(1).max(PROMPT_TEXT_MAX_LENGTH);
const musicalTextSchema = z.string().trim().min(1).max(20_000);
const titleTextSchema = z.string().trim().min(1).max(512);
const harmonizeVoiceSchema = z.enum(['A', 'T', 'B']);

export const harmonizeStyleSchema = z.enum(['hymn', 'gospel', 'simple']);
export type HarmonizeStyle = z.infer<typeof harmonizeStyleSchema>;

export const harmonizeMeasureRangeSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .strict()
  .refine((range) => range.start <= range.end);

const harmonizePartsSchema = z
  .array(harmonizeVoiceSchema)
  .min(1)
  .max(3)
  .refine((parts) => new Set(parts).size === parts.length);

/** Strict v1 request contract; only inline score models are supported here. */
export const harmonizeJobRequestSchema = z
  .object({
    score: scoreModelSchema,
    melodyPartId: z.string().trim().min(1).max(128).optional(),
    partsToGenerate: harmonizePartsSchema.optional(),
    style: harmonizeStyleSchema.optional(),
    measureRange: harmonizeMeasureRangeSchema.optional(),
    prompt: promptTextSchema.optional(),
  })
  .strict();
export type HarmonizeJobRequest = z.infer<typeof harmonizeJobRequestSchema>;

/** Provider output contains pitches only; source durations/onsets are copied by code. */
export const harmonizeGeneratedOutputSchema = z
  .object({
    parts: z
      .array(
        z
          .object({
            id: harmonizeVoiceSchema,
            measures: z
              .array(
                z
                  .object({
                    number: z.number().int().nonnegative(),
                    pitches: z.array(scorePitchSchema.nullable()),
                  })
                  .strict()
              )
              .min(1),
          })
          .strict()
      )
      .min(1)
      .max(3),
    chords: z
      .array(
        z
          .object({
            measure: z.number().int().nonnegative(),
            label: z.string().trim().min(1).max(32),
          })
          .strict()
      )
      .optional(),
  })
  .strict();
export type HarmonizeGeneratedOutput = z.infer<
  typeof harmonizeGeneratedOutputSchema
>;

export const harmonizePreviewSchema = z
  .object({
    model: scoreModelSchema,
    previewOnly: z.literal(true),
    chords: harmonizeGeneratedOutputSchema.shape.chords,
  })
  .strict();
export type HarmonizePreview = z.infer<typeof harmonizePreviewSchema>;

function requireInput(value: Record<string, unknown>) {
  return Object.keys(value).length > 0;
}

/**
 * Feature-specific request allowlists. Strict objects (including the shared,
 * strict score model) prevent account, credential, and arbitrary metadata from
 * crossing into persisted work or provider payloads.
 */
export const aiJobInputSchemas = {
  harmonize: z
    .object({
      // Keep shared admission aligned with harmonizeJobRequestSchema below.
      prompt: promptTextSchema.optional(),
      score: scoreModelSchema.optional(),
      melody: musicalTextSchema.optional(),
      key: scoreKeySchema.optional(),
      time: scoreTimeSchema.optional(),
      melodyPartId: z.string().trim().min(1).max(128).optional(),
      partsToGenerate: harmonizePartsSchema.optional(),
      style: harmonizeStyleSchema.optional(),
      measureRange: harmonizeMeasureRangeSchema.optional(),
    })
    .strict()
    .refine(requireInput),
  draft: z
    .object({
      prompt: promptTextSchema.optional(),
      melody: musicalTextSchema.optional(),
      lyrics: musicalTextSchema.optional(),
      title: titleTextSchema.optional(),
      key: scoreKeySchema.optional(),
      time: scoreTimeSchema.optional(),
      tempo: z.number().int().min(20).max(300).optional(),
    })
    .strict()
    .refine(requireInput),
  simplify: z
    .object({
      prompt: promptTextSchema.optional(),
      score: scoreModelSchema.optional(),
      melody: musicalTextSchema.optional(),
      lyrics: musicalTextSchema.optional(),
    })
    .strict()
    .refine(requireInput),
} as const;

export const aiJobSubmissionRequestSchema = z
  .object({
    requestId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    feature: aiJobFeatureSchema,
    input: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((request, context) => {
    const input = aiJobInputSchemas[request.feature].safeParse(request.input);
    if (!input.success) {
      context.addIssue({
        code: 'custom',
        path: ['input'],
        message: 'Input contains unsupported or invalid fields.',
      });
    }
  });
export type AiJobSubmissionRequest = z.infer<
  typeof aiJobSubmissionRequestSchema
>;

export const aiJobSubmissionResponseSchema = z
  .object({
    jobId: z.string().min(1),
    status: aiJobStatusSchema,
  })
  .strict();
export type AiJobSubmissionResponse = z.infer<
  typeof aiJobSubmissionResponseSchema
>;

export const aiJobStatusResponseSchema = z
  .object({
    jobId: z.string().min(1),
    feature: aiJobFeatureSchema,
    status: aiJobStatusSchema,
    result: aiJobResultSchema.nullable(),
    warnings: z.array(z.unknown()).nullable(),
    error: z.string().nullable(),
    createdAt: isoUtcTimestampSchema,
    finishedAt: isoUtcTimestampSchema.nullable(),
  })
  .strict();
export type AiJobStatusResponse = z.infer<typeof aiJobStatusResponseSchema>;

export const aiQuotaResponseSchema = z
  .object({
    dailyLimit: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    available: z.boolean(),
    resetsAt: isoUtcTimestampSchema,
  })
  .strict();
export type AiQuotaResponse = z.infer<typeof aiQuotaResponseSchema>;
