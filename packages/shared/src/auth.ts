import { z } from 'zod';
import { safeUserSchema } from './users.js';

export const loginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({ user: safeUserSchema }).strict();
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const meResponseSchema = z.object({ user: safeUserSchema }).strict();
export type MeResponse = z.infer<typeof meResponseSchema>;

export const logoutResponseSchema = z.undefined();
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const changePasswordResponseSchema = z
  .object({ user: safeUserSchema })
  .strict();
export type ChangePasswordResponse = z.infer<
  typeof changePasswordResponseSchema
>;

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
