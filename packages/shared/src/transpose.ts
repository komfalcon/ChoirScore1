import {
  intervalBetweenTonicNames,
  intervalForSemitones,
  midiForPitch,
  parseInterval,
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

function transformNote(note: ScoreNote, interval: PitchInterval): ScoreNote {
  return {
    ...note,
    pitch: note.pitch === null ? null : transposePitch(note.pitch, interval),
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
  return {
    ...model,
    key: targetGlobalKey ?? keyAfterInterval(model.key, interval),
    parts: model.parts.map((part) => ({
      ...part,
      measures: part.measures.map((measure) => ({
        ...measure,
        ...(measure.key
          ? { key: keyAfterInterval(measure.key, interval) }
          : {}),
        notes: measure.notes.map((note) => transformNote(note, interval)),
      })),
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
