import type { Request } from 'express';
import type { ApiRepository, RepositoryTransaction } from '../db/repository';
import { auditAdminAction } from '../audit';
import type { RequestWithContext } from '../types';

export async function runAdminAction<T>(
  repository: ApiRepository,
  req: Request,
  action: string,
  targetType: string,
  targetId: string | null | ((result: T) => string | null),
  detail: Record<string, unknown> | ((result: T) => Record<string, unknown>),
  work: (tx: RepositoryTransaction) => Promise<T>
) {
  const request = req as RequestWithContext;
  const actorId = request.authUser?.id;
  if (!actorId) throw new Error('Authenticated administrator is required');
  return repository.transaction(async (tx) => {
    const result = await work(tx);
    const resolvedTargetId =
      typeof targetId === 'function' ? targetId(result) : targetId;
    const resolvedDetail =
      typeof detail === 'function' ? detail(result) : detail;
    await auditAdminAction(
      tx,
      request,
      actorId,
      action,
      targetType,
      resolvedTargetId,
      resolvedDetail
    );
    return result;
  });
}
