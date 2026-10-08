import { randomBytes } from 'node:crypto';
import type { AuditInput, RepositoryTransaction } from './db/repository';
import type { RequestWithContext } from './types';

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
  actorId: string,
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
    detailJson: JSON.stringify(redactSecrets(detail)),
    createdAt: new Date().toISOString(),
  };
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
