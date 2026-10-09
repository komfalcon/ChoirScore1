import { describe, expect, it } from 'vitest';
import { scoreModelSchema, type ScoreModel } from './scoreModel.js';
import { transpose, type TransposeOptions } from './transpose.js';

function createModel(): ScoreModel {
  return scoreModelSchema.parse({
    title: 'Transposition fixture',
    composer: 'Test Composer',
    key: { fifths: 0, mode: 'major' },
    time: { beats: 4, beatType: 4 },
    tempo: 72,
    parts: [
      {
        id: 'S',
        name: 'Soprano',
        clef: 'treble',
        measures: [
          {
            number: 0,
            notes: [
              {
                pitch: 'C4',
                dur: 1 / 3,
                tie: true,
                lyric: { text: 'Sing', syllabic: 'begin', verse: 1 },
                lyrics: [
                  { text: 'Sing', syllabic: 'begin', verse: 1 },
                  { text: 'Praise', syllabic: 'single', verse: 2 },
                ],
                voice: '2',
                staff: 2,
                onset: 0,
                chord: false,
                tuplet: {
                  actualNotes: 3,
                  normalNotes: 2,
                  normalType: 'quarter',
                },
              },
              {
                pitch: null,
                dur: 1,
                tie: false,
                voice: '2',
                staff: 2,
                onset: 1 / 3,
                chord: false,
              },
              {
                pitch: 'D4',
                dur: 1 / 3,
                tie: false,
                lyric: { text: 'now', syllabic: 'end' },
                voice: '2',
                staff: 2,
                onset: 1 / 3,
                chord: true,
              },
            ],
          },
          {
            number: 1,
            key: { fifths: 1, mode: 'major' },
            notes: [
              {
                pitch: 'F#4',
                dur: 2,
                tie: false,
                voice: '1',
                staff: 1,
                onset: 0,
                chord: false,
                tuplet: { actualNotes: 5, normalNotes: 4 },
              },
            ],
          },
        ],
      },
    ],
  });
}

describe('shared pure transpose', () => {
  it('treats semitones, conventional intervals, and a target key as equivalent', () => {
    const model = createModel();
    const bySemitones = transpose(model, { semitones: 2 });
    const byInterval = transpose(model, { interval: 'M2' });
    const byKey = transpose(model, { toKey: { fifths: 2, mode: 'major' } });

    expect(byInterval).toEqual(bySemitones);
    expect(byKey).toEqual(bySemitones);
    expect(bySemitones.parts[0]?.measures[0]?.notes[0]?.pitch).toBe('D4');
  });

  it('rejects missing, multiple, malformed, and non-integer selectors', () => {
    const model = createModel();
    const invalidOptions = [
      {},
      { semitones: 1, interval: 'm2' },
      { semitones: 1.5 },
      { interval: 'P0' },
      { toKey: { fifths: 8, mode: 'major' } },
    ];

    for (const options of invalidOptions) {
      expect(() =>
        transpose(model, options as unknown as TransposeOptions)
      ).toThrow();
    }
  });

  it('round-trips spelling and measure keys while preserving all score and note metadata', () => {
    const model = createModel();
    const before = structuredClone(model);
    const forward = transpose(model, { interval: 'M2' });
    const roundTrip = transpose(forward, { interval: '-M2' });

    expect(roundTrip).toEqual(before);
    expect(model).toEqual(before);
    expect(forward.title).toBe(model.title);
    expect(forward.composer).toBe(model.composer);
    expect(forward.time).toEqual(model.time);
    expect(forward.tempo).toBe(model.tempo);
    expect(forward.parts[0]?.measures[0]?.notes[0]).toMatchObject({
      pitch: 'D4',
      dur: 1 / 3,
      tie: true,
      lyric: { text: 'Sing', syllabic: 'begin', verse: 1 },
      lyrics: [
        { text: 'Sing', syllabic: 'begin', verse: 1 },
        { text: 'Praise', syllabic: 'single', verse: 2 },
      ],
      voice: '2',
      staff: 2,
      onset: 0,
      chord: false,
      tuplet: { actualNotes: 3, normalNotes: 2, normalType: 'quarter' },
    });
    expect(forward.parts[0]?.measures[0]?.notes[1]?.pitch).toBeNull();
    expect(forward.parts[0]?.measures[0]?.notes[2]).toMatchObject({
      pitch: 'E4',
      chord: true,
      onset: 1 / 3,
    });
    expect(forward.parts[0]?.measures[1]?.key).toEqual({
      fifths: 3,
      mode: 'major',
    });
  });

  it('uses a <=5-accidental enharmonic key when available without changing pitch shift', () => {
    const model = createModel();
    const shifted = transpose(model, { semitones: 1 });
    const toSharpKey = transpose(model, {
      toKey: { fifths: 7, mode: 'major' },
    });

    expect(shifted.parts[0]?.measures[0]?.notes[0]?.pitch).toBe('Db4');
    expect(shifted.key).toEqual({ fifths: -5, mode: 'major' });
    expect(toSharpKey.parts[0]?.measures[0]?.notes[0]?.pitch).toBe('Db4');
    expect(toSharpKey.key).toEqual({ fifths: -5, mode: 'major' });
    expect(toSharpKey.parts[0]?.measures[0]?.notes[0]?.pitch).toBe(
      shifted.parts[0]?.measures[0]?.notes[0]?.pitch
    );
  });
});
