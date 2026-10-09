import { describe, expect, it } from 'vitest';
import {
  modelToSolfaText,
  parseSolfaText,
  SolfaTextError,
  solfaTextToModel,
  serializeSolfaText,
} from './solfaText.js';
import { scoreModelSchema } from './scoreModel.js';

function seededRandom(seed: number): () => number {
  let state = (seed + 0x9e3779b9) >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function generatedSupportedText(seed: number): string {
  const random = seededRandom(seed);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)]!;
  const syllables = [
    'd',
    'di',
    'r',
    'ri',
    'ra',
    'm',
    'me',
    'f',
    'fi',
    's',
    'si',
    'se',
    'l',
    'li',
    'le',
    't',
    'te',
  ] as const;
  const octaveMarks = ['', "'", "''", ',', ',,'] as const;
  const pitch = () => `${pick(syllables)}${pick(octaveMarks)}`;
  const beat = () => {
    if (random() < 0.62) return random() < 0.12 ? '0' : pitch();
    return random() < 0.5 ? `0.${pitch()}` : `${pitch()}.0`;
  };
  const beatCount = pick([2, 3, 4, 6]);
  const beatType = pick([4, 8]);
  const barCount = 1 + Math.floor(random() * 4);
  const selectedParts = ['S', 'A', 'T', 'B'].filter(() => random() < 0.65);
  if (selectedParts.length === 0) selectedParts.push('S');
  const header = random() < 0.5 ? 'Doh is C' : 'Doh is C · Lah is A';
  const rows = selectedParts.map((part) => {
    const bars = Array.from({ length: barCount }, () =>
      Array.from({ length: beatCount }, beat).join(' : ')
    );
    return `${part}: | ${bars.join(' | ')} |`;
  });
  return [
    header,
    `Time ${beatCount}/${beatType}`,
    `Tempo ${60 + Math.floor(random() * 121)}`,
    '',
    ...rows,
  ].join('\n');
}

function generatedTieAndLyricText(seed: number): string {
  const random = seededRandom(seed + 0x10000);
  const syllables = ['d', 'di', 'r', 'ra', 'm', 'f', 's', 'le', 't'] as const;
  const octaveMarks = ['', "'", ','] as const;
  const pitch = () =>
    `${syllables[Math.floor(random() * syllables.length)]}${octaveMarks[Math.floor(random() * octaveMarks.length)]}`;
  let priorBeatWasSung = false;
  let sungNoteCount = 0;
  const bars = Array.from({ length: 3 }, (_, barIndex) =>
    Array.from({ length: 4 }, (_, beatIndex) => {
      const token =
        barIndex === 0 && beatIndex === 0
          ? pitch()
          : priorBeatWasSung && random() < 0.22
            ? '-'
            : random() < 0.18
              ? '0'
              : pitch();
      if (token === '0') priorBeatWasSung = false;
      else if (token !== '-') {
        priorBeatWasSung = true;
        sungNoteCount += 1;
      }
      return token;
    }).join(' : ')
  );
  const lyricVerse = () => {
    const words: string[] = [];
    let remaining = sungNoteCount;
    while (remaining > 0) {
      const wordLength = 1 + Math.floor(random() * Math.min(3, remaining));
      const word = Array.from(
        { length: wordLength },
        () => ['ha', 'lu', 'jah', 'sing', 'joy'][Math.floor(random() * 5)]!
      ).join('-');
      words.push(word);
      remaining -= wordLength;
    }
    return words.join(' ');
  };
  return [
    'Doh is C',
    'Time 4/4',
    `Tempo ${60 + Math.floor(random() * 121)}`,
    '',
    `S: | ${bars.join(' | ')} |`,
    '',
    `L1: ${lyricVerse()}`,
    `L2: ${lyricVerse()}`,
  ].join('\n');
}

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

  it('rejects unsupported double-quote octave marks rather than canonicalizing them away', () => {
    expect(() =>
      parseSolfaText(`Doh is C
Time 4/4
Tempo 90

S: | d" : r : m : f |`)
    ).toThrow(/Part S, Bar 1, Beat 1: unsupported beat token/);
  });

  it('round-trips deterministic generated examples across supported grammar combinations', () => {
    for (let seed = 1; seed <= 96; seed += 1) {
      const text = generatedSupportedText(seed);
      const model = parseSolfaText(text);
      const serialized = modelToSolfaText(model);
      expect(serialized, `canonical text for seed ${seed}`).toBe(text);
      expect(
        parseSolfaText(serialized),
        `model round-trip for seed ${seed}`
      ).toEqual(model);
    }
  });

  it('round-trips deterministic bar-crossing holds and lyric verses', () => {
    for (let seed = 1; seed <= 48; seed += 1) {
      const text = generatedTieAndLyricText(seed);
      const model = parseSolfaText(text);
      const serialized = modelToSolfaText(model);
      expect(serialized, `tie and lyric text for seed ${seed}`).toBe(text);
      expect(
        parseSolfaText(serialized),
        `tie and lyric model for seed ${seed}`
      ).toEqual(model);
    }
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

  it('reports schema-invalid note durations at the note Part, Bar, and Beat', () => {
    const valid = parseSolfaText(`Doh is C
Time 4/4
Tempo 90

S: | d : r : m : f |`);
    const invalidDuration = structuredClone(valid);
    invalidDuration.parts[0]!.measures[0]!.notes[2]!.dur = 0;

    try {
      modelToSolfaText(invalidDuration);
      throw new Error('expected serialization to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(SolfaTextError);
      expect(error).toMatchObject({
        code: 'INVALID_SCORE_MODEL',
        part: 'S',
        bar: 1,
        beat: 3,
      });
      expect((error as Error).message).toContain('Part S, Bar 1, Beat 3:');
    }
  });
});
