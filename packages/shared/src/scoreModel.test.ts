import { describe, expect, it } from 'vitest';
import { scoreModelSchema } from './scoreModel.js';

const minimalModel = {
  title: 'Test score',
  key: { fifths: 0, mode: 'major' as const },
  time: { beats: 4, beatType: 4 },
  parts: [
    {
      id: 'S',
      clef: 'treble' as const,
      measures: [
        {
          number: 1,
          notes: [
            {
              pitch: 'F#4',
              dur: 1 / 3,
              tie: false,
              tuplet: {
                actualNotes: 3,
                normalNotes: 2,
                normalType: 'quarter' as const,
              },
            },
          ],
        },
      ],
    },
  ],
};

describe('shared score model', () => {
  it('supports voice/tuplet-capable notes while defaulting simple notes to voice 1', () => {
    const model = scoreModelSchema.parse(minimalModel);
    expect(model.parts[0]?.measures[0]?.notes[0]).toMatchObject({
      pitch: 'F#4',
      dur: 1 / 3,
      tie: false,
      voice: '1',
      staff: 1,
      chord: false,
      tuplet: { actualNotes: 3, normalNotes: 2, normalType: 'quarter' },
    });
    expect(model.tempo).toBe(90);
  });

  it('rejects invalid scientific pitches, non-positive durations and undeclared fields', () => {
    const invalidPitch: unknown = structuredClone(minimalModel);
    const invalidPitchValue = invalidPitch as {
      parts: { measures: { notes: { pitch: string; dur: number }[] }[] }[];
    };
    invalidPitchValue.parts[0]!.measures[0]!.notes[0]!.pitch = 'H4';
    expect(scoreModelSchema.safeParse(invalidPitch).success).toBe(false);

    const invalidDuration: unknown = structuredClone(minimalModel);
    const invalidDurationValue = invalidDuration as {
      parts: { measures: { notes: { pitch: string; dur: number }[] }[] }[];
    };
    invalidDurationValue.parts[0]!.measures[0]!.notes[0]!.dur = 0;
    expect(scoreModelSchema.safeParse(invalidDuration).success).toBe(false);

    expect(
      scoreModelSchema.safeParse({
        ...minimalModel,
        arbitrary: 'not in the contract',
      }).success
    ).toBe(false);
  });
});
