import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE_RANGES,
  mapScorePartsToVoiceParts,
  scorePartIdForVoicePart,
  voiceRangesForScoreParts,
} from './voiceRanges.js';

describe('canonical voice-range mapping', () => {
  const importedParts = [
    { id: 'P1', name: 'Soprano' },
    { id: 'P2', name: 'Alto' },
    { id: 'P3', name: 'Tenor' },
    { id: 'P4', name: 'Bass' },
  ];

  it('maps imported P1–P4 names to canonical profile ranges and actual IDs', () => {
    const mapping = mapScorePartsToVoiceParts(importedParts);
    const scoreRanges = voiceRangesForScoreParts(
      importedParts,
      DEFAULT_VOICE_RANGES
    );

    expect(mapping.byPartId).toEqual({ P1: 'S', P2: 'A', P3: 'T', P4: 'B' });
    expect(mapping.byVoicePart).toEqual({ S: 'P1', A: 'P2', T: 'P3', B: 'P4' });
    expect(scorePartIdForVoicePart(importedParts, 'T')).toBe('P3');
    expect(Object.keys(scoreRanges)).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(scoreRanges.P1).toEqual(DEFAULT_VOICE_RANGES.S);
    expect(scoreRanges.P2).toEqual(DEFAULT_VOICE_RANGES.A);
    expect(scoreRanges.P3).toEqual(DEFAULT_VOICE_RANGES.T);
    expect(scoreRanges.P4).toEqual(DEFAULT_VOICE_RANGES.B);
    expect(Object.keys(DEFAULT_VOICE_RANGES)).toEqual(['S', 'A', 'T', 'B']);
  });

  it('recognizes exact canonical IDs and case-insensitive canonical names', () => {
    const parts = [
      { id: 'S', name: 'Soprano' },
      { id: 'A', name: 'aLtO' },
      { id: 'T', name: 'Tenor' },
      { id: 'B', name: 'Bass' },
    ];

    expect(mapScorePartsToVoiceParts(parts).byPartId).toEqual({
      S: 'S',
      A: 'A',
      T: 'T',
      B: 'B',
    });
  });

  it('fails closed for duplicate/ambiguous canonical names', () => {
    expect(() =>
      mapScorePartsToVoiceParts([
        { id: 'P1', name: 'Soprano' },
        { id: 'P2', name: 'SOPRANO' },
      ])
    ).toThrow(/Ambiguous voice-range mapping/);
  });

  it('fails closed when canonical ID and canonical name disagree', () => {
    expect(() =>
      mapScorePartsToVoiceParts([{ id: 'S', name: 'Alto' }])
    ).toThrow(/conflicting canonical voice identities/);
  });

  it('does not guess from import order or unrecognized names', () => {
    expect(() => mapScorePartsToVoiceParts([{ id: 'P1' }])).toThrow(
      /no canonical SATB ID or voice name/
    );
    expect(() =>
      mapScorePartsToVoiceParts([{ id: 'P1', name: 'Violin' }])
    ).toThrow(/no canonical SATB ID or voice name/);
  });

  it('rejects noncanonical keys instead of treating score IDs as settings keys', () => {
    expect(() =>
      voiceRangesForScoreParts([{ id: 'P1', name: 'Soprano' }], {
        P1: DEFAULT_VOICE_RANGES.S,
      })
    ).toThrow(/not a canonical SATB profile key/);
  });
});
