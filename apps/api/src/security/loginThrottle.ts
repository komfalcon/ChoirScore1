import { createHash } from 'node:crypto';

export const LOGIN_ATTEMPTS_PER_WINDOW = 5;
export const LOGIN_WINDOW_MS = 60_000;
export const LOGIN_LOCKOUT_MS = 15 * 60_000;
const MAX_LOGIN_BUCKETS = 10_000;

interface AttemptBucket {
  windowStartedAt: number;
  attempts: number;
  lockedUntil: number;
}

export class LoginThrottle {
  private readonly buckets = new Map<string, AttemptBucket>();

  constructor(private readonly now: () => number = Date.now) {}

  consume(ip: string, username: string) {
    const now = this.now();
    const key = createHash('sha256')
      .update(`${ip}\u0000${username.trim().toLowerCase()}`)
      .digest('hex');
    let bucket = this.buckets.get(key);

    if (!bucket && this.buckets.size >= MAX_LOGIN_BUCKETS) {
      for (const [expiredKey, expired] of this.buckets) {
        if (
          expired.lockedUntil <= now &&
          now - expired.windowStartedAt >= LOGIN_WINDOW_MS
        ) {
          this.buckets.delete(expiredKey);
        }
        if (this.buckets.size < MAX_LOGIN_BUCKETS) break;
      }
      if (this.buckets.size >= MAX_LOGIN_BUCKETS) return false;
    }

    if (bucket && bucket.lockedUntil > now) return false;
    if (
      !bucket ||
      now - bucket.windowStartedAt >= LOGIN_WINDOW_MS ||
      bucket.lockedUntil > 0
    ) {
      bucket = { windowStartedAt: now, attempts: 0, lockedUntil: 0 };
      this.buckets.set(key, bucket);
    }

    if (bucket.attempts >= LOGIN_ATTEMPTS_PER_WINDOW) {
      bucket.lockedUntil = now + LOGIN_LOCKOUT_MS;
      return false;
    }

    bucket.attempts += 1;
    return true;
  }

  get size() {
    return this.buckets.size;
  }
}
