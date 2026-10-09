import { describe, expect, it } from 'vitest';
import {
  modelToSolfaText,
  parseSolfaText,
  SolfaTextError,
  solfaTextToModel,
  serializeSolfaText,
} from './solfaText.js';
import { scoreModelSchema } from './scoreModel.js';

const SATB_TEXT = `Doh is C
Time 4/4
Tempo 96

S: | d : di : ra : d' | - : t, : 0 : d |
A: | m : f : s : l | - : t : 0 : r |
T: | s, : d : r : m | - : s, : 0 : m |
B: | d, : s, : d, : f, | - : d, : 0 : t, |

L1: Ha-le-lu-jah ho-ly
L2: Do-re-mi-fa so-la`;

describe('Sol-fa text core', () => {
  it('parses SATB, full/half beats, bar-crossing holds, octave marks, rests and independent lyric verses canonically', () => {
    const model = parseSolfaText(SATB_TEXT, { title: 'Test hymn' });
    const soprano = model.parts.find((part) => part.id === 'S')!;
    const sopranoFirst = soprano.measures[0]!.notes;
    const sopranoSecond = soprano.measures[1]!.notes;

    expect(model).toMatchObject({
      title: 'Test hymn',
      key: { fifths: 0, mode: 'major' },
      time: { beats: 4, beatType: 4 },
      tempo: 96,
    });
    expect(sopranoFirst.map((note) => note.pitch)).toEqual([
      'C4',
      'C#4',
      'Db4',
      'C5',
    ]);
    expect(sopranoFirst[3]!.tie).toBe(true);
    expect(sopranoSecond[0]).toMatchObject({ pitch: 'C5', dur: 1, onset: 0 });
    expect(sopranoSecond[1]!.pitch).toBe('B3');
    expect(sopranoSecond[2]!.pitch).toBeNull();
    expect(sopranoSecond[3]!.pitch).toBe('C4');
    expect(sopranoFirst[0]!.lyrics).toEqual([
      { text: 'Ha', syllabic: 'begin', verse: 1 },
      { text: 'Do', syllabic: 'begin', verse: 2 },
    ]);
    expect(sopranoFirst[1]!.lyrics).toEqual([
      { text: 'le', syllabic: 'middle', verse: 1 },
      { text: 're', syllabic: 'middle', verse: 2 },
    ]);

    const canonical = modelToSolfaText(model);
    expect(canonical).toContain("S: | d : di : ra : d' | - : t, : 0 : d |");
    expect(canonical).toContain('L1: Ha-le-lu-jah ho-ly');
    expect(canonical).toContain('L2: Do-re-mi-fa so-la');
    expect(modelToSolfaText(parseSolfaText(canonical))).toBe(canonical);
    expect(serializeSolfaText(model)).toBe(canonical);
    expect(solfaTextToModel(canonical).parts).toHaveLength(4);
  });

  it('round-trips explicit half-beats and half-beat rests without rounding', () => {
    const text = `Doh is C
Time 4/4
Tempo 120

S: | d.r : m.0 : 0.t, : - |`;
    const model = parseSolfaText(text);
    const notes = model.parts[0]!.measures[0]!.notes;
    expect(
      notes.map(({ pitch, dur, onset }) => ({ pitch, dur, onset }))
    ).toEqual([
      { pitch: 'C4', dur: 0.5, onset: 0 },
      { pitch: 'D4', dur: 0.5, onset: 0.5 },
      { pitch: 'E4', dur: 0.5, onset: 1 },
      { pitch: null, dur: 1, onset: 1.5 },
      { pitch: 'B3', dur: 1.5, onset: 2.5 },
    ]);
    const canonical = modelToSolfaText(model);
    expect(canonical).toContain('S: | d.r : m.0 : 0.t, : - |');
    expect(modelToSolfaText(parseSolfaText(canonical))).toBe(canonical);
  });

  it('supports every approved spelled chromatic syllable without enharmonic respelling', () => {
    const text = `Doh is C
Time 4/4
Tempo 90

S: | di : ri : fi : si | li : ra : me : se | le : te : d : r |`;
    const model = parseSolfaText(text);
    expect(
      model.parts[0]!.measures.flatMap((measure) =>
        measure.notes.map((note) => note.pitch)
      )
    ).toEqual([
      'C#4',
      'D#4',
      'F#4',
      'G#4',
      'A#4',
      'Db4',
      'Eb4',
      'Gb4',
      'Ab4',
      'Bb4',
      'C4',
      'D4',
    ]);
    expect(modelToSolfaText(model)).toBe(text);
  });

  it('uses relative-major Doh/Lah for a minor key', () => {
    const model = parseSolfaText(`Doh is C · Lah is A
Time 4/4
Tempo 90

A: | l : d : m : s |`);
    expect(model.key).toEqual({ fifths: 0, mode: 'minor' });
    expect(model.parts[0]!.measures[0]!.notes[0]!.pitch).toBe('A4');
    expect(modelToSolfaText(model)).toContain('Doh is C · Lah is A');
  });

  it('reports bar duration errors with part, bar, beat, and expected versus actual', () => {
    try {
      parseSolfaText(`Doh is C
Time 4/4
Tempo 90

T: | d : r : m |`);
      throw new Error('expected parsing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(SolfaTextError);
      expect(error).toMatchObject({
        code: 'DURATION_MISMATCH',
        part: 'T',
        bar: 1,
        beat: 4,
        expected: 4,
        actual: 3,
      });
      expect((error as Error).message).toContain('Part T, Bar 1, Beat 4');
      expect((error as Error).message).toContain(
        'expected 4 beats, got 3 beats'
      );
    }
  });

  it('rejects unsupported alterations, invalid holds, and lyric-track misalignment in place', () => {
    expect(() =>
      parseSolfaText(`Doh is C
Time 4/4
Tempo 90

S: | mi : r : m : f |`)
    ).toThrow(/Part S, Bar 1, Beat 1/);

    expect(() =>
      parseSolfaText(`Doh is C
Time 4/4
Tempo 90

S: | - : r : m : f |`)
    ).toThrow(/Part S, Bar 1, Beat 1/);

    try {
      parseSolfaText(`Doh is C
Time 4/4
Tempo 90

S: | d : r : m : f |
L1: one two`);
      throw new Error('expected lyric alignment to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(SolfaTextError);
      expect(error).toMatchObject({
        code: 'LYRIC_ALIGNMENT',
        part: 'S',
        bar: 1,
      });
      expect((error as Error).message).toContain(
        'L1 has 2 syllables but S has 4 sung note onsets'
      );
    }
  });

  it('rejects unrepresentable ScoreModel structures instead of dropping or respelling them', () => {
    const supported = parseSolfaText(`Doh is C
Time 4/4
Tempo 90

S: | d : r : m : f |`);
    const withTuplet = scoreModelSchema.parse({
      ...supported,
      parts: [
        {
          ...supported.parts[0],
          measures: [
            {
              ...supported.parts[0]!.measures[0],
              notes: supported.parts[0]!.measures[0]!.notes.map(
                (note, index) =>
                  index === 0
                    ? { ...note, tuplet: { actualNotes: 3, normalNotes: 2 } }
                    : note
              ),
            },
          ],
        },
      ],
    });
    expect(() => modelToSolfaText(withTuplet)).toThrow(/Part S, Bar 1, Beat 1/);

    const unsupportedPitch = scoreModelSchema.parse({
      ...supported,
      parts: [
        {
          ...supported.parts[0],
          measures: [
            {
              ...supported.parts[0]!.measures[0],
              notes: supported.parts[0]!.measures[0]!.notes.map(
                (note, index) =>
                  index === 0 ? { ...note, pitch: 'E#4' } : note
              ),
            },
          ],
        },
      ],
    });
    expect(() => modelToSolfaText(unsupportedPitch)).toThrow(
      /approved spelled-degree Sol-fa table/
    );
  });
});
