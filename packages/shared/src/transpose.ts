import {
  intervalBetweenTonicNames,
  intervalForSemitones,
  midiForPitch,
  parseInterval,
  parsePitch,
  pitchNameWithoutOctave,
  transposePitch,
  type PitchInterval,
} from './pitch.js';
import {
  scoreKeySchema,
  type ScoreKey,
  type ScoreModel,
  type ScoreNote,
} from './scoreModel.js';

export type TransposeOptions =
  | { semitones: number; interval?: never; toKey?: never }
  | { interval: string; semitones?: never; toKey?: never }
  | { toKey: ScoreKey; semitones?: never; interval?: never };

const MAJOR_TONICS_BY_FIFTHS: Record<number, string> = {
  [-7]: 'Cb',
  [-6]: 'Gb',
  [-5]: 'Db',
  [-4]: 'Ab',
  [-3]: 'Eb',
  [-2]: 'Bb',
  [-1]: 'F',
  0: 'C',
  1: 'G',
  2: 'D',
  3: 'A',
  4: 'E',
  5: 'B',
  6: 'F#',
  7: 'C#',
};

const MODE_TONIC_INTERVAL: Record<ScoreKey['mode'], string> = {
  major: 'P1',
  ionian: 'P1',
  minor: 'M6',
  aeolian: 'M6',
  dorian: 'M2',
  phrygian: 'M3',
  lydian: 'P4',
  mixolydian: 'P5',
  locrian: 'M7',
  none: 'P1',
};

const PITCH_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const NATURAL_PITCH_CLASSES: Record<(typeof PITCH_LETTERS)[number], number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

function keyTonic(key: ScoreKey): string {
  const majorTonic = MAJOR_TONICS_BY_FIFTHS[key.fifths];
  if (majorTonic === undefined) {
    throw new TypeError(`Invalid key-signature fifths value: ${key.fifths}.`);
  }
  return transposePitch(
    `${majorTonic}4`,
    parseInterval(MODE_TONIC_INTERVAL[key.mode])
  );
}

function keyForTonic(tonic: string, mode: ScoreKey['mode']): ScoreKey {
  const targetPitchClass = ((midiForPitch(tonic) % 12) + 12) % 12;
  const targetName = pitchNameWithoutOctave(tonic);
  const matches = Array.from({ length: 15 }, (_, index) => index - 7)
    .map((fifths) => ({ fifths, mode }))
    .filter((candidate) => {
      const candidatePitchClass =
        ((midiForPitch(keyTonic(candidate)) % 12) + 12) % 12;
      return candidatePitchClass === targetPitchClass;
    });

  if (matches.length === 0) {
    throw new RangeError(
      `No supported key signature represents tonic ${targetName} ${mode}.`
    );
  }

  const signaturesWithFiveOrFewer = matches.filter(
    (candidate) => Math.abs(candidate.fifths) <= 5
  );
  const preferred = signaturesWithFiveOrFewer.length
    ? signaturesWithFiveOrFewer
    : matches;
  preferred.sort((left, right) => {
    const leftExact =
      pitchNameWithoutOctave(keyTonic(left)) === targetName ? 0 : 1;
    const rightExact =
      pitchNameWithoutOctave(keyTonic(right)) === targetName ? 0 : 1;
    return (
      leftExact - rightExact ||
      Math.abs(left.fifths) - Math.abs(right.fifths) ||
      left.fifths - right.fifths
    );
  });
  return preferred[0]!;
}

function normalizedKey(key: ScoreKey): ScoreKey {
  const validated = scoreKeySchema.parse(key);
  return keyForTonic(keyTonic(validated), validated.mode);
}

function keyAfterInterval(key: ScoreKey, interval: PitchInterval): ScoreKey {
  const tonic = transposePitch(keyTonic(key), interval);
  return keyForTonic(tonic, key.mode);
}

function keySignatureAlteration(key: ScoreKey, letter: string): number {
  if (key.fifths === 0) return 0;
  const order = key.fifths > 0 ? SHARP_ORDER : FLAT_ORDER;
  return order.slice(0, Math.abs(key.fifths)).includes(letter)
    ? Math.sign(key.fifths)
    : 0;
}

interface SpellingCandidate {
  pitch: string;
  accidental: number;
  diatonicIndex: number;
  letterIndex: number;
}

/**
 * Keeps an interval's conventional spelling when it fits the target key;
 * otherwise prefers a spelling from the target key. Chromatic notes retain
 * their interval spelling where possible, with a bounded enharmonic fallback.
 */
function transposePitchInKey(
  value: string,
  interval: PitchInterval,
  targetKey: ScoreKey
): string {
  const source = parsePitch(value);
  const targetMidi = source.midi + interval.semitones;
  const targetDiatonicIndex = source.diatonicIndex + interval.diatonicSteps;
  if (
    !Number.isSafeInteger(targetMidi) ||
    !Number.isSafeInteger(targetDiatonicIndex)
  ) {
    throw new RangeError(
      'The requested transposition is outside the supported pitch range.'
    );
  }

  const expectedOctave = Math.floor(targetDiatonicIndex / 7);
  const expectedLetterIndex = ((targetDiatonicIndex % 7) + 7) % 7;
  const expectedLetter = PITCH_LETTERS[expectedLetterIndex]!;
  const expectedNaturalMidi =
    (expectedOctave + 1) * 12 + NATURAL_PITCH_CLASSES[expectedLetter];
  let intervalSpelling: string | undefined;
  let intervalAccidental: number | undefined;
  if (Number.isSafeInteger(expectedNaturalMidi)) {
    intervalAccidental = targetMidi - expectedNaturalMidi;
    if (Math.abs(intervalAccidental) <= 2) {
      const accidentalText =
        intervalAccidental > 0
          ? '#'.repeat(intervalAccidental)
          : 'b'.repeat(-intervalAccidental);
      intervalSpelling = `${expectedLetter}${accidentalText}${expectedOctave}`;
    }
  }

  const approximateOctave = Math.floor(targetMidi / 12) - 1;
  const candidates: SpellingCandidate[] = [];
  for (
    let octave = approximateOctave - 2;
    octave <= approximateOctave + 2;
    octave += 1
  ) {
    for (
      let letterIndex = 0;
      letterIndex < PITCH_LETTERS.length;
      letterIndex += 1
    ) {
      const letter = PITCH_LETTERS[letterIndex]!;
      const naturalMidi = (octave + 1) * 12 + NATURAL_PITCH_CLASSES[letter];
      if (!Number.isSafeInteger(naturalMidi)) continue;
      const accidental = targetMidi - naturalMidi;
      if (!Number.isInteger(accidental) || Math.abs(accidental) > 2) continue;
      const accidentalText =
        accidental > 0 ? '#'.repeat(accidental) : 'b'.repeat(-accidental);
      const diatonicIndex = octave * 7 + letterIndex;
      if (!Number.isSafeInteger(diatonicIndex)) continue;
      candidates.push({
        pitch: `${letter}${accidentalText}${octave}`,
        accidental,
        diatonicIndex,
        letterIndex,
      });
    }
  }

  const intervalIsInKey =
    intervalAccidental !== undefined &&
    intervalAccidental === keySignatureAlteration(targetKey, expectedLetter);
  if (intervalSpelling && intervalIsInKey) return intervalSpelling;

  const inKeyCandidates = candidates.filter(
    (candidate) =>
      candidate.accidental ===
      keySignatureAlteration(targetKey, PITCH_LETTERS[candidate.letterIndex]!)
  );
  const byIntervalDistance = (
    left: SpellingCandidate,
    right: SpellingCandidate
  ) =>
    Math.abs(left.diatonicIndex - targetDiatonicIndex) -
      Math.abs(right.diatonicIndex - targetDiatonicIndex) ||
    Math.abs(left.accidental) - Math.abs(right.accidental) ||
    left.letterIndex - right.letterIndex;
  inKeyCandidates.sort(byIntervalDistance);
  if (inKeyCandidates.length > 0) return inKeyCandidates[0]!.pitch;
  if (intervalSpelling) return intervalSpelling;

  candidates.sort(
    (left, right) =>
      Math.abs(left.accidental) - Math.abs(right.accidental) ||
      byIntervalDistance(left, right)
  );
  if (candidates.length === 0) {
    throw new RangeError(
      'The requested transposition cannot be represented within the supported accidental limit.'
    );
  }
  return candidates[0]!.pitch;
}

function resolveOptions(
  model: ScoreModel,
  options: TransposeOptions
): { interval: PitchInterval; targetGlobalKey?: ScoreKey } {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('Transpose options must be an object.');
  }
  const supplied = (['semitones', 'interval', 'toKey'] as const).filter(
    (selector) =>
      Object.hasOwn(options, selector) && options[selector] !== undefined
  );
  if (supplied.length !== 1) {
    throw new TypeError(
      'Specify exactly one of semitones, interval, or toKey.'
    );
  }

  switch (supplied[0]) {
    case 'semitones': {
      const semitones = options.semitones;
      if (typeof semitones !== 'number' || !Number.isSafeInteger(semitones)) {
        throw new TypeError('Semitone transposition must be a safe integer.');
      }
      return { interval: intervalForSemitones(semitones) };
    }
    case 'interval': {
      if (typeof options.interval !== 'string') {
        throw new TypeError(
          'Interval transposition must be a conventional interval string.'
        );
      }
      return { interval: parseInterval(options.interval) };
    }
    case 'toKey': {
      const parsed = scoreKeySchema.safeParse(options.toKey);
      if (!parsed.success) {
        throw new TypeError('toKey must be a valid shared ScoreKey.');
      }
      const targetGlobalKey = normalizedKey(parsed.data);
      const sourceTonic = pitchNameWithoutOctave(keyTonic(model.key));
      const targetTonic = pitchNameWithoutOctave(keyTonic(targetGlobalKey));
      return {
        interval: intervalBetweenTonicNames(sourceTonic, targetTonic),
        targetGlobalKey,
      };
    }
  }
}

function transformNote(
  note: ScoreNote,
  interval: PitchInterval,
  targetKey: ScoreKey
): ScoreNote {
  return {
    ...note,
    pitch:
      note.pitch === null
        ? null
        : transposePitchInKey(note.pitch, interval, targetKey),
    ...(note.lyric ? { lyric: { ...note.lyric } } : {}),
    ...(note.lyrics
      ? { lyrics: note.lyrics.map((lyric) => ({ ...lyric })) }
      : {}),
    ...(note.tuplet ? { tuplet: { ...note.tuplet } } : {}),
  };
}

/**
 * Purely transposes every pitched event and every explicit per-measure key
 * change. Durations, lyrics, ties, onsets, voices/staves, chords, tuplets and
 * score-level metadata are copied without modification.
 */
export function transpose(
  model: ScoreModel,
  options: TransposeOptions
): ScoreModel {
  const { interval, targetGlobalKey } = resolveOptions(model, options);
  const resultingGlobalKey =
    targetGlobalKey ?? keyAfterInterval(model.key, interval);
  return {
    ...model,
    key: resultingGlobalKey,
    parts: model.parts.map((part) => ({
      ...part,
      measures: part.measures.map((measure) => {
        const resultingMeasureKey = measure.key
          ? keyAfterInterval(measure.key, interval)
          : resultingGlobalKey;
        return {
          ...measure,
          ...(measure.key ? { key: resultingMeasureKey } : {}),
          notes: measure.notes.map((note) =>
            transformNote(note, interval, resultingMeasureKey)
          ),
        };
      }),
    })),
  };
}

/** Internal helper shared by range-fit candidate ranking. */
export function keyAfterSemitoneShift(
  key: ScoreKey,
  semitones: number
): ScoreKey {
  return keyAfterInterval(key, intervalForSemitones(semitones));
}
