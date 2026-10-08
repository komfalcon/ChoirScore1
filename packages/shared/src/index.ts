import { z } from 'zod';
export * from './auth.js';
export * from './users.js';

export const scoreSchema = z.object({
  id: z.string(),
  title: z.string(),
  composer: z.string().nullable().optional(),
});
export type Score = z.infer<typeof scoreSchema>;
