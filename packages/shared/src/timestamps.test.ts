import { describe, expect, it } from 'vitest';
import { isoUtcTimestampSchema } from './index.js';

describe('ISO-UTC timestamp contract', () => {
  it.each(['2026-10-08T07:47:51Z', '2026-10-08T07:47:51.000Z'])(
    'accepts UTC timestamps with a Z suffix: %s',
    (timestamp) => {
      expect(isoUtcTimestampSchema.safeParse(timestamp).success).toBe(true);
    }
  );

  it.each([
    '2026-10-08T08:47:51+01:00',
    '2026-10-08T07:47:51',
    '2026-02-30T00:00:00Z',
  ])('rejects non-UTC or invalid timestamps: %s', (timestamp) => {
    expect(isoUtcTimestampSchema.safeParse(timestamp).success).toBe(false);
  });
});
