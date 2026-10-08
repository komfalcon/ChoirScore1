import type { Request } from 'express';

export interface RequestContext {
  requestId: string;
}

export interface RequestWithContext extends Request {
  context?: RequestContext;
}
