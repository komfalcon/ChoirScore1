import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  scoreModelSchema,
  scoreNoteSchema,
  type ScoreModel,
} from '../scoreModel.js';
import { validateParallelFifthsOctaves } from './index.js';

type VoicePart = 'S' | 'A' | 'T' | 'B';

type FixtureNote = {
  pitch: string | null;
  dur: number;
  onset?: number;
  tie?: boolean;
  voice?: string;
  staff?: number;
  chord?: boolean;
};

type NotesByVoice = Partial<Record<VoicePart, FixtureNote[]>>;

const voicePairs = [
  { first: 'S', second: 'A', name: 'S–A' },
  { first: 'S', second: 'T', name: 'S–T' },
  { first: 'S', second: 'B', name: 'S–B' },
  { first: 'A', second: 'T', name: 'A–T' },
  { first: 'A', second: 'B', name: 'A–B' },
  { first: 'T', second: 'B', name: 'T–B' },
] as const;

function scoreWithNotesByVoice(
  notesByVoice: NotesByVoice,
  measureNumber = 1
): ScoreModel {
  const voices: readonly VoicePart[] = ['S', 'A', 'T', 'B'];
  return scoreModelSchema.parse({
    title: 'Parallel interval test score',
    key: { fifths: 0, mode: 'major' },
    time: { beats: 4, beatType: 4 },
    tempo: 90,
    parts: voices.flatMap((id) => {
      const notes = notesByVoice[id];
      if (!notes) return [];
      return [
        {
          id,
          clef: id === 'T' || id === 'B' ? 'bass' : 'treble',
          measures: [{ number: measureNumber, notes }],
        },
      ];
    }),
  });
}

function appendMeasure(
  model: ScoreModel,
  partId: string,
  number: number,
  notes: FixtureNote[]
): void {
  const part = model.parts.find((candidate) => candidate.id === partId)!;
  part.measures.push({
    number,
    notes: notes.map((note) => scoreNoteSchema.parse(note)),
  });
}

function readFixture(name: string): ScoreModel {
  const path = fileURLToPath(
    new URL(`../../test/fixtures/${name}`, import.meta.url)
  );
  return scoreModelSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

function finding(
  part: string,
  measure: number,
  beat: number,
  code: 'PARALLEL_FIFTHS' | 'PARALLEL_OCTAVES',
  message: string
) {
  return { part, measure, beat, code, message };
}

describe('validateParallelFifthsOctaves', () => {
  it('accepts a clean fixture and reports the negative fixture as an error', () => {
    expect(
      validateParallelFifthsOctaves(readFixture('parallel-fifths-clean.json'))
    ).toEqual({ errors: [], warnings: [] });
    expect(
      validateParallelFifthsOctaves(readFixture('parallel-fifths-warning.json'))
    ).toEqual({
      errors: [
        finding(
          'S',
          7,
          2,
          'PARALLEL_FIFTHS',
          'S–A parallel fifths move up from C5–F4 to D5–G4.'
        ),
      ],
      warnings: [],
    });
  });

  it.each(voicePairs)(
    'checks each of the six distinct SATB pairs: $name',
    ({ first, second, name }) => {
      const model = scoreWithNotesByVoice({
        [first]: [
          { pitch: 'C5', dur: 1, onset: 0 },
          { pitch: 'D5', dur: 1, onset: 1 },
        ],
        [second]: [
          { pitch: 'F4', dur: 1, onset: 0 },
          { pitch: 'G4', dur: 1, onset: 1 },
        ],
      });
      expect(validateParallelFifthsOctaves(model)).toEqual({
        errors: [
          finding(
            first,
            1,
            2,
            'PARALLEL_FIFTHS',
            `${name} parallel fifths move up from C5–F4 to D5–G4.`
          ),
        ],
        warnings: [],
      });
    }
  );

  it.each([
    {
      name: 'a spelled fifth',
      start: ['C5', 'F4'],
      destination: ['D5', 'G4'],
      code: 'PARALLEL_FIFTHS',
      message: 'S–A parallel fifths move up from C5–F4 to D5–G4.',
    },
    {
      name: 'a spelled octave',
      start: ['C5', 'C4'],
      destination: ['D5', 'D4'],
      code: 'PARALLEL_OCTAVES',
      message: 'S–A parallel octaves move up from C5–C4 to D5–D4.',
    },
    {
      name: 'a compound twelfth as a fifth',
      start: ['C5', 'F4'],
      destination: ['D6', 'G4'],
      code: 'PARALLEL_FIFTHS',
      message: 'S–A parallel fifths move up from C5–F4 to D6–G4.',
    },
    {
      name: 'a compound fifteenth as an octave',
      start: ['C5', 'C4'],
      destination: ['D6', 'D4'],
      code: 'PARALLEL_OCTAVES',
      message: 'S–A parallel octaves move up from C5–C4 to D6–D4.',
    },
  ] as const)(
    'classifies $name at both transition endpoints',
    ({ start, destination, code, message }) => {
      expect(
        validateParallelFifthsOctaves(
          scoreWithNotesByVoice({
            S: [
              { pitch: start[0], dur: 1, onset: 0 },
              { pitch: destination[0], dur: 1, onset: 1 },
            ],
            A: [
              { pitch: start[1], dur: 1, onset: 0 },
              { pitch: destination[1], dur: 1, onset: 1 },
            ],
          })
        )
      ).toEqual({
        errors: [finding('S', 1, 2, code, message)],
        warnings: [],
      });
    }
  );

  it('does not treat unison, non-perfect spellings, or unlike endpoint classes as fifths or octaves', () => {
    const cleanCases: NotesByVoice[] = [
      {
        S: [
          { pitch: 'C5', dur: 1, onset: 0 },
          { pitch: 'D5', dur: 1, onset: 1 },
        ],
        A: [
          { pitch: 'C5', dur: 1, onset: 0 },
          { pitch: 'D5', dur: 1, onset: 1 },
        ],
      },
      {
        S: [
          { pitch: 'C5', dur: 1, onset: 0 },
          { pitch: 'D5', dur: 1, onset: 1 },
        ],
        A: [
          { pitch: 'F#4', dur: 1, onset: 0 },
          { pitch: 'G#4', dur: 1, onset: 1 },
        ],
      },
      {
        S: [
          { pitch: 'C5', dur: 1, onset: 0 },
          { pitch: 'D5', dur: 1, onset: 1 },
        ],
        A: [
          { pitch: 'F4', dur: 1, onset: 0 },
          { pitch: 'A4', dur: 1, onset: 1 },
        ],
      },
      {
        S: [
          { pitch: 'C5', dur: 1, onset: 0 },
          { pitch: 'B4', dur: 1, onset: 1 },
        ],
        A: [
          { pitch: 'F4', dur: 1, onset: 0 },
          { pitch: 'G4', dur: 1, onset: 1 },
        ],
      },
      {
        S: [
          { pitch: 'C5', dur: 1, onset: 0 },
          { pitch: 'D5', dur: 1, onset: 1 },
        ],
        A: [
          { pitch: 'B#3', dur: 1, onset: 0 },
          { pitch: 'C##4', dur: 1, onset: 1 },
        ],
      },
    ];

    for (const notes of cleanCases) {
      expect(
        validateParallelFifthsOctaves(scoreWithNotesByVoice(notes))
      ).toEqual({ errors: [], warnings: [] });
    }
  });

  it('requires nonzero motion in the same direction in both parts', () => {
    const contraryMotion = scoreWithNotesByVoice({
      S: [
        { pitch: 'C5', dur: 1, onset: 0 },
        { pitch: 'B4', dur: 1, onset: 1 },
      ],
      A: [
        { pitch: 'F4', dur: 1, onset: 0 },
        { pitch: 'G4', dur: 1, onset: 1 },
      ],
    });
    const obliqueMotion = scoreWithNotesByVoice({
      S: [
        { pitch: 'C5', dur: 1, onset: 0 },
        { pitch: 'D5', dur: 1, onset: 1 },
      ],
      A: [
        { pitch: 'F4', dur: 1, onset: 0 },
        { pitch: 'F4', dur: 1, onset: 1 },
      ],
    });
    expect(validateParallelFifthsOctaves(contraryMotion)).toEqual({
      errors: [],
      warnings: [],
    });
    expect(validateParallelFifthsOctaves(obliqueMotion)).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('uses one deterministic pitched chord anchor and reports once per stream transition', () => {
    const model = scoreWithNotesByVoice({
      S: [
        { pitch: 'C5', dur: 1, onset: 0 },
        { pitch: 'E5', dur: 1, onset: 0, chord: true },
        { pitch: 'D5', dur: 1, onset: 1 },
      ],
      A: [
        { pitch: 'F4', dur: 1, onset: 0 },
        { pitch: 'B4', dur: 1, onset: 0, chord: true },
        { pitch: 'G4', dur: 1, onset: 1 },
      ],
    });
    expect(validateParallelFifthsOctaves(model)).toEqual({
      errors: [
        finding(
          'S',
          1,
          2,
          'PARALLEL_FIFTHS',
          'S–A parallel fifths move up from C5–F4 to D5–G4.'
        ),
      ],
      warnings: [],
    });
  });

  it('uses the first pitched member when every same-onset chord note is marked as a chord', () => {
    const model = scoreWithNotesByVoice({
      S: [
        { pitch: 'C5', dur: 1, onset: 0, chord: true },
        { pitch: 'E5', dur: 1, onset: 0, chord: true },
        { pitch: 'D5', dur: 1, onset: 1 },
      ],
      A: [
        { pitch: 'F4', dur: 1, onset: 0, chord: true },
        { pitch: 'B4', dur: 1, onset: 0, chord: true },
        { pitch: 'G4', dur: 1, onset: 1 },
      ],
    });
    expect(validateParallelFifthsOctaves(model).errors).toHaveLength(1);
  });

  it('compares each independent (staff, voice) stream pair across parts', () => {
    const model = scoreWithNotesByVoice({
      S: [
        { pitch: 'C5', dur: 1, onset: 0, staff: 1, voice: '1' },
        { pitch: 'D5', dur: 1, onset: 1, staff: 1, voice: '1' },
        { pitch: 'C5', dur: 1, onset: 0, staff: 2, voice: '1' },
        { pitch: 'D5', dur: 1, onset: 1, staff: 2, voice: '1' },
      ],
      A: [
        { pitch: 'F4', dur: 1, onset: 0, staff: 1, voice: '1' },
        { pitch: 'G4', dur: 1, onset: 1, staff: 1, voice: '1' },
        { pitch: 'F4', dur: 1, onset: 0, staff: 2, voice: '1' },
        { pitch: 'G4', dur: 1, onset: 1, staff: 2, voice: '1' },
      ],
    });
    const result = validateParallelFifthsOctaves(model);
    expect(result.errors).toHaveLength(4);
    expect(result.errors.map(({ code }) => code)).toEqual(
      Array(4).fill('PARALLEL_FIFTHS')
    );
  });

  it('aligns attacks within 1e-9 and rejects attacks outside that tolerance', () => {
    const withinTolerance = scoreWithNotesByVoice({
      S: [
        { pitch: 'C5', dur: 1, onset: 0 },
        { pitch: 'D5', dur: 1, onset: 1.0000000005 },
      ],
      A: [
        { pitch: 'F4', dur: 1, onset: 0 },
        { pitch: 'G4', dur: 1, onset: 1 },
      ],
    });
    const outsideTolerance = scoreWithNotesByVoice({
      S: [
        { pitch: 'C5', dur: 1, onset: 0 },
        { pitch: 'D5', dur: 1, onset: 1.00000001 },
      ],
      A: [
        { pitch: 'F4', dur: 1, onset: 0 },
        { pitch: 'G4', dur: 1, onset: 1 },
      ],
    });
    expect(validateParallelFifthsOctaves(withinTolerance).errors).toHaveLength(
      1
    );
    const nearBeatRoundingBoundary = scoreWithNotesByVoice({
      S: [
        { pitch: 'C5', dur: 1, onset: 0 },
        { pitch: 'D5', dur: 1, onset: 1.0000005002 },
      ],
      A: [
        { pitch: 'F4', dur: 1, onset: 0 },
        { pitch: 'G4', dur: 1, onset: 1.0000004998 },
      ],
    });
    expect(
      validateParallelFifthsOctaves(nearBeatRoundingBoundary).errors[0]?.beat
    ).toBe(2.000001);
    expect(validateParallelFifthsOctaves(outsideTolerance)).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('does not skip an intervening unmatched attack or rest in the union timeline', () => {
    const unmatchedAttack = scoreWithNotesByVoice({
      S: [
        { pitch: 'C5', dur: 1, onset: 0 },
        { pitch: 'D5', dur: 1, onset: 1 },
        { pitch: 'E5', dur: 1, onset: 2 },
      ],
      A: [
        { pitch: 'F4', dur: 1, onset: 0 },
        { pitch: 'G4', dur: 1, onset: 2 },
      ],
    });
    const interveningRest = scoreWithNotesByVoice({
      S: [
        { pitch: 'C5', dur: 1, onset: 0 },
        { pitch: null, dur: 1, onset: 1 },
        { pitch: 'D5', dur: 1, onset: 2 },
      ],
      A: [
        { pitch: 'F4', dur: 1, onset: 0 },
        { pitch: 'F4', dur: 1, onset: 1 },
        { pitch: 'G4', dur: 1, onset: 2 },
      ],
    });
    expect(validateParallelFifthsOctaves(unmatchedAttack)).toEqual({
      errors: [],
      warnings: [],
    });
    expect(validateParallelFifthsOctaves(interveningRest)).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('treats same-pitch tie continuations as sustained rather than moving attacks', () => {
    const model = scoreWithNotesByVoice({
      S: [
        { pitch: 'C5', dur: 1, onset: 0, tie: true },
        { pitch: 'C5', dur: 1, onset: 1 },
        { pitch: 'D5', dur: 1, onset: 2 },
      ],
      A: [
        { pitch: 'F4', dur: 1, onset: 0, tie: true },
        { pitch: 'F4', dur: 1, onset: 1 },
        { pitch: 'G4', dur: 1, onset: 2 },
      ],
    });
    expect(validateParallelFifthsOctaves(model)).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('does not count a same-pitch tie continuation as an attack across a barline', () => {
    const model = scoreWithNotesByVoice({
      S: [{ pitch: 'C5', dur: 1, onset: 2, tie: true }],
      A: [{ pitch: 'F4', dur: 1, onset: 2, tie: true }],
    });
    appendMeasure(model, 'S', 2, [{ pitch: 'C5', dur: 1, onset: 0 }]);
    appendMeasure(model, 'A', 2, [{ pitch: 'F4', dur: 1, onset: 0 }]);
    expect(validateParallelFifthsOctaves(model)).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('reports one error at the destination across an unambiguous adjacent measure boundary', () => {
    const model = scoreWithNotesByVoice({
      S: [{ pitch: 'C5', dur: 1, onset: 2 }],
      A: [{ pitch: 'F4', dur: 1, onset: 2 }],
    });
    appendMeasure(model, 'S', 2, [{ pitch: 'D5', dur: 1, onset: 0 }]);
    appendMeasure(model, 'A', 2, [{ pitch: 'G4', dur: 1, onset: 0 }]);

    expect(validateParallelFifthsOctaves(model)).toEqual({
      errors: [
        finding(
          'S',
          2,
          1,
          'PARALLEL_FIFTHS',
          'S–A parallel fifths move up from C5–F4 to D5–G4.'
        ),
      ],
      warnings: [],
    });
  });

  it('does not cross a missing measure number or compare equal onsets in different labels', () => {
    const skippedMeasure = scoreWithNotesByVoice({
      S: [{ pitch: 'C5', dur: 1, onset: 2 }],
      A: [{ pitch: 'F4', dur: 1, onset: 2 }],
    });
    appendMeasure(skippedMeasure, 'S', 3, [{ pitch: 'D5', dur: 1, onset: 0 }]);
    appendMeasure(skippedMeasure, 'A', 3, [{ pitch: 'G4', dur: 1, onset: 0 }]);
    expect(validateParallelFifthsOctaves(skippedMeasure)).toEqual({
      errors: [],
      warnings: [],
    });

    const differentLabels = scoreWithNotesByVoice({
      S: [{ pitch: 'C5', dur: 1, onset: 0 }],
      A: [{ pitch: 'F4', dur: 1, onset: 0 }],
    });
    differentLabels.parts.find((part) => part.id === 'A')!.measures[0]!.number =
      2;
    expect(validateParallelFifthsOctaves(differentLabels)).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('fails closed on ambiguous matched measure labels without partial parallel findings', () => {
    const model = scoreWithNotesByVoice({
      S: [
        { pitch: 'C5', dur: 1, onset: 0 },
        { pitch: 'D5', dur: 1, onset: 1 },
      ],
      A: [
        { pitch: 'F4', dur: 1, onset: 0 },
        { pitch: 'G4', dur: 1, onset: 1 },
      ],
    });
    appendMeasure(model, 'S', 1, [{ pitch: 'E5', dur: 1, onset: 0 }]);

    expect(validateParallelFifthsOctaves(model)).toEqual({
      errors: [
        {
          part: 'S',
          measure: 1,
          beat: 1,
          code: 'MEASURE_IDENTITY',
          message:
            'A part contains duplicate measure numbers; cross-part validation was skipped.',
        },
      ],
      warnings: [],
    });
  });

  it('returns no mapping errors or partial findings when canonical mapping fails', () => {
    const model = scoreWithNotesByVoice({
      S: [
        { pitch: 'C5', dur: 1, onset: 0 },
        { pitch: 'D5', dur: 1, onset: 1 },
      ],
      A: [
        { pitch: 'F4', dur: 1, onset: 0 },
        { pitch: 'G4', dur: 1, onset: 1 },
      ],
    });
    model.parts.push({
      id: 'P1',
      name: 'Violin',
      clef: 'treble',
      measures: [{ number: 1, notes: [] }],
    });
    expect(validateParallelFifthsOctaves(model)).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('uses canonical names for matching and actual score-part IDs for findings', () => {
    const model = scoreWithNotesByVoice({
      S: [
        { pitch: 'C5', dur: 1, onset: 0 },
        { pitch: 'D5', dur: 1, onset: 1 },
      ],
      A: [
        { pitch: 'F4', dur: 1, onset: 0 },
        { pitch: 'G4', dur: 1, onset: 1 },
      ],
    });
    const soprano = model.parts.find((part) => part.id === 'S')!;
    const alto = model.parts.find((part) => part.id === 'A')!;
    soprano.id = 'P1';
    soprano.name = 'Soprano';
    alto.id = 'P2';
    alto.name = 'Alto';
    model.parts.reverse();

    expect(validateParallelFifthsOctaves(model)).toEqual({
      errors: [
        finding(
          'P1',
          1,
          2,
          'PARALLEL_FIFTHS',
          'S–A parallel fifths move up from C5–F4 to D5–G4.'
        ),
      ],
      warnings: [],
    });
  });
});
