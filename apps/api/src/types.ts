import type { Request } from 'express';
import type { UserRecord } from './db/repository';

export interface RequestContext {
  requestId: string;
}

export interface RequestWithContext extends Request {
  context?: RequestContext;
  authUser?: UserRecord;
}
