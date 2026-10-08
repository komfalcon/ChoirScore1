import { z } from 'zod';

export const adminSettingsSchema = z
  .object({
    requirePasswordChangeAtFirstLogin: z.boolean(),
  })
  .strict();
export type AdminSettings = z.infer<typeof adminSettingsSchema>;

export const getAdminSettingsResponseSchema = adminSettingsSchema;
export type GetAdminSettingsResponse = z.infer<
  typeof getAdminSettingsResponseSchema
>;

export const patchAdminSettingsRequestSchema = adminSettingsSchema;
export type PatchAdminSettingsRequest = z.infer<
  typeof patchAdminSettingsRequestSchema
>;

export const patchAdminSettingsResponseSchema = adminSettingsSchema;
export type PatchAdminSettingsResponse = z.infer<
  typeof patchAdminSettingsResponseSchema
>;
