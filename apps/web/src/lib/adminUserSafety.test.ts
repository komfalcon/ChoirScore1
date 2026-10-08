import type { SafeUser } from '@choirscore/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from './apiClient';
import {
  getLastActiveAdminFeedback,
  isDeactivationBlocked,
  isLastActiveAdmin,
  isRoleChangeBlocked,
  LAST_ACTIVE_ADMIN_ERROR_MESSAGE,
} from './adminUserSafety';

function makeAdmin(id: string, isActive = true): SafeUser {
  return {
    id,
    username: id,
    displayName: id,
    role: 'admin',
    voicePart: 'none',
    isActive,
    mustChangePassword: false,
    aiEnabled: false,
    aiDailyLimit: null,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('last active administrator safeguards', () => {
  it('blocks demotion and deactivation when the loaded set proves this is the only active admin', () => {
    const admin = makeAdmin('admin-1');

    expect(isLastActiveAdmin(admin, [admin])).toBe(true);
    expect(isRoleChangeBlocked(admin, 'director', [admin])).toBe(true);
    expect(isRoleChangeBlocked(admin, 'member', [admin])).toBe(true);
    expect(isRoleChangeBlocked(admin, 'admin', [admin])).toBe(false);
    expect(isDeactivationBlocked(admin, [admin])).toBe(true);
  });

  it('allows role changes and deactivation when another active admin is loaded', () => {
    const admin = makeAdmin('admin-1');
    const otherAdmin = makeAdmin('admin-2');
    const users = [admin, otherAdmin];

    expect(isLastActiveAdmin(admin, users)).toBe(false);
    expect(isRoleChangeBlocked(admin, 'director', users)).toBe(false);
    expect(isDeactivationBlocked(admin, users)).toBe(false);
  });

  it('does not apply the guard to an inactive admin or to a different user', () => {
    const inactiveAdmin = makeAdmin('admin-1', false);
    const activeAdmin = makeAdmin('admin-2');

    expect(isLastActiveAdmin(inactiveAdmin, [inactiveAdmin])).toBe(false);
    expect(isLastActiveAdmin(activeAdmin, [inactiveAdmin])).toBe(false);
    expect(isDeactivationBlocked(inactiveAdmin, [inactiveAdmin])).toBe(false);
  });
});

describe('LAST_ACTIVE_ADMIN_REQUIRED server response feedback', () => {
  it('uses stable form-level feedback and leaves user-field errors empty', () => {
    const feedback = getLastActiveAdminFeedback(
      new ApiError(409, {
        code: 'LAST_ACTIVE_ADMIN_REQUIRED',
        message: 'At least one active administrator must remain.',
      })
    );

    expect(feedback).toEqual({
      message: 'At least one active administrator must remain.',
      fieldErrors: {},
    });
    expect(feedback?.message).toBe(LAST_ACTIVE_ADMIN_ERROR_MESSAGE);
  });

  it('does not classify other status/code combinations as the last-admin conflict', () => {
    expect(
      getLastActiveAdminFeedback(
        new ApiError(409, {
          code: 'LAST_ACTIVE_ADMIN',
          message: 'At least one active administrator must remain.',
        })
      )
    ).toBeNull();
    expect(
      getLastActiveAdminFeedback(
        new ApiError(400, {
          code: 'LAST_ACTIVE_ADMIN_REQUIRED',
          message: 'Invalid request.',
        })
      )
    ).toBeNull();
  });
});
