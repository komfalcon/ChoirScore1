import type { StructuredLogger } from '../audit';

const RATE_LIMITED_SECURITY_CODES = new Set([
  'BODY_TOO_LARGE',
  'CSRF_HEADER_REQUIRED',
  'FORBIDDEN',
  'INTERNAL_ERROR',
  'INVALID_JSON',
  'NOT_FOUND',
  'ORIGIN_NOT_ALLOWED',
  'PASSWORD_CHANGE_REQUIRED',
  'RATE_LIMITED',
  'UNAUTHENTICATED',
  'USERNAME_TAKEN',
  'VALIDATION_ERROR',
]);
const MAX_SECURITY_EVENT_CATEGORIES = 16;
const DEFAULT_EVENT_INTERVAL_MS = 60_000;

interface EventBucket {
  count: number;
  emitAfter: number;
}

/** Emits at most one redacted summary per fixed error category per interval. */
export class AnonymousSecurityEvents {
  private readonly buckets = new Map<string, EventBucket>();

  constructor(
    private readonly logger: StructuredLogger,
    private readonly now: () => number = Date.now,
    private readonly intervalMs = DEFAULT_EVENT_INTERVAL_MS
  ) {}

  record(errorCode: string) {
    let reason = RATE_LIMITED_SECURITY_CODES.has(errorCode)
      ? errorCode
      : 'OTHER';
    if (
      !this.buckets.has(reason) &&
      this.buckets.size >= MAX_SECURITY_EVENT_CATEGORIES
    ) {
      reason = 'OTHER';
    }

    const now = this.now();
    let bucket = this.buckets.get(reason);
    if (!bucket) {
      bucket = { count: 1, emitAfter: now + this.intervalMs };
      this.buckets.set(reason, bucket);
      this.emit(reason, bucket.count);
      bucket.count = 0;
      return;
    }

    bucket.count += 1;
    if (now >= bucket.emitAfter) {
      this.emit(reason, bucket.count);
      bucket.count = 0;
      bucket.emitAfter = now + this.intervalMs;
    }
  }

  get size() {
    return this.buckets.size;
  }

  private emit(reason: string, count: number) {
    this.logger.warn({
      event: 'anonymous_admin_mutation_denied',
      reason,
      count,
    });
  }
}
