import { describe, expect, it } from 'vitest';
import { scoreModelSchema } from '../scoreModel.js';
import { validateMeasureDuration } from './index.js';

function scoreWithDurations(
  durations: number[],
  time: { beats: number; beatType: number }
) {
  return scoreModelSchema.parse({
    title: 'Duration fixture',
    key: { fifths: 0, mode: 'major' },
    time,
    tempo: 90,
    parts: [
      {
        id: 'S',
        clef: 'treble',
        measures: [
          {
            number: 1,
            notes: durations.map((dur) => ({ pitch: null, dur })),
          },
        ],
      },
    ],
  });
}

describe('validateMeasureDuration', () => {
  it.each([
    { label: '4/4', time: { beats: 4, beatType: 4 }, durations: [1, 1, 1, 1] },
    {
      label: '6/8',
      time: { beats: 6, beatType: 8 },
      durations: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    },
  ])('accepts a complete $label measure', ({ time, durations }) => {
    expect(
      validateMeasureDuration(scoreWithDurations(durations, time))
    ).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it.each([
    { label: 'underfilled', durations: [1, 1, 1, 0.5], beat: 4.5 },
    { label: 'overfilled', durations: [1, 1, 1, 1, 0.5], beat: 5 },
  ])(
    'returns one located error for an $label 4/4 measure',
    ({ durations, beat }) => {
      const result = validateMeasureDuration(
        scoreWithDurations(durations, { beats: 4, beatType: 4 })
      );

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        part: 'S',
        measure: 1,
        beat,
        code: 'MEASURE_DURATION',
      });
      expect(result.errors[0]!.message.trim()).not.toBe('');
      expect(result.warnings).toEqual([]);
    }
  );
});
