import { z } from 'zod';
export * from './adminSettings.js';
export * from './auth.js';
export * from './timestamps.js';
export * from './users.js';

export const scoreSchema = z.object({
  id: z.string(),
  title: z.string(),
  composer: z.string().nullable().optional(),
});
export type Score = z.infer<typeof scoreSchema>;
