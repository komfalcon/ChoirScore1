import type {
  ApiRepository,
  ScoreRowWithVersion,
  UserRecord,
} from '../db/repository';

export interface ScorePermissions {
  isOwner: boolean;
  canView: boolean;
  canEdit: boolean;
  canManageAccess: boolean;
  canChangeVisibility: boolean;
  canSetChoirVisibility: boolean;
}

/**
 * Keep score visibility decisions shared by HTTP routes and queued AI workers.
 * Inactive users are never considered viewers, even if a caller passes a stale
 * user record rather than an authenticated request context.
 */
export function scorePermissionsFor(
  row: ScoreRowWithVersion,
  user: Pick<UserRecord, 'id' | 'role' | 'isActive'>
): ScorePermissions {
  const isOwner = row.score.createdBy === user.id;
  const isPrivileged = user.role === 'admin' || user.role === 'director';
  const canView =
    user.isActive &&
    (isOwner ||
      isPrivileged ||
      row.score.visibility === 'choir' ||
      (row.score.visibility === 'shared' && row.hasAccess));
  const canEdit =
    user.isActive &&
    (isOwner ||
      isPrivileged ||
      (row.score.visibility === 'shared' &&
        row.hasAccess &&
        row.accessCanEdit));
  return {
    isOwner,
    canView,
    canEdit,
    canManageAccess: user.isActive && (isOwner || isPrivileged),
    canChangeVisibility: user.isActive && (isOwner || isPrivileged),
    canSetChoirVisibility: user.isActive && isPrivileged,
  };
}

/** Return null for both missing and non-viewable scores, matching score routes. */
export async function findAccessibleScore(
  repository: Pick<ApiRepository, 'findScoreRow'>,
  user: Pick<UserRecord, 'id' | 'role' | 'isActive'>,
  scoreId: string
): Promise<ScoreRowWithVersion | null> {
  const row = await repository.findScoreRow(scoreId, user.id);
  return row && scorePermissionsFor(row, user).canView ? row : null;
}
