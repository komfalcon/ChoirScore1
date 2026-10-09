import { describe, expect, it } from 'vitest';
import { scoreModelSchema } from '../scoreModel.js';
import { validateMeasureDuration, type Issue } from './index.js';

type FixtureNote = {
  pitch?: string | null;
  dur: number;
  voice?: string;
  staff?: number;
  onset?: number;
  chord?: boolean;
};

function scoreWithNotes(
  notes: FixtureNote[],
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
        measures: [{ number: 1, notes }],
      },
    ],
  });
}

function scoreWithDurations(
  durations: number[],
  time: { beats: number; beatType: number }
) {
  return scoreWithNotes(
    durations.map((dur) => ({ pitch: null, dur })),
    time
  );
}

function expectDurationIssue(
  issue: Issue | undefined,
  beat: number,
  actual: number,
  expected: number
) {
  expect(issue).toEqual({
    part: 'S',
    measure: 1,
    beat,
    code: 'MEASURE_DURATION',
    message: expect.stringContaining(
      `${actual} quarter-note units; expected ${expected}.`
    ),
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

  it('counts two simultaneous four-quarter chord notes once in 4/4', () => {
    const result = validateMeasureDuration(
      scoreWithNotes(
        [
          { pitch: 'C4', dur: 4 },
          { pitch: 'G4', dur: 4, chord: true },
        ],
        { beats: 4, beatType: 4 }
      )
    );

    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('resolves explicit onsets when measuring the timeline extent', () => {
    const result = validateMeasureDuration(
      scoreWithNotes(
        [
          { pitch: null, dur: 1, onset: 0 },
          { pitch: null, dur: 1, onset: 2 },
          { pitch: null, dur: 1 },
        ],
        { beats: 4, beatType: 4 }
      )
    );

    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('resolves the same voice number independently on distinct staves', () => {
    const result = validateMeasureDuration(
      scoreWithNotes(
        [
          { pitch: null, dur: 4, voice: '1', staff: 1 },
          { pitch: null, dur: 4, voice: '1', staff: 2 },
        ],
        { beats: 4, beatType: 4 }
      )
    );

    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('validates simultaneous independent voices on separate timelines', () => {
    const notes = ['1', '2'].flatMap((voice) =>
      [1, 1, 1, 1].map((dur) => ({ pitch: null, dur, voice }))
    );
    const result = validateMeasureDuration(
      scoreWithNotes(notes, { beats: 4, beatType: 4 })
    );

    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('allows implicit trailing silence on a shorter concurrent voice', () => {
    const result = validateMeasureDuration(
      scoreWithNotes(
        [
          { pitch: null, dur: 4, voice: '1' },
          { pitch: null, dur: 1, voice: '2' },
        ],
        { beats: 4, beatType: 4 }
      )
    );

    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it.each([
    {
      label: 'underfilled 4/4',
      time: { beats: 4, beatType: 4 },
      durations: [1, 1, 1, 0.5],
      beat: 4.5,
      actual: 3.5,
      expected: 4,
    },
    {
      label: 'overfilled 4/4',
      time: { beats: 4, beatType: 4 },
      durations: [1, 1, 1, 1, 0.5],
      beat: 5,
      actual: 4.5,
      expected: 4,
    },
    {
      label: 'underfilled 6/8',
      time: { beats: 6, beatType: 8 },
      durations: [0.5, 0.5, 0.5, 0.5, 0.5],
      beat: 6,
      actual: 2.5,
      expected: 3,
    },
    {
      label: 'overfilled 6/8',
      time: { beats: 6, beatType: 8 },
      durations: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      beat: 7,
      actual: 3.5,
      expected: 3,
    },
  ])('returns a located error for an $label measure', (fixture) => {
    const result = validateMeasureDuration(
      scoreWithDurations(fixture.durations, fixture.time)
    );

    expect(result.errors).toHaveLength(1);
    expectDurationIssue(
      result.errors[0],
      fixture.beat,
      fixture.actual,
      fixture.expected
    );
    expect(result.warnings).toEqual([]);
  });
});
