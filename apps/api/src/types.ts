import type { Request } from 'express';
import type { UserRecord } from './db/repository';

export interface RequestContext {
  requestId: string;
}

export interface AdminMutationAuditAttempt {
  action: string;
  targetType: string;
  targetId: string | null;
}

export interface RequestWithContext extends Request {
  context?: RequestContext;
  authUser?: UserRecord;
  adminMutationAuditAttempt?: AdminMutationAuditAttempt;
  adminMutationAuditRecorded?: boolean;
  adminMutationActorId?: string;
}
