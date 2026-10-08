import { describe, expect, it } from 'vitest';
import {
  changePasswordRequestSchema,
  changePasswordResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  logoutResponseSchema,
  meResponseSchema,
} from './index.js';

const user = {
  id: 'user-1',
  username: 'jane.doe',
  displayName: 'Jane Doe',
  role: 'member' as const,
  voicePart: 'A' as const,
  isActive: true,
  mustChangePassword: false,
  aiEnabled: true,
  aiDailyLimit: null,
  lastLoginAt: null,
  createdAt: '2026-10-08T00:00:00.000Z',
};

describe('auth contract schemas', () => {
  it('validates login payloads and returns a user without a token field', () => {
    expect(
      loginRequestSchema.safeParse({
        username: 'jane.doe',
        password: 'password',
      }).success
    ).toBe(true);
    expect(loginResponseSchema.parse({ user })).toEqual({ user });
    expect(
      loginResponseSchema.safeParse({ user, token: 'not-returned' }).success
    ).toBe(false);
  });

  it('uses the same SafeUser shape for /auth/me and change-password responses', () => {
    expect(meResponseSchema.parse({ user }).user.mustChangePassword).toBe(
      false
    );
    expect(changePasswordResponseSchema.parse({ user })).toEqual({ user });
  });

  it('requires a new password of at least eight characters', () => {
    expect(
      changePasswordRequestSchema.safeParse({
        currentPassword: 'current',
        newPassword: 'short',
      }).success
    ).toBe(false);
    expect(
      changePasswordRequestSchema.safeParse({
        currentPassword: 'current',
        newPassword: 'long-enough',
      }).success
    ).toBe(true);
  });

  it('models logout as a 204 response with no JSON body', () => {
    expect(logoutResponseSchema.parse(undefined)).toBeUndefined();
  });
});
