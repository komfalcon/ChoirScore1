import { describe, expect, it } from 'vitest';
import { scoreModelSchema, type ScoreModel } from '../scoreModel.js';
import type { VoiceRanges } from '../voiceRanges.js';
import { validateOutOfRange, type Issue } from './index.js';

interface RangeFixture {
  part: 'S' | 'A' | 'T' | 'B';
  comfortableLow: string;
  comfortableHigh: string;
  hardLow: string;
  hardHigh: string;
  belowComfort: string;
  aboveComfort: string;
  belowHard: string;
  aboveHard: string;
}

const fixtures: RangeFixture[] = [
  {
    part: 'S',
    comfortableLow: 'C4',
    comfortableHigh: 'G5',
    hardLow: 'B3',
    hardHigh: 'A5',
    belowComfort: 'B3',
    aboveComfort: 'G#5',
    belowHard: 'Bb3',
    aboveHard: 'B5',
  },
  {
    part: 'A',
    comfortableLow: 'G3',
    comfortableHigh: 'D5',
    hardLow: 'F3',
    hardHigh: 'E5',
    belowComfort: 'F3',
    aboveComfort: 'Eb5',
    belowHard: 'E3',
    aboveHard: 'F5',
  },
  {
    part: 'T',
    comfortableLow: 'C3',
    comfortableHigh: 'G4',
    hardLow: 'B2',
    hardHigh: 'A4',
    belowComfort: 'B2',
    aboveComfort: 'G#4',
    belowHard: 'Bb2',
    aboveHard: 'Bb4',
  },
  {
    part: 'B',
    comfortableLow: 'E2',
    comfortableHigh: 'D4',
    hardLow: 'D2',
    hardHigh: 'F4',
    belowComfort: 'D2',
    aboveComfort: 'Eb4',
    belowHard: 'Db2',
    aboveHard: 'Gb4',
  },
];

function scoreWithNotes(part: RangeFixture['part'], pitches: string[]) {
  return scoreModelSchema.parse({
    title: 'Range fixture',
    key: { fifths: 0, mode: 'major' },
    time: { beats: 4, beatType: 4 },
    tempo: 90,
    parts: [
      {
        id: part,
        clef: part === 'B' || part === 'T' ? 'bass' : 'treble',
        measures: [
          {
            number: 2,
            notes: pitches.map((pitch) => ({ pitch, dur: 1 })),
          },
        ],
      },
    ],
  });
}

function expectLocatedIssue(
  issue: Issue | undefined,
  expected: Omit<Issue, 'message'>
) {
  expect(issue).toEqual({
    ...expected,
    message: expect.stringMatching(/\S/),
  });
}

describe('validateOutOfRange', () => {
  it.each(
    fixtures.flatMap((fixture) => [
      {
        part: fixture.part,
        edge: 'low',
        pitch: fixture.comfortableLow,
      },
      {
        part: fixture.part,
        edge: 'high',
        pitch: fixture.comfortableHigh,
      },
    ])
  )('$part $edge comfortable endpoint is inclusive', ({ part, pitch }) => {
    expect(validateOutOfRange(scoreWithNotes(part, [pitch]))).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it.each(
    fixtures.flatMap((fixture) => [
      {
        part: fixture.part,
        edge: 'low',
        pitch: fixture.belowComfort,
      },
      {
        part: fixture.part,
        edge: 'high',
        pitch: fixture.aboveComfort,
      },
    ])
  )(
    '$part $edge notes outside comfort but inside hard range warn only',
    ({ part, pitch }) => {
      const result = validateOutOfRange(scoreWithNotes(part, [pitch]));

      expect(result.errors).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expectLocatedIssue(result.warnings[0], {
        part,
        measure: 2,
        beat: 1,
        code: 'OUT_OF_RANGE',
      });
    }
  );

  it.each(
    fixtures.flatMap((fixture) => [
      { part: fixture.part, edge: 'low', pitch: fixture.belowHard },
      { part: fixture.part, edge: 'high', pitch: fixture.aboveHard },
    ])
  )('$part $edge notes beyond the hard range error only', ({ part, pitch }) => {
    const result = validateOutOfRange(scoreWithNotes(part, [pitch]));

    expect(result.errors).toHaveLength(1);
    expectLocatedIssue(result.errors[0], {
      part,
      measure: 2,
      beat: 1,
      code: 'OUT_OF_RANGE',
    });
    expect(result.warnings).toEqual([]);
  });

  it.each(
    fixtures.flatMap((fixture) => [
      { part: fixture.part, edge: 'low', pitch: fixture.hardLow },
      { part: fixture.part, edge: 'high', pitch: fixture.hardHigh },
    ])
  )(
    '$part $edge hard endpoint warns, but does not error',
    ({ part, pitch }) => {
      const result = validateOutOfRange(scoreWithNotes(part, [pitch]));

      expect(result.errors).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expectLocatedIssue(result.warnings[0], {
        part,
        measure: 2,
        beat: 1,
        code: 'OUT_OF_RANGE',
      });
    }
  );

  it('uses a supplied custom profile', () => {
    const customRanges: VoiceRanges = {
      S: {
        comfortable: { low: 'D4', high: 'F4' },
        hard: { low: 'C4', high: 'G4' },
      },
    };

    const result = validateOutOfRange(
      scoreWithNotes('S', ['C4']),
      customRanges
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expectLocatedIssue(result.warnings[0], {
      part: 'S',
      measure: 2,
      beat: 1,
      code: 'OUT_OF_RANGE',
    });
    expect(result.warnings[0]!.message).toContain('comfortable range');
  });

  it('returns a located VOICE_MAPPING error for an unmapped part', () => {
    const model = scoreWithNotes('S', ['C4']);
    model.parts[0]!.id = 'P1';
    model.parts[0]!.name = 'Violin';
    model.parts[0]!.measures[0]!.number = 5;

    expect(validateOutOfRange(model)).toEqual({
      errors: [
        {
          part: 'P1',
          measure: 5,
          beat: 1,
          code: 'VOICE_MAPPING',
          message:
            'A score part has no exact canonical SATB identity; SATB validation was skipped.',
        },
      ],
      warnings: [],
    });
  });

  it('returns VOICE_MAPPING for conflicting canonical ID and name identities', () => {
    const model = scoreWithNotes('S', ['C4']);
    model.parts[0]!.name = 'Alto';
    model.parts[0]!.measures[0]!.number = 7;

    expect(validateOutOfRange(model)).toEqual({
      errors: [
        {
          part: 'S',
          measure: 7,
          beat: 1,
          code: 'VOICE_MAPPING',
          message:
            'A score part has conflicting canonical ID and name identities; SATB validation was skipped.',
        },
      ],
      warnings: [],
    });
  });

  it('locates duplicate canonical identities on the lowest implicated part and measure', () => {
    const base = scoreWithNotes('S', ['C4']);
    const template = base.parts[0]!;
    const model: ScoreModel = scoreModelSchema.parse({
      ...base,
      parts: [
        {
          ...template,
          id: 'P2',
          name: 'Soprano',
          measures: [{ ...template.measures[0]!, number: 8 }],
        },
        {
          ...template,
          id: 'P1',
          name: 'Soprano',
          measures: [{ ...template.measures[0]!, number: 4 }],
        },
      ],
    });

    expect(validateOutOfRange(model)).toEqual({
      errors: [
        {
          part: 'P1',
          measure: 4,
          beat: 1,
          code: 'VOICE_MAPPING',
          message:
            'Multiple score parts share a canonical SATB identity; SATB validation was skipped.',
        },
      ],
      warnings: [],
    });
  });
});
