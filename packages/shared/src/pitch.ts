import { scorePitchSchema } from './scoreModel.js';

export interface PitchInterval {
  /** Signed chromatic distance in semitones. */
  semitones: number;
  /** Signed diatonic letter steps, where C to D is +1. */
  diatonicSteps: number;
}

interface ParsedPitch {
  letter: string;
  letterIndex: number;
  accidental: number;
  octave: number;
  midi: number;
  diatonicIndex: number;
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const NATURAL_PITCH_CLASS: Record<(typeof LETTERS)[number], number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
const BASE_INTERVALS: Record<number, number> = {
  1: 0,
  2: 2,
  3: 4,
  4: 5,
  5: 7,
  6: 9,
  7: 11,
};
const SEMITONE_INTERVALS: Record<number, { quality: string; degree: number }> =
  {
    0: { quality: 'P', degree: 1 },
    1: { quality: 'm', degree: 2 },
    2: { quality: 'M', degree: 2 },
    3: { quality: 'm', degree: 3 },
    4: { quality: 'M', degree: 3 },
    5: { quality: 'P', degree: 4 },
    6: { quality: 'A', degree: 4 },
    7: { quality: 'P', degree: 5 },
    8: { quality: 'm', degree: 6 },
    9: { quality: 'M', degree: 6 },
    10: { quality: 'm', degree: 7 },
    11: { quality: 'M', degree: 7 },
  };

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function accidentalValue(text: string): number {
  if (text.startsWith('#')) return text.length;
  if (text.startsWith('b')) return -text.length;
  return 0;
}

function accidentalText(value: number): string {
  if (!Number.isInteger(value) || Math.abs(value) > 2) {
    throw new RangeError(
      `The requested transposition requires an unsupported ${value}-semitone accidental.`
    );
  }
  return value > 0 ? '#'.repeat(value) : 'b'.repeat(-value);
}

export function parsePitch(value: string): ParsedPitch {
  if (!scorePitchSchema.safeParse(value).success) {
    throw new TypeError(`Invalid scientific pitch: ${String(value)}.`);
  }
  const match = /^([A-G])((?:#{1,2}|b{1,2})?)(-?\d+)$/.exec(value);
  if (!match) throw new TypeError(`Invalid scientific pitch: ${value}.`);

  const letter = match[1]!;
  const octave = Number(match[3]);
  if (!Number.isSafeInteger(octave)) {
    throw new RangeError(
      `Pitch octave is outside the supported integer range: ${value}.`
    );
  }
  const letterIndex = LETTERS.indexOf(letter as (typeof LETTERS)[number]);
  const accidental = accidentalValue(match[2]!);
  const midi =
    (octave + 1) * 12 +
    NATURAL_PITCH_CLASS[letter as (typeof LETTERS)[number]] +
    accidental;
  const diatonicIndex = octave * 7 + letterIndex;
  if (!Number.isSafeInteger(midi) || !Number.isSafeInteger(diatonicIndex)) {
    throw new RangeError(
      `Pitch is outside the supported integer range: ${value}.`
    );
  }
  return { letter, letterIndex, accidental, octave, midi, diatonicIndex };
}

export function midiForPitch(value: string): number {
  return parsePitch(value).midi;
}

export function pitchNameWithoutOctave(value: string): string {
  const parsed = parsePitch(value);
  return `${parsed.letter}${accidentalText(parsed.accidental)}`;
}

function pitchFromCoordinates(midi: number, diatonicIndex: number): string {
  if (!Number.isSafeInteger(midi) || !Number.isSafeInteger(diatonicIndex)) {
    throw new RangeError(
      'The requested transposition is outside the supported pitch range.'
    );
  }
  const octave = Math.floor(diatonicIndex / 7);
  const letterIndex = positiveModulo(diatonicIndex, 7);
  const letter = LETTERS[letterIndex]!;
  const naturalMidi = (octave + 1) * 12 + NATURAL_PITCH_CLASS[letter];
  const accidental = midi - naturalMidi;
  return `${letter}${accidentalText(accidental)}${octave}`;
}

export function transposePitch(value: string, interval: PitchInterval): string {
  const source = parsePitch(value);
  return pitchFromCoordinates(
    source.midi + interval.semitones,
    source.diatonicIndex + interval.diatonicSteps
  );
}

/**
 * Parses conventional interval names such as M2, m3, P5, A4, dd5 and -m2.
 * Compound intervals are supported; interval spelling is retained during
 * pitch transposition rather than reduced to a chromatic distance.
 */
export function parseInterval(value: string): PitchInterval {
  const match = /^(-)?(P|M|m|A+|d+)([1-9]\d*)$/.exec(value);
  if (!match) {
    throw new TypeError(
      `Invalid interval "${value}". Use a conventional interval such as M2, P5 or -m3.`
    );
  }

  const direction = match[1] ? -1 : 1;
  const quality = match[2]!;
  const degree = Number(match[3]);
  if (!Number.isSafeInteger(degree) || degree > 512) {
    throw new RangeError(
      `Interval degree is outside the supported range: ${value}.`
    );
  }
  const simpleDegree = ((degree - 1) % 7) + 1;
  const octaves = Math.floor((degree - 1) / 7);
  const perfectClass =
    simpleDegree === 1 || simpleDegree === 4 || simpleDegree === 5;
  let alteration: number;

  if (perfectClass) {
    if (quality === 'P') alteration = 0;
    else if (quality.startsWith('A')) alteration = quality.length;
    else if (quality.startsWith('d')) alteration = -quality.length;
    else
      throw new TypeError(
        `Interval quality ${quality} is not valid for degree ${degree}.`
      );
  } else {
    if (quality === 'M') alteration = 0;
    else if (quality === 'm') alteration = -1;
    else if (quality.startsWith('A')) alteration = quality.length;
    else if (quality.startsWith('d')) alteration = -(quality.length + 1);
    else
      throw new TypeError(
        `Interval quality ${quality} is not valid for degree ${degree}.`
      );
  }

  const semitones =
    (BASE_INTERVALS[simpleDegree]! + octaves * 12 + alteration) * direction;
  if (!Number.isSafeInteger(semitones)) {
    throw new RangeError(`Interval is outside the supported range: ${value}.`);
  }
  return { semitones, diatonicSteps: (degree - 1) * direction };
}

/**
 * Selects deterministic, conventional spelling for a chromatic shift:
 * semitones use the common ascending interval name for that distance, with
 * the same interval quality descending so an up/down pair round-trips.
 */
export function intervalForSemitones(semitones: number): PitchInterval {
  if (!Number.isSafeInteger(semitones)) {
    throw new TypeError('Semitone transposition must be a safe integer.');
  }
  if (semitones === 0) return { semitones: 0, diatonicSteps: 0 };

  const direction = semitones < 0 ? -1 : 1;
  const magnitude = Math.abs(semitones);
  const octaves = Math.floor(magnitude / 12);
  const remainder = magnitude % 12;
  const simple = SEMITONE_INTERVALS[remainder]!;
  const degree = octaves * 7 + simple.degree;
  const parsed = parseInterval(`${simple.quality}${degree}`);
  return {
    semitones,
    diatonicSteps: parsed.diatonicSteps * direction,
  };
}

/**
 * Builds the nearest signed chromatic interval between two tonic spellings.
 * A tritone tie is consistently treated as an ascending six semitones.
 */
export function intervalBetweenTonicNames(
  sourceName: string,
  targetName: string
): PitchInterval {
  const source = parsePitch(`${sourceName}4`);
  const targetAtOctaveFour = parsePitch(`${targetName}4`);
  const pitchClassDifference = positiveModulo(
    targetAtOctaveFour.midi - source.midi,
    12
  );
  const semitones =
    pitchClassDifference > 6 ? pitchClassDifference - 12 : pitchClassDifference;
  const targetMidi = source.midi + semitones;
  const octaveAdjustment = (targetMidi - targetAtOctaveFour.midi) / 12;
  if (!Number.isInteger(octaveAdjustment)) {
    throw new RangeError(
      'Unable to construct a transposition interval for the requested keys.'
    );
  }
  const target = parsePitch(`${targetName}${4 + octaveAdjustment}`);
  return {
    semitones,
    diatonicSteps: target.diatonicIndex - source.diatonicIndex,
  };
}
