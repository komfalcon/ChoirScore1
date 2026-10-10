import { z } from 'zod';
import { isoUtcTimestampSchema } from './timestamps.js';

export const aiJobFeatureSchema = z.enum(['harmonize', 'draft', 'simplify']);
export type AiJobFeature = z.infer<typeof aiJobFeatureSchema>;

export const aiJobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
]);
export type AiJobStatus = z.infer<typeof aiJobStatusSchema>;

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
  .strict();
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
