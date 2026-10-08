import { createHash } from 'node:crypto';
import type { ApiRepository } from '../db/repository';

export const LOGIN_ATTEMPTS_PER_WINDOW = 5;
export const LOGIN_WINDOW_MS = 60_000;
export const LOGIN_LOCKOUT_MS = 15 * 60_000;

export class LoginThrottle {
  constructor(
    private readonly repository: ApiRepository,
    private readonly now: () => number = Date.now
  ) {}

  consume(ip: string, username: string): Promise<boolean> {
    const pairKey = createHash('sha256')
      .update(`${ip}\u0000${username.trim().toLowerCase()}`)
      .digest('hex');
    return this.repository.consumeLoginAttempt(
      pairKey,
      this.now(),
      LOGIN_WINDOW_MS,
      LOGIN_ATTEMPTS_PER_WINDOW,
      LOGIN_LOCKOUT_MS
    );
  }
}
