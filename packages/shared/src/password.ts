import { z } from 'zod';

/** Bcrypt only incorporates the first 72 UTF-8 bytes of a password. */
export const passwordSchema = z
  .string()
  .min(8)
  .refine((password) => new TextEncoder().encode(password).byteLength <= 72, {
    message: 'Password must not exceed 72 UTF-8 bytes.',
  });
