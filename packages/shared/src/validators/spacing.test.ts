import { describe, expect, it } from 'vitest';
import { scoreModelSchema, type ScoreModel } from '../scoreModel.js';
import { validateSpacing } from './index.js';

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
    title: 'Spacing test score',
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
  number: number
): void {
  const part = model.parts.find((candidate) => candidate.id === partId)!;
  part.measures.push({ ...part.measures[0]!, number });
}

function warning(part: string, voices: 'S–A' | 'A–T', measure = 1, beat = 1) {
  return {
    part,
    measure,
    beat,
    code: 'SPACING',
    message: `${voices} spacing exceeds an octave at a shared onset.`,
  };
}

describe('validateSpacing', () => {
  it.each([
    { pair: 'S-A', semitones: 12, expected: [] },
    { pair: 'S-A', semitones: 13, expected: [warning('S', 'S–A')] },
    { pair: 'A-T', semitones: 12, expected: [] },
    { pair: 'A-T', semitones: 13, expected: [warning('A', 'A–T')] },
  ] as const)(
    'uses a strict greater-than-octave threshold for $pair at $semitones semitones',
    ({ pair, semitones, expected }) => {
      const notes: NotesByVoice =
        pair === 'S-A'
          ? {
              S: [{ pitch: semitones === 12 ? 'C5' : 'C#5', dur: 1 }],
              A: [{ pitch: 'C4', dur: 1 }],
              T: [{ pitch: 'C3', dur: 1 }],
              B: [{ pitch: 'C2', dur: 1 }],
            }
          : {
              S: [{ pitch: 'C5', dur: 1 }],
              A: [{ pitch: 'C4', dur: 1 }],
              T: [{ pitch: semitones === 12 ? 'C3' : 'B2', dur: 1 }],
              B: [{ pitch: 'C2', dur: 1 }],
            };

      expect(validateSpacing(scoreWithNotesByVoice(notes))).toEqual({
        errors: [],
        warnings: expected,
      });
    }
  );

  it('returns an exactly located warning for a nontrivial shared onset', () => {
    const result = validateSpacing(
      scoreWithNotesByVoice(
        {
          S: [
            { pitch: 'D6', dur: 1, onset: 2 },
            { pitch: 'C5', dur: 1, onset: 0 },
          ],
          A: [
            { pitch: 'C4', dur: 1, onset: 0 },
            { pitch: 'C4', dur: 1, onset: 2 },
          ],
          T: [
            { pitch: 'C3', dur: 1, onset: 0 },
            { pitch: 'C3', dur: 1, onset: 2 },
          ],
          B: [
            { pitch: 'C2', dur: 1, onset: 0 },
            { pitch: 'C2', dur: 1, onset: 2 },
          ],
        },
        7
      )
    );

    expect(result).toEqual({
      errors: [],
      warnings: [warning('S', 'S–A', 7, 3)],
    });
  });

  it('maps canonical voice names and reports the same actual part independent of part order', () => {
    const model = scoreWithNotesByVoice({
      S: [{ pitch: 'D6', dur: 1 }],
      A: [{ pitch: 'C5', dur: 1 }],
      T: [{ pitch: 'C4', dur: 1 }],
      B: [{ pitch: 'C3', dur: 1 }],
    });
    const names = ['Soprano', 'Alto', 'Tenor', 'Bass'] as const;
    model.parts.forEach((part, index) => {
      part.id = `P${index + 1}`;
      part.name = names[index]!;
    });
    model.parts.reverse();

    expect(validateSpacing(model)).toEqual({
      errors: [],
      warnings: [warning('P1', 'S–A')],
    });
  });

  it('fails closed on an unmapped part rather than producing partial spacing warnings', () => {
    const model = scoreWithNotesByVoice({
      S: [{ pitch: 'D6', dur: 1 }],
      A: [{ pitch: 'C5', dur: 1 }],
      T: [{ pitch: 'C4', dur: 1 }],
      B: [{ pitch: 'C3', dur: 1 }],
    });
    model.parts[0]!.id = 'P1';
    model.parts[0]!.name = 'Violin';

    expect(validateSpacing(model)).toEqual({
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

  it('emits one warning per voice-pair and onset even when multiple chord members exceed an octave', () => {
    const result = validateSpacing(
      scoreWithNotesByVoice({
        S: [
          { pitch: 'C7', dur: 1 },
          { pitch: 'C6', dur: 1, chord: true },
        ],
        A: [
          { pitch: 'C5', dur: 1 },
          { pitch: 'G4', dur: 1, chord: true },
        ],
        T: [{ pitch: 'C4', dur: 1 }],
        B: [{ pitch: 'C3', dur: 1 }],
      })
    );

    expect(result).toEqual({
      errors: [],
      warnings: [warning('S', 'S–A')],
    });
    expect(result.warnings).toHaveLength(1);
  });

  it('keeps rests silent while advancing the timeline to later shared onsets', () => {
    expect(
      validateSpacing(
        scoreWithNotesByVoice({
          S: [
            { pitch: 'C7', dur: 1 },
            { pitch: 'D6', dur: 1 },
          ],
          A: [
            { pitch: null, dur: 1 },
            { pitch: 'C5', dur: 1 },
          ],
          T: [{ pitch: 'C4', dur: 2 }],
          B: [{ pitch: 'C3', dur: 2 }],
        })
      )
    ).toEqual({
      errors: [],
      warnings: [warning('S', 'S–A', 1, 2)],
    });
  });

  it('does not warn when durations overlap but note onsets are not shared', () => {
    expect(
      validateSpacing(
        scoreWithNotesByVoice({
          S: [{ pitch: 'D6', dur: 2, onset: 0 }],
          A: [{ pitch: 'C5', dur: 2, onset: 1 }],
          T: [{ pitch: 'C4', dur: 3, onset: 0 }],
          B: [{ pitch: 'C3', dur: 3, onset: 0 }],
        })
      )
    ).toEqual({ errors: [], warnings: [] });
  });

  it('does not compare matching onset positions across different measure numbers', () => {
    const model = scoreWithNotesByVoice({
      S: [{ pitch: 'D6', dur: 1, onset: 0 }],
      A: [{ pitch: 'C5', dur: 1, onset: 0 }],
      T: [{ pitch: 'C4', dur: 1, onset: 0 }],
      B: [{ pitch: 'C3', dur: 1, onset: 0 }],
    });
    model.parts.find((part) => part.id === 'A')!.measures[0]!.number = 2;

    expect(validateSpacing(model)).toEqual({ errors: [], warnings: [] });
  });

  it('fails closed on duplicate numbers within a part before partial spacing warnings', () => {
    const model = scoreWithNotesByVoice({
      S: [{ pitch: 'D6', dur: 1 }],
      A: [{ pitch: 'C5', dur: 1 }],
      T: [{ pitch: 'C4', dur: 1 }],
      B: [{ pitch: 'C3', dur: 1 }],
    });
    appendMeasure(model, 'A', 2);
    appendMeasure(model, 'A', 2);
    appendMeasure(model, 'A', 8);
    appendMeasure(model, 'A', 8);
    appendMeasure(model, 'S', 1);

    expect(validateSpacing(model)).toEqual({
      errors: [
        {
          part: 'A',
          measure: 2,
          beat: 1,
          code: 'MEASURE_IDENTITY',
          message:
            'A part contains duplicate measure numbers; cross-part validation was skipped.',
        },
      ],
      warnings: [],
    });
  });

  it('allows the same measure number in different parts', () => {
    expect(
      validateSpacing(
        scoreWithNotesByVoice(
          {
            S: [{ pitch: 'D6', dur: 1 }],
            A: [{ pitch: 'C5', dur: 1 }],
            T: [{ pitch: 'C4', dur: 1 }],
            B: [{ pitch: 'C3', dur: 1 }],
          },
          7
        )
      )
    ).toEqual({ errors: [], warnings: [warning('S', 'S–A', 7)] });
  });

  it('accepts globally unique measure labels when there are no spacing findings', () => {
    const model = scoreWithNotesByVoice({
      S: [{ pitch: 'C5', dur: 1 }],
      A: [{ pitch: 'G4', dur: 1 }],
      T: [{ pitch: 'C4', dur: 1 }],
      B: [{ pitch: 'C3', dur: 1 }],
    });
    model.parts.forEach((part, index) => {
      part.measures[0]!.number = index + 1;
    });

    expect(validateSpacing(model)).toEqual({ errors: [], warnings: [] });
  });

  it('ignores wide T–B and S–T intervals when the checked adjacent pairs are at most an octave', () => {
    expect(
      validateSpacing(
        scoreWithNotesByVoice({
          S: [{ pitch: 'C6', dur: 1 }],
          A: [{ pitch: 'C5', dur: 1 }],
          T: [{ pitch: 'C4', dur: 1 }],
          B: [{ pitch: 'C2', dur: 1 }],
        })
      )
    ).toEqual({ errors: [], warnings: [] });
  });
});
