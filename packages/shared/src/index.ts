import { z } from 'zod';

export const roleSchema = z.enum(['admin', 'member']);

export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: roleSchema,
  mustChangePassword: z.boolean(),
  isActive: z.boolean(),
});

export const scoreSchema = z.object({
  id: z.string(),
  title: z.string(),
  composer: z.string().nullable().optional(),
});

export type Role = z.infer<typeof roleSchema>;
export type User = z.infer<typeof userSchema>;
export type Score = z.infer<typeof scoreSchema>;
