import type { Role, SafeUser } from '@choirscore/shared';
import { ApiError } from './apiClient';

export const LAST_ACTIVE_ADMIN_ERROR_MESSAGE =
  'At least one active administrator must remain.';

type LastActiveAdminFeedback = {
  message: string;
  fieldErrors: Record<string, string>;
};

export function isLastActiveAdmin(
  target: SafeUser,
  users: readonly SafeUser[]
) {
  if (!target.isActive || target.role !== 'admin') return false;
  const activeAdmins = users.filter(
    (user) => user.isActive && user.role === 'admin'
  );
  return activeAdmins.length === 1 && activeAdmins[0]?.id === target.id;
}

export function isRoleChangeBlocked(
  target: SafeUser,
  nextRole: Role,
  users: readonly SafeUser[]
) {
  return isLastActiveAdmin(target, users) && nextRole !== 'admin';
}

export function isDeactivationBlocked(
  target: SafeUser,
  users: readonly SafeUser[]
) {
  return isLastActiveAdmin(target, users);
}

export function getLastActiveAdminFeedback(
  error: unknown
): LastActiveAdminFeedback | null {
  if (
    !(error instanceof ApiError) ||
    error.status !== 409 ||
    error.code !== 'LAST_ACTIVE_ADMIN_REQUIRED'
  ) {
    return null;
  }

  return {
    message: LAST_ACTIVE_ADMIN_ERROR_MESSAGE,
    fieldErrors: {},
  };
}
