import { chromaticSolfaSyllable } from './chromaticSolfa.js';
import type { DiatonicSolfaSyllable } from './chromaticSolfa.js';
import type {
  ScoreKey,
  ScoreLyric,
  ScoreModel,
  ScorePart,
} from './scoreModel.js';

export type SolfaCellKind = 'syllable' | 'hold' | 'rest' | 'unsupported';

export type SolfaLyricCell = {
  verse: number;
  text: string;
  syllabic?: ScoreLyric['syllabic'];
};

export type SolfaSegment = {
  kind: SolfaCellKind;
  /** Plain-text syllable form, including `'` or `,` octave marks. */
  text: string;
  pitch?: string;
  lyrics: SolfaLyricCell[];
  eventId?: number;
};

export type SolfaBeat = {
  number: number;
  /** One segment for a whole beat, two segments when the beat is split in half. */
  segments: [SolfaSegment] | [SolfaSegment, SolfaSegment];
};

export type SolfaMeasurePart = {
  number: number;
  beats: SolfaBeat[];
};

export type SolfaPartSystem = {
  id: string;
  label: string;
  measures: SolfaMeasurePart[];
};

export type SolfaMeasureHeader = {
  number: number;
  beats: number;
  /** Set only at a mid-score key change. */
  dohMarker?: string;
};

export type SolfaSystem = {
  number: number;
  measures: SolfaMeasureHeader[];
  parts: SolfaPartSystem[];
};

export type SolfaWarningCode =
  | 'CHROMATIC_NOTE'
  | 'UNSUPPORTED_SUBDIVISION'
  | 'TUPLET'
  | 'CHORD_OR_OVERLAP'
  | 'MEASURE_OVERRUN'
  | 'TIME_SIGNATURE_LIMIT';

export type SolfaWarning = {
  code: SolfaWarningCode;
  part: string;
  measure: number;
  beat: number;
  message: string;
  pitch?: string;
};

export type SolfaLayout = {
  header: {
    doh: string;
    lah?: string;
    keyText: string;
    time: string;
    tempo: number;
  };
  systems: SolfaSystem[];
  warnings: SolfaWarning[];
};

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
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'] as const;
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'] as const;
const MAJOR_TONIC_BY_FIFTHS: Record<number, (typeof LETTERS)[number]> = {
  [-7]: 'C',
  [-6]: 'G',
  [-5]: 'D',
  [-4]: 'A',
  [-3]: 'E',
  [-2]: 'B',
  [-1]: 'F',
  0: 'C',
  1: 'G',
  2: 'D',
  3: 'A',
  4: 'E',
  5: 'B',
  6: 'F',
  7: 'C',
};
const SYLLABLES: readonly DiatonicSolfaSyllable[] = [
  'd',
  'r',
  'm',
  'f',
  's',
  'l',
  't',
];
const EPSILON = 0.000001;
const MAX_DISPLAY_BEATS = 64;
const MEASURES_PER_SYSTEM = 4;

function sameKey(left: ScoreKey, right: ScoreKey): boolean {
  return left.fifths === right.fifths && left.mode === right.mode;
}

function signatureAccidentals(key: ScoreKey): Map<string, string> {
  const accidentals = new Map<string, string>();
  if (key.fifths > 0) {
    for (const letter of SHARP_ORDER.slice(0, key.fifths)) {
      accidentals.set(letter, '#');
    }
  } else if (key.fifths < 0) {
    for (const letter of FLAT_ORDER.slice(0, Math.abs(key.fifths))) {
      accidentals.set(letter, 'b');
    }
  }
  return accidentals;
}

function letterAtOffset(
  tonic: (typeof LETTERS)[number],
  offset: number
): (typeof LETTERS)[number] {
  return LETTERS[(LETTERS.indexOf(tonic) + offset + 7) % 7]!;
}

function dohOffsetForMode(mode: ScoreKey['mode']): number {
  switch (mode) {
    case 'dorian':
      return 1;
    case 'phrygian':
      return 2;
    case 'lydian':
      return 3;
    case 'mixolydian':
      return 4;
    case 'locrian':
      return 6;
    default:
      return 0;
  }
}

function isRelativeMinor(mode: ScoreKey['mode']): boolean {
  return mode === 'minor' || mode === 'aeolian';
}

function spelledKeyNote(
  key: ScoreKey,
  letter: (typeof LETTERS)[number]
): string {
  return `${letter}${signatureAccidentals(key).get(letter) ?? ''}`;
}

function keyHeader(key: ScoreKey): { doh: string; lah?: string; text: string } {
  const majorTonic = MAJOR_TONIC_BY_FIFTHS[key.fifths] ?? 'C';
  const dohLetter = letterAtOffset(majorTonic, dohOffsetForMode(key.mode));
  const doh = spelledKeyNote(key, dohLetter);
  const lah = isRelativeMinor(key.mode)
    ? spelledKeyNote(key, letterAtOffset(majorTonic, 5))
    : undefined;
  return {
    doh,
    ...(lah ? { lah } : {}),
    text: `Doh is ${doh}${lah ? ` · Lah is ${lah}` : ''}`,
  };
}

function diatonicCoordinate(letter: string, octave: number): number {
  return octave * 7 + LETTERS.indexOf(letter as (typeof LETTERS)[number]);
}

function midiPitchClass(letter: string, accidental: string): number {
  const base = NATURAL_PITCH_CLASS[letter as (typeof LETTERS)[number]] ?? 0;
  const alteration =
    accidental === '#'
      ? 1
      : accidental === '##'
        ? 2
        : accidental === 'b'
          ? -1
          : accidental === 'bb'
            ? -2
            : 0;
  return (base + alteration + 12) % 12;
}

function accidentalSemitones(accidental: string): number {
  return [...accidental].reduce(
    (semitones, symbol) => semitones + (symbol === '#' ? 1 : -1),
    0
  );
}

function nearestDohCoordinate(
  key: ScoreKey,
  dohLetter: (typeof LETTERS)[number]
): number {
  const accidental = signatureAccidentals(key).get(dohLetter) ?? '';
  const pitchClass = midiPitchClass(dohLetter, accidental);
  let nearestOctave = 4;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestMidi = Number.POSITIVE_INFINITY;
  for (let octave = 0; octave <= 8; octave += 1) {
    const midi = (octave + 1) * 12 + pitchClass;
    const distance = Math.abs(midi - 60);
    if (
      distance < nearestDistance ||
      (distance === nearestDistance && midi < nearestMidi)
    ) {
      nearestDistance = distance;
      nearestMidi = midi;
      nearestOctave = octave;
    }
  }
  return diatonicCoordinate(dohLetter, nearestOctave);
}

function pitchToSolfa(
  pitch: string,
  key: ScoreKey,
  dohLetter: (typeof LETTERS)[number],
  baseDohCoordinate: number
): { text: string } | { unsupported: true } {
  const match = /^([A-G])([#b]{0,2})(-?\d+)$/.exec(pitch);
  if (!match) return { unsupported: true };
  const letter = match[1]!;
  const accidental = match[2] ?? '';
  const octave = Number(match[3]);
  const expectedAccidental = signatureAccidentals(key).get(letter) ?? '';
  const accidentalDifference =
    accidentalSemitones(accidental) - accidentalSemitones(expectedAccidental);

  const degree =
    (LETTERS.indexOf(letter as (typeof LETTERS)[number]) -
      LETTERS.indexOf(dohLetter) +
      7) %
    7;
  let syllable: string = SYLLABLES[degree]!;
  if (accidentalDifference !== 0) {
    if (accidentalDifference !== -1 && accidentalDifference !== 1) {
      return { unsupported: true };
    }
    const chromaticSyllable = chromaticSolfaSyllable(
      SYLLABLES[degree]!,
      accidentalDifference > 0 ? 'raised' : 'lowered'
    );
    if (!chromaticSyllable) return { unsupported: true };
    syllable = chromaticSyllable;
  }

  const octaveDifference = Math.floor(
    (diatonicCoordinate(letter, octave) - baseDohCoordinate) / 7
  );
  const octaveMarks =
    octaveDifference > 0
      ? "'".repeat(octaveDifference)
      : ','.repeat(Math.abs(octaveDifference));
  return { text: `${syllable}${octaveMarks}` };
}

function normalizedLyrics(
  note: ScorePart['measures'][number]['notes'][number]
): ScoreLyric[] {
  if (note.lyrics?.length) return note.lyrics;
  return note.lyric ? [note.lyric] : [];
}

function partLabel(
  part: ScorePart,
  index: number
): { label: string; rank: number } {
  const raw = part.name?.trim() || part.id;
  const normalized = raw.toLowerCase().replace(/[^a-z]/g, '');
  const aliases: Array<[RegExp, string, number]> = [
    [/^(s|sop|soprano)$/, 'Soprano', 0],
    [/^(a|alto)$/, 'Alto', 1],
    [/^(t|tenor)$/, 'Tenor', 2],
    [/^(b|bass|baritone)$/, 'Bass', 3],
  ];
  const match = aliases.find(([pattern]) => pattern.test(normalized));
  return match
    ? { label: match[1], rank: match[2] }
    : { label: raw || `Part ${index + 1}`, rank: 10 + index };
}

function emptySegment(): SolfaSegment {
  return { kind: 'rest', text: '', lyrics: [], eventId: 0 };
}

function warning(
  warnings: SolfaWarning[],
  input: Omit<SolfaWarning, 'message'> & { message: string }
): void {
  warnings.push(input);
}

function lyricCells(
  note: ScorePart['measures'][number]['notes'][number]
): SolfaLyricCell[] {
  return normalizedLyrics(note).map((lyric, index) => ({
    verse: lyric.verse ?? index + 1,
    text: lyric.text,
    ...(lyric.syllabic ? { syllabic: lyric.syllabic } : {}),
  }));
}

/**
 * Deterministically projects the shared score model into a beat-aligned Tonic
 * Sol-fa layout. Chromatic pitches without an entry in the approved
 * spelled-degree table and rhythms finer than half a beat are returned as
 * visible warnings/cells.
 */
export function modelToSolfa(model: ScoreModel): SolfaLayout {
  const warnings: SolfaWarning[] = [];
  const rankedParts = model.parts
    .map((part, index) => ({ part, ...partLabel(part, index), index }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index);
  const maxMeasures = Math.max(
    0,
    ...rankedParts.map(({ part }) => part.measures.length)
  );
  const initialKey =
    rankedParts.map(({ part }) => part.measures[0]?.key).find((key) => key) ??
    model.key;
  let activeKey = initialKey;
  const keyTimeline: Array<{ key: ScoreKey; marker?: string }> = [];
  for (let measureIndex = 0; measureIndex < maxMeasures; measureIndex += 1) {
    const nextKey = rankedParts
      .map(({ part }) => part.measures[measureIndex]?.key)
      .find((key) => key !== undefined);
    let marker: string | undefined;
    if (nextKey && !sameKey(activeKey, nextKey)) {
      activeKey = nextKey;
      if (measureIndex > 0) marker = keyHeader(activeKey).text;
    }
    keyTimeline.push({ key: activeKey, ...(marker ? { marker } : {}) });
  }

  const beatLimit = Math.min(model.time.beats, MAX_DISPLAY_BEATS);
  if (model.time.beats > MAX_DISPLAY_BEATS) {
    for (const { label } of rankedParts) {
      warning(warnings, {
        code: 'TIME_SIGNATURE_LIMIT',
        part: label,
        measure: 1,
        beat: MAX_DISPLAY_BEATS + 1,
        message: `This time signature has ${model.time.beats} beats per bar; Sol-fa display is limited to ${MAX_DISPLAY_BEATS}. Switch to staff view for the complete measure.`,
      });
    }
  }
  const beatUnit = 4 / model.time.beatType;
  const halfBeat = beatUnit / 2;
  const slotsPerMeasure = beatLimit * 2;
  const partMeasures = new Map<string, SolfaMeasurePart[]>();

  for (const { part, label } of rankedParts) {
    const layouts: SolfaMeasurePart[] = [];
    let carriedTiePitch: string | null = null;
    for (let measureIndex = 0; measureIndex < maxMeasures; measureIndex += 1) {
      const measure = part.measures[measureIndex];
      const number = measure?.number ?? measureIndex + 1;
      const slots: Array<SolfaSegment | null> = Array.from(
        { length: slotsPerMeasure },
        () => null
      );
      let cursor = 0;
      let previousOnset = 0;
      let nextEventId = 1;
      for (const note of measure?.notes ?? []) {
        const onset = note.onset ?? (note.chord ? previousOnset : cursor);
        if (!note.chord) {
          previousOnset = onset;
          cursor = onset + note.dur;
        }
        const startPosition = onset / halfBeat;
        const durationPosition = note.dur / halfBeat;
        const startSlot = Math.round(startPosition);
        const durationSlots = Math.max(1, Math.round(durationPosition));
        const beat = Math.max(
          1,
          Math.min(beatLimit, Math.floor(onset / beatUnit) + 1)
        );
        const hasUnsupportedGrid =
          Math.abs(startPosition - startSlot) > EPSILON ||
          Math.abs(durationPosition - durationSlots) > EPSILON;
        const continuationOfTie =
          note.pitch !== null &&
          carriedTiePitch !== null &&
          note.pitch === carriedTiePitch;
        const isTuplet = Boolean(note.tuplet);
        const eventId = nextEventId++;
        let firstKind: SolfaCellKind = 'syllable';
        let symbol = '';
        let unsupportedCode: SolfaWarningCode | undefined;

        if (note.chord) {
          firstKind = 'unsupported';
          symbol = '?';
          unsupportedCode = 'CHORD_OR_OVERLAP';
        } else if (hasUnsupportedGrid || isTuplet) {
          firstKind = 'unsupported';
          symbol = '?';
          unsupportedCode = isTuplet ? 'TUPLET' : 'UNSUPPORTED_SUBDIVISION';
        } else if (note.pitch === null) {
          firstKind = 'rest';
          symbol = '';
        } else if (continuationOfTie) {
          firstKind = 'hold';
          symbol = '-';
        } else {
          const key = keyTimeline[measureIndex]?.key ?? model.key;
          const keyTonic = MAJOR_TONIC_BY_FIFTHS[key.fifths] ?? 'C';
          const dohLetter = letterAtOffset(
            keyTonic,
            dohOffsetForMode(key.mode)
          );
          const mapped = pitchToSolfa(
            note.pitch,
            key,
            dohLetter,
            nearestDohCoordinate(key, dohLetter)
          );
          if ('unsupported' in mapped) {
            firstKind = 'unsupported';
            symbol = '?';
            unsupportedCode = 'CHROMATIC_NOTE';
          } else {
            symbol = mapped.text;
          }
        }

        if (unsupportedCode) {
          const message =
            unsupportedCode === 'CHROMATIC_NOTE'
              ? `Bar ${number}, ${label}, beat ${beat}: chromatic pitch ${note.pitch ?? ''} has no entry in the approved spelled-degree movable-Do table. No enharmonic respelling was applied.`
              : unsupportedCode === 'TUPLET'
                ? `Bar ${number}, ${label}, beat ${beat}: tuplet rhythm is not represented in the Sol-fa view. Switch to staff view to inspect it.`
                : unsupportedCode === 'UNSUPPORTED_SUBDIVISION'
                  ? `Bar ${number}, ${label}, beat ${beat}: this note is finer than a half beat; quarter-beat and other unsupported subdivisions are not rendered.`
                  : `Bar ${number}, ${label}, beat ${beat}: chord or overlapping notes cannot be shown in a single Sol-fa part row.`;
          warning(warnings, {
            code: unsupportedCode,
            part: label,
            measure: number,
            beat,
            message,
            ...(note.pitch ? { pitch: note.pitch } : {}),
          });
        }

        const lyrics =
          firstKind === 'syllable' && !continuationOfTie
            ? lyricCells(note)
            : [];
        const inMeasureStart = Math.max(0, startSlot);
        if (startSlot < 0 || startSlot >= slotsPerMeasure) {
          warning(warnings, {
            code: 'MEASURE_OVERRUN',
            part: label,
            measure: number,
            beat,
            message: `Bar ${number}, ${label}, beat ${beat}: note onset is outside the measure and cannot be displayed in Sol-fa.`,
            ...(note.pitch ? { pitch: note.pitch } : {}),
          });
          carriedTiePitch = note.tie && note.pitch ? note.pitch : null;
          continue;
        }
        for (let offset = 0; offset < durationSlots; offset += 1) {
          const slotIndex = inMeasureStart + offset;
          if (slotIndex >= slotsPerMeasure) {
            if (offset === 0) continue;
            warning(warnings, {
              code: 'MEASURE_OVERRUN',
              part: label,
              measure: number,
              beat,
              message: `Bar ${number}, ${label}, beat ${beat}: note duration extends beyond the bar and is clipped in Sol-fa.`,
              ...(note.pitch ? { pitch: note.pitch } : {}),
            });
            break;
          }
          if (slots[slotIndex]) {
            warning(warnings, {
              code: 'CHORD_OR_OVERLAP',
              part: label,
              measure: number,
              beat,
              message: `Bar ${number}, ${label}, beat ${beat}: overlapping notes cannot be shown in a single Sol-fa part row.`,
              ...(note.pitch ? { pitch: note.pitch } : {}),
            });
            slots[slotIndex] = {
              kind: 'unsupported',
              text: '?',
              pitch: note.pitch ?? undefined,
              lyrics: [],
              eventId,
            };
            continue;
          }
          slots[slotIndex] = {
            kind: offset === 0 ? firstKind : 'hold',
            text: offset === 0 ? symbol : '-',
            ...(note.pitch ? { pitch: note.pitch } : {}),
            lyrics: offset === 0 ? lyrics : [],
            eventId,
          };
        }
        carriedTiePitch = note.tie && note.pitch ? note.pitch : null;
      }

      const beats: SolfaBeat[] = Array.from(
        { length: beatLimit },
        (_, beatIndex) => {
          const first = slots[beatIndex * 2] ?? emptySegment();
          const second = slots[beatIndex * 2 + 1] ?? emptySegment();
          const sameEvent =
            first.eventId !== undefined && first.eventId === second.eventId;
          return {
            number: beatIndex + 1,
            segments: sameEvent ? [first] : [first, second],
          };
        }
      );
      layouts.push({ number, beats });
    }
    partMeasures.set(part.id, layouts);
  }

  const systems: SolfaSystem[] = [];
  for (let start = 0; start < maxMeasures; start += MEASURES_PER_SYSTEM) {
    const end = Math.min(maxMeasures, start + MEASURES_PER_SYSTEM);
    const measures: SolfaMeasureHeader[] = [];
    for (let index = start; index < end; index += 1) {
      const number =
        rankedParts
          .map(({ part }) => part.measures[index]?.number)
          .find((value) => value !== undefined) ?? index + 1;
      const keyInfo = keyTimeline[index];
      measures.push({
        number,
        beats: beatLimit,
        ...(keyInfo?.marker ? { dohMarker: keyInfo.marker } : {}),
      });
    }
    systems.push({
      number: systems.length + 1,
      measures,
      parts: rankedParts.map(({ part, label }) => ({
        id: part.id,
        label,
        measures: (partMeasures.get(part.id) ?? []).slice(start, end),
      })),
    });
  }

  const initialHeader = keyHeader(keyTimeline[0]?.key ?? initialKey);
  return {
    header: {
      doh: initialHeader.doh,
      ...(initialHeader.lah ? { lah: initialHeader.lah } : {}),
      keyText: initialHeader.text,
      time: `${model.time.beats}/${model.time.beatType}`,
      tempo: model.tempo,
    },
    systems,
    warnings,
  };
}
