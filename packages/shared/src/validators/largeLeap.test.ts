import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  scoreModelSchema,
  scoreNoteSchema,
  type ScoreModel,
} from '../scoreModel.js';
import { validateLargeLeap } from './index.js';

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

function scoreWithNotesByVoice(
  notesByVoice: NotesByVoice,
  measureNumber = 1
): ScoreModel {
  const voices: readonly VoicePart[] = ['S', 'A', 'T', 'B'];
  return scoreModelSchema.parse({
    title: 'Large-leap test score',
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

function warning(part: string, measure: number, beat: number, message: string) {
  return { part, measure, beat, code: 'LARGE_LEAP', message };
}

const sixthBoundaryCases = [
  { from: 'C4', to: 'A4', warns: false },
  { from: 'C4', to: 'B4', warns: true },
  { from: 'A4', to: 'C4', warns: false },
  { from: 'B4', to: 'C4', warns: true },
] as const;

const bassBoundaryCases = [
  { from: 'C3', to: 'C4', warns: false },
  { from: 'C3', to: 'D4', warns: true },
  { from: 'C4', to: 'C3', warns: false },
  { from: 'D4', to: 'C3', warns: true },
] as const;

describe('validateLargeLeap', () => {
  it('accepts a clean fixture with sixths in A/T, an octave in B, and no S rule', () => {
    expect(validateLargeLeap(readFixture('large-leap-clean.json'))).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('reports negative-fixture warnings at the destination part, measure, and beat', () => {
    expect(validateLargeLeap(readFixture('large-leap-warning.json'))).toEqual({
      errors: [],
      warnings: [
        warning(
          'A',
          7,
          3,
          'A leap from C4 to C5 spans a diatonic octave, exceeding the sixth limit.'
        ),
        warning(
          'T',
          7,
          2,
          'T leap from C3 to D4 spans a diatonic ninth, exceeding the sixth limit.'
        ),
        warning(
          'B',
          7,
          4,
          'B leap from C2 to D3 spans a diatonic ninth, exceeding the octave limit.'
        ),
      ],
    });
  });

  for (const voice of ['A', 'T'] as const) {
    it.each(sixthBoundaryCases)(
      `${voice} boundary $from to $to`,
      ({ from, to, warns }) => {
        const result = validateLargeLeap(
          scoreWithNotesByVoice({
            [voice]: [
              { pitch: from, dur: 1 },
              { pitch: to, dur: 1 },
            ],
          })
        );
        const expectedWarnings = warns
          ? [
              warning(
                voice,
                1,
                2,
                `${voice} leap from ${from} to ${to} spans a diatonic seventh, exceeding the sixth limit.`
              ),
            ]
          : [];
        expect(result).toEqual({ errors: [], warnings: expectedWarnings });
      }
    );
  }

  it.each(bassBoundaryCases)(
    'allows Bass octave boundary $from to $to and warns only above it',
    ({ from, to, warns }) => {
      const result = validateLargeLeap(
        scoreWithNotesByVoice({
          B: [
            { pitch: from, dur: 1 },
            { pitch: to, dur: 1 },
          ],
        })
      );
      const expectedWarnings = warns
        ? [
            warning(
              'B',
              1,
              2,
              `B leap from ${from} to ${to} spans a diatonic ninth, exceeding the octave limit.`
            ),
          ]
        : [];
      expect(result).toEqual({ errors: [], warnings: expectedWarnings });
    }
  );

  it('uses written diatonic interval number rather than semitone distance', () => {
    expect(
      validateLargeLeap(
        scoreWithNotesByVoice({
          A: [
            { pitch: 'C4', dur: 1 },
            { pitch: 'B#4', dur: 1 },
          ],
        })
      )
    ).toEqual({
      errors: [],
      warnings: [
        warning(
          'A',
          1,
          2,
          'A leap from C4 to B#4 spans a diatonic seventh, exceeding the sixth limit.'
        ),
      ],
    });
  });

  it('orders events by resolved onset and locates the later event even when input notes are unsorted', () => {
    expect(
      validateLargeLeap(
        scoreWithNotesByVoice({
          A: [
            { pitch: 'C4', dur: 1, onset: 2 },
            { pitch: 'B4', dur: 1, onset: 0 },
          ],
        })
      )
    ).toEqual({
      errors: [],
      warnings: [
        warning(
          'A',
          1,
          3,
          'A leap from B4 to C4 spans a diatonic seventh, exceeding the sixth limit.'
        ),
      ],
    });
  });

  it('skips rests as endpoints but compares the pitched events on either side', () => {
    expect(
      validateLargeLeap(
        scoreWithNotesByVoice({
          A: [
            { pitch: 'C4', dur: 1, onset: 0 },
            { pitch: null, dur: 1, onset: 1 },
            { pitch: 'B4', dur: 1, onset: 2 },
          ],
        })
      )
    ).toEqual({
      errors: [],
      warnings: [
        warning(
          'A',
          1,
          3,
          'A leap from C4 to B4 spans a diatonic seventh, exceeding the sixth limit.'
        ),
      ],
    });
  });

  it('uses one primary pitch per same-onset chord, collapses tie continuations, and keeps staff/voice timelines separate', () => {
    const chordAndTie = scoreWithNotesByVoice({
      A: [
        { pitch: 'C4', dur: 1, onset: 0, tie: true },
        { pitch: 'C6', dur: 1, onset: 0, chord: true },
        { pitch: 'C4', dur: 1, onset: 1 },
        { pitch: null, dur: 1, onset: 2 },
        { pitch: 'D4', dur: 1, onset: 3 },
      ],
    });
    expect(validateLargeLeap(chordAndTie)).toEqual({
      errors: [],
      warnings: [],
    });

    const separateStreams = scoreWithNotesByVoice({
      A: [
        { pitch: 'C4', dur: 1, onset: 0, staff: 1, voice: '1' },
        { pitch: 'B4', dur: 1, onset: 1, staff: 2, voice: '1' },
      ],
    });
    expect(validateLargeLeap(separateStreams)).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('compares successive measures and locates the warning in the destination measure', () => {
    const model = scoreWithNotesByVoice({
      A: [{ pitch: 'C4', dur: 1 }],
    });
    appendMeasure(model, 'A', 2, [{ pitch: 'B4', dur: 1 }]);

    expect(validateLargeLeap(model)).toEqual({
      errors: [],
      warnings: [
        warning(
          'A',
          2,
          1,
          'A leap from C4 to B4 spans a diatonic seventh, exceeding the sixth limit.'
        ),
      ],
    });
  });

  it('does not warn on soprano leaps under this validator', () => {
    expect(
      validateLargeLeap(
        scoreWithNotesByVoice({
          S: [
            { pitch: 'C4', dur: 1 },
            { pitch: 'D7', dur: 1 },
          ],
        })
      )
    ).toEqual({ errors: [], warnings: [] });
  });

  it('uses the actual score-part ID when mapping by canonical voice name', () => {
    const model = scoreWithNotesByVoice({
      A: [
        { pitch: 'C4', dur: 1 },
        { pitch: 'B4', dur: 1 },
      ],
      S: [{ pitch: 'C5', dur: 1 }],
    });
    const names = new Map([
      ['S', 'Soprano'],
      ['A', 'Alto'],
    ]);
    model.parts.forEach((part, index) => {
      const voice = part.id as VoicePart;
      part.id = `P${index + 1}`;
      part.name = names.get(voice)!;
    });

    expect(validateLargeLeap(model)).toEqual({
      errors: [],
      warnings: [
        warning(
          'P2',
          1,
          2,
          'A leap from C4 to B4 spans a diatonic seventh, exceeding the sixth limit.'
        ),
      ],
    });
  });

  it('fails closed with one located VOICE_MAPPING error and no partial warnings', () => {
    const model = scoreWithNotesByVoice({
      A: [
        { pitch: 'C4', dur: 1 },
        { pitch: 'B4', dur: 1 },
      ],
      S: [{ pitch: 'C5', dur: 1 }],
    });
    const unmapped = model.parts.find((part) => part.id === 'S')!;
    unmapped.id = 'P1';
    unmapped.name = 'Violin';

    expect(validateLargeLeap(model)).toEqual({
      errors: [
        {
          part: 'P1',
          measure: 1,
          beat: 1,
          code: 'VOICE_MAPPING',
          message:
            'A score part has no exact canonical SATB identity; SATB validation was skipped.',
        },
      ],
      warnings: [],
    });
  });
});
