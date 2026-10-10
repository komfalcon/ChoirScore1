import { z } from 'zod';
import { isoUtcTimestampSchema } from './timestamps.js';
import {
  scoreKeySchema,
  scoreModelSchema,
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

const promptTextSchema = z.string().trim().min(1).max(4_000);
const musicalTextSchema = z.string().trim().min(1).max(20_000);
const titleTextSchema = z.string().trim().min(1).max(512);

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
      prompt: promptTextSchema.optional(),
      score: scoreModelSchema.optional(),
      melody: musicalTextSchema.optional(),
      key: scoreKeySchema.optional(),
      time: scoreTimeSchema.optional(),
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
    result: z.unknown().nullable(),
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
