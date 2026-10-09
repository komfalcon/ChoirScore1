import { describe, expect, it } from 'vitest';
import { resolvePlaybackVoicePart } from './resolvePlaybackVoicePart';

describe('resolvePlaybackVoicePart', () => {
  const parts = [
    { id: 'P1', name: 'Soprano' },
    { id: 'P2', name: 'Alto' },
    { id: 'P3', name: 'Tenor' },
    { id: 'P4', name: 'Bass' },
  ];

  it('maps a canonical profile part to the unique stable score part ID', () => {
    expect(resolvePlaybackVoicePart(parts, 'S')).toBe('P1');
    expect(resolvePlaybackVoicePart(parts, ' a ')).toBe('P2');
    expect(resolvePlaybackVoicePart([{ id: 'B', name: 'Bass' }], 'B')).toBe(
      'B'
    );
  });

  it('returns null for absent, unrecognized, or ambiguous assignments', () => {
    expect(resolvePlaybackVoicePart(parts, null)).toBeNull();
    expect(resolvePlaybackVoicePart(parts, 'none')).toBeNull();
    expect(
      resolvePlaybackVoicePart([{ id: 'P1', name: 'Soprano' }], 'B')
    ).toBeNull();
    expect(
      resolvePlaybackVoicePart(
        [
          { id: 'P1', name: 'Soprano' },
          { id: 'S', name: 'Backup soprano' },
        ],
        'S'
      )
    ).toBeNull();
  });
});
