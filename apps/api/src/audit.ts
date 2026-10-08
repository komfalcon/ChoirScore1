import { randomBytes } from 'node:crypto';
import type {
  ApiRepository,
  AuditInput,
  RepositoryTransaction,
} from './db/repository';
import type { AdminMutationAuditAttempt, RequestWithContext } from './types';

const SENSITIVE_KEY =
  /(password|passwd|hash|token|secret|credential|authorization|cookie|jwt|api.?key)/i;

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSecrets(entry),
      ])
    );
  }
  return value;
}

export function newId() {
  return randomBytes(12).toString('base64url');
}

export function newAuditEntry(
  req: RequestWithContext,
  actorId: string | null,
  action: string,
  targetType: string,
  targetId: string | null,
  detail: Record<string, unknown>
): AuditInput {
  return {
    id: newId(),
    requestId: req.context?.requestId ?? null,
    actorId,
    action,
    targetType,
    targetId,
    outcome: 'success',
    errorCode: null,
    detailJson: JSON.stringify(redactSecrets(detail)),
    createdAt: new Date().toISOString(),
  };
}

export async function recordAdminMutationFailure(
  repository: ApiRepository,
  req: RequestWithContext,
  attempt: AdminMutationAuditAttempt,
  outcome: 'rejected' | 'failed',
  errorCode: string,
  actorId: string
) {
  const safeErrorCode = /^[A-Z][A-Z0-9_]{0,63}$/.test(errorCode)
    ? errorCode
    : 'UNKNOWN_ERROR';
  await repository.insertAudit({
    ...newAuditEntry(
      req,
      actorId,
      attempt.action,
      attempt.targetType,
      attempt.targetId,
      {}
    ),
    outcome,
    errorCode: safeErrorCode,
  });
}

export async function auditAdminAction(
  tx: RepositoryTransaction,
  req: RequestWithContext,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  detail: Record<string, unknown>
) {
  await tx.insertAudit(
    newAuditEntry(req, actorId, action, targetType, targetId, detail)
  );
}

export interface StructuredLogger {
  info(record: Record<string, unknown>): void;
  warn(record: Record<string, unknown>): void;
  error(record: Record<string, unknown>): void;
}

export const structuredLogger: StructuredLogger = {
  info(record) {
    console.info(JSON.stringify(redactSecrets(record)));
  },
  warn(record) {
    console.warn(JSON.stringify(redactSecrets(record)));
  },
  error(record) {
    console.error(JSON.stringify(redactSecrets(record)));
  },
};
