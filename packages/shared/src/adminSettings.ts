import { z } from 'zod';
import { voiceRangesSchema } from './voiceRanges.js';

export const adminSettingsSchema = z
  .object({
    requirePasswordChangeAtFirstLogin: z.boolean(),
    voiceRanges: voiceRangesSchema,
  })
  .strict();
export type AdminSettings = z.infer<typeof adminSettingsSchema>;

export const getAdminSettingsResponseSchema = adminSettingsSchema;
export type GetAdminSettingsResponse = z.infer<
  typeof getAdminSettingsResponseSchema
>;

export const patchAdminSettingsRequestSchema = z
  .object({
    requirePasswordChangeAtFirstLogin: z.boolean().optional(),
    voiceRanges: voiceRangesSchema.optional(),
  })
  .strict()
  .refine(
    (settings) =>
      settings.requirePasswordChangeAtFirstLogin !== undefined ||
      settings.voiceRanges !== undefined,
    { message: 'At least one admin setting must be provided.' }
  );
export type PatchAdminSettingsRequest = z.infer<
  typeof patchAdminSettingsRequestSchema
>;

export const patchAdminSettingsResponseSchema = adminSettingsSchema;
export type PatchAdminSettingsResponse = z.infer<
  typeof patchAdminSettingsResponseSchema
>;
