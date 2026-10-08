import { describe, expect, it } from 'vitest';
import { AnonymousSecurityEvents } from './anonymousSecurityEvents';

describe('AnonymousSecurityEvents', () => {
  it('does not count the immediate first-denial summary again at rollover', () => {
    const logs: Record<string, unknown>[] = [];
    let now = 0;
    const logger = {
      info: (_record: Record<string, unknown>) => undefined,
      warn: (record: Record<string, unknown>) => logs.push(record),
      error: (_record: Record<string, unknown>) => undefined,
    };
    const events = new AnonymousSecurityEvents(logger, () => now, 1_000);

    events.record('CSRF_HEADER_REQUIRED');
    expect(logs).toEqual([
      {
        event: 'anonymous_admin_mutation_denied',
        reason: 'CSRF_HEADER_REQUIRED',
        count: 1,
      },
    ]);

    now = 200;
    events.record('CSRF_HEADER_REQUIRED');
    events.record('CSRF_HEADER_REQUIRED');
    now = 1_000;
    events.record('CSRF_HEADER_REQUIRED');

    expect(logs).toEqual([
      {
        event: 'anonymous_admin_mutation_denied',
        reason: 'CSRF_HEADER_REQUIRED',
        count: 1,
      },
      {
        event: 'anonymous_admin_mutation_denied',
        reason: 'CSRF_HEADER_REQUIRED',
        count: 3,
      },
    ]);
  });
});
