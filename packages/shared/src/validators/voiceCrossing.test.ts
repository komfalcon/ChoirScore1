import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scoreModelSchema, type ScoreModel } from '../scoreModel.js';
import { validateVoiceCrossing } from './index.js';

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
    title: 'Voice-crossing test score',
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

function readFixture(name: string): ScoreModel {
  const path = fileURLToPath(
    new URL(`../../test/fixtures/${name}`, import.meta.url)
  );
  return scoreModelSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

describe('validateVoiceCrossing', () => {
  it('accepts the clean SATB fixture', () => {
    expect(
      validateVoiceCrossing(readFixture('voice-crossing-clean.json'))
    ).toEqual({ errors: [], warnings: [] });
  });

  it('locates a crossing at a nontrivial shared onset in the fixture', () => {
    expect(
      validateVoiceCrossing(readFixture('voice-crossing-crossing.json'))
    ).toEqual({
      errors: [
        {
          part: 'S',
          measure: 7,
          beat: 3.5,
          code: 'VOICE_CROSSING',
          message: 'S (G4) is below A (A4) at a shared onset.',
        },
      ],
      warnings: [],
    });
  });

  it.each([
    {
      upper: 'S',
      lower: 'A',
      pitches: { S: 'G4', A: 'A4', T: 'C4', B: 'C3' },
    },
    {
      upper: 'A',
      lower: 'T',
      pitches: { S: 'C5', A: 'G3', T: 'A3', B: 'C3' },
    },
    {
      upper: 'T',
      lower: 'B',
      pitches: { S: 'C5', A: 'E4', T: 'C3', B: 'D3' },
    },
  ] as const)(
    'reports the adjacent $upper/$lower boundary',
    ({ upper, lower, pitches }) => {
      const result = validateVoiceCrossing(
        scoreWithNotesByVoice({
          S: [{ pitch: pitches.S, dur: 1 }],
          A: [{ pitch: pitches.A, dur: 1 }],
          T: [{ pitch: pitches.T, dur: 1 }],
          B: [{ pitch: pitches.B, dur: 1 }],
        })
      );

      expect(result).toEqual({
        errors: [
          {
            part: upper,
            measure: 1,
            beat: 1,
            code: 'VOICE_CROSSING',
            message: `${upper} (${pitches[upper]}) is below ${lower} (${pitches[lower]}) at a shared onset.`,
          },
        ],
        warnings: [],
      });
    }
  );

  it('maps exact canonical voice names independent of part order and locates the actual part ID', () => {
    const model = scoreWithNotesByVoice({
      S: [{ pitch: 'G4', dur: 1 }],
      A: [{ pitch: 'A4', dur: 1 }],
      T: [{ pitch: 'C4', dur: 1 }],
      B: [{ pitch: 'C3', dur: 1 }],
    });
    const names = ['Soprano', 'Alto', 'Tenor', 'Bass'] as const;
    model.parts.forEach((part, index) => {
      part.id = `P${index + 1}`;
      part.name = names[index]!;
    });
    model.parts.reverse();

    expect(validateVoiceCrossing(model)).toEqual({
      errors: [
        {
          part: 'P1',
          measure: 1,
          beat: 1,
          code: 'VOICE_CROSSING',
          message: 'S (G4) is below A (A4) at a shared onset.',
        },
      ],
      warnings: [],
    });
  });

  it('returns a located VOICE_MAPPING error rather than guessing an unmapped identity', () => {
    const model = scoreWithNotesByVoice({ S: [{ pitch: 'C5', dur: 1 }] });
    model.parts[0]!.id = 'P1';
    model.parts[0]!.name = 'Violin';

    expect(validateVoiceCrossing(model)).toEqual({
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

  it('returns VOICE_MAPPING for conflicting canonical ID and name identities', () => {
    const model = scoreWithNotesByVoice({ S: [{ pitch: 'C5', dur: 1 }] });
    model.parts[0]!.name = 'Alto';

    expect(validateVoiceCrossing(model)).toEqual({
      errors: [
        {
          part: 'S',
          measure: 1,
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
    const model = scoreWithNotesByVoice({
      S: [{ pitch: 'C5', dur: 1 }],
      A: [{ pitch: 'G4', dur: 1 }],
    });
    model.parts[0]!.id = 'P2';
    model.parts[0]!.name = 'Soprano';
    model.parts[0]!.measures[0]!.number = 8;
    model.parts[1]!.id = 'P1';
    model.parts[1]!.name = 'Soprano';
    model.parts[1]!.measures[0]!.number = 4;

    expect(validateVoiceCrossing(model)).toEqual({
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

  it('returns one deterministic sanitized VOICE_MAPPING issue for duplicate raw part IDs', () => {
    const model = scoreWithNotesByVoice({
      S: [{ pitch: 'G4', dur: 1 }],
      A: [{ pitch: 'A4', dur: 1 }],
    });
    model.parts[0]!.id = 'P1';
    model.parts[0]!.name = 'Soprano';
    model.parts[0]!.measures[0]!.number = 8;
    model.parts[1]!.id = 'P1';
    model.parts[1]!.name = 'Alto';
    model.parts[1]!.measures[0]!.number = 4;

    expect(validateVoiceCrossing(model)).toEqual({
      errors: [
        {
          part: 'P1',
          measure: 4,
          beat: 1,
          code: 'VOICE_MAPPING',
          message:
            'Score-part IDs are duplicated; SATB validation was skipped.',
        },
      ],
      warnings: [],
    });
  });

  it('fails closed on duplicate numbers within a part before partial crossing findings', () => {
    const model = scoreWithNotesByVoice({
      S: [{ pitch: 'G4', dur: 1 }],
      A: [{ pitch: 'A4', dur: 1 }],
      T: [{ pitch: 'C4', dur: 1 }],
      B: [{ pitch: 'D4', dur: 1 }],
    });
    appendMeasure(model, 'A', 2);
    appendMeasure(model, 'A', 2);
    appendMeasure(model, 'A', 8);
    appendMeasure(model, 'A', 8);
    appendMeasure(model, 'S', 1);

    expect(validateVoiceCrossing(model)).toEqual({
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

  it('ignores duplicate measure labels on a lone soprano with no alto partner', () => {
    const model = scoreWithNotesByVoice({
      S: [{ pitch: 'G4', dur: 1 }],
    });
    appendMeasure(model, 'S', 1);

    expect(validateVoiceCrossing(model)).toEqual({ errors: [], warnings: [] });
  });

  it('allows the same measure number in different parts', () => {
    expect(
      validateVoiceCrossing(
        scoreWithNotesByVoice(
          {
            S: [{ pitch: 'G4', dur: 1 }],
            A: [{ pitch: 'A4', dur: 1 }],
            T: [{ pitch: 'C4', dur: 1 }],
            B: [{ pitch: 'D4', dur: 1 }],
          },
          7
        )
      )
    ).toEqual({
      errors: [
        {
          part: 'S',
          measure: 7,
          beat: 1,
          code: 'VOICE_CROSSING',
          message: 'S (G4) is below A (A4) at a shared onset.',
        },
        {
          part: 'T',
          measure: 7,
          beat: 1,
          code: 'VOICE_CROSSING',
          message: 'T (C4) is below B (D4) at a shared onset.',
        },
      ],
      warnings: [],
    });
  });

  it('accepts globally unique measure labels when there are no crossing findings', () => {
    const model = scoreWithNotesByVoice({
      S: [{ pitch: 'C5', dur: 1 }],
      A: [{ pitch: 'G4', dur: 1 }],
      T: [{ pitch: 'C4', dur: 1 }],
      B: [{ pitch: 'C3', dur: 1 }],
    });
    model.parts.forEach((part, index) => {
      part.measures[0]!.number = index + 1;
    });

    expect(validateVoiceCrossing(model)).toEqual({ errors: [], warnings: [] });
  });

  it('aligns by resolved onset rather than event-array index', () => {
    const result = validateVoiceCrossing(
      scoreWithNotesByVoice(
        {
          S: [
            { pitch: 'G4', dur: 1, onset: 2 },
            { pitch: 'C5', dur: 1, onset: 0 },
          ],
          A: [
            { pitch: 'F4', dur: 1, onset: 0 },
            { pitch: 'A4', dur: 1, onset: 2 },
          ],
          T: [
            { pitch: 'C4', dur: 1, onset: 0 },
            { pitch: 'C4', dur: 1, onset: 2 },
          ],
          B: [
            { pitch: 'C3', dur: 1, onset: 0 },
            { pitch: 'C3', dur: 1, onset: 2 },
          ],
        },
        4
      )
    );

    expect(result).toEqual({
      errors: [
        {
          part: 'S',
          measure: 4,
          beat: 3,
          code: 'VOICE_CROSSING',
          message: 'S (G4) is below A (A4) at a shared onset.',
        },
      ],
      warnings: [],
    });
  });

  it('detects a crossing at a shared onset when the two voices use different event grids', () => {
    const result = validateVoiceCrossing(
      scoreWithNotesByVoice({
        S: [
          { pitch: 'C5', dur: 1 },
          { pitch: 'D5', dur: 1 },
          { pitch: 'G4', dur: 1 },
        ],
        A: [
          { pitch: 'F4', dur: 2 },
          { pitch: 'A4', dur: 1 },
        ],
        T: [{ pitch: 'C4', dur: 3 }],
        B: [{ pitch: 'C3', dur: 3 }],
      })
    );

    expect(result).toEqual({
      errors: [
        {
          part: 'S',
          measure: 1,
          beat: 3,
          code: 'VOICE_CROSSING',
          message: 'S (G4) is below A (A4) at a shared onset.',
        },
      ],
      warnings: [],
    });
  });

  it('allows equality at a shared onset because only a lower upper voice crosses', () => {
    expect(
      validateVoiceCrossing(
        scoreWithNotesByVoice({
          S: [{ pitch: 'C4', dur: 1 }],
          A: [{ pitch: 'C4', dur: 1 }],
          T: [{ pitch: 'C4', dur: 1 }],
          B: [{ pitch: 'C3', dur: 1 }],
        })
      )
    ).toEqual({ errors: [], warnings: [] });
  });

  it('keeps chord members at the preceding event onset instead of treating them sequentially', () => {
    expect(
      validateVoiceCrossing(
        scoreWithNotesByVoice({
          S: [
            { pitch: 'C5', dur: 1 },
            { pitch: 'G4', dur: 1, chord: true },
          ],
          A: [
            { pitch: 'D4', dur: 1 },
            { pitch: 'A4', dur: 1 },
          ],
          T: [{ pitch: 'C4', dur: 2 }],
          B: [{ pitch: 'C3', dur: 2 }],
        })
      )
    ).toEqual({ errors: [], warnings: [] });
  });

  it('ignores rests as pitches while counting their duration in the voice timeline', () => {
    expect(
      validateVoiceCrossing(
        scoreWithNotesByVoice({
          S: [
            { pitch: 'C5', dur: 1 },
            { pitch: null, dur: 1 },
            { pitch: 'E5', dur: 1 },
          ],
          A: [
            { pitch: 'G4', dur: 1 },
            { pitch: 'G5', dur: 1 },
            { pitch: 'D5', dur: 1 },
          ],
          T: [{ pitch: 'C4', dur: 3 }],
          B: [{ pitch: 'C3', dur: 3 }],
        })
      )
    ).toEqual({ errors: [], warnings: [] });
  });

  it('checks tied note segments at their own shared onsets', () => {
    const result = validateVoiceCrossing(
      scoreWithNotesByVoice({
        S: [
          { pitch: 'C5', dur: 1, tie: true },
          { pitch: 'C5', dur: 1 },
        ],
        A: [
          { pitch: 'G4', dur: 1 },
          { pitch: 'D5', dur: 1 },
        ],
        T: [{ pitch: 'C4', dur: 2 }],
        B: [{ pitch: 'C3', dur: 2 }],
      })
    );

    expect(result).toEqual({
      errors: [
        {
          part: 'S',
          measure: 1,
          beat: 2,
          code: 'VOICE_CROSSING',
          message: 'S (C5) is below A (D5) at a shared onset.',
        },
      ],
      warnings: [],
    });
  });

  it('does not flag inverted pitches whose note onsets are not shared', () => {
    expect(
      validateVoiceCrossing(
        scoreWithNotesByVoice({
          S: [{ pitch: 'G4', dur: 2, onset: 0 }],
          A: [{ pitch: 'A4', dur: 1, onset: 1 }],
          T: [{ pitch: 'C4', dur: 1, onset: 1 }],
          B: [{ pitch: 'C3', dur: 1, onset: 1 }],
        })
      )
    ).toEqual({ errors: [], warnings: [] });
  });
});
