import { chromaticSolfaSyllable } from './chromaticSolfa.js';
import {
  scoreModelSchema,
  type ScoreKey,
  type ScoreLyric,
  type ScoreModel,
  type ScoreModelInput,
  type ScoreNoteInput,
  type ScorePartInput,
} from './scoreModel.js';

export type SolfaTextErrorCode =
  | 'INVALID_SYNTAX'
  | 'INVALID_HEADER'
  | 'MISSING_HEADER'
  | 'DUPLICATE_ROW'
  | 'DURATION_MISMATCH'
  | 'INVALID_HOLD'
  | 'LYRIC_ALIGNMENT'
  | 'UNSUPPORTED_STRUCTURE'
  | 'INVALID_SCORE_MODEL';

export type SolfaTextLocation = {
  part: string;
  bar: number;
  beat: number;
};

export class SolfaTextError extends Error {
  readonly code: SolfaTextErrorCode;
  readonly part: string;
  readonly bar: number;
  readonly beat: number;
  readonly expected?: number | string;
  readonly actual?: number | string;

  constructor(
    code: SolfaTextErrorCode,
    message: string,
    location: SolfaTextLocation,
    values: { expected?: number | string; actual?: number | string } = {}
  ) {
    super(
      `Part ${location.part}, Bar ${location.bar}, Beat ${location.beat}: ${message}`
    );
    this.name = 'SolfaTextError';
    this.code = code;
    this.part = location.part;
    this.bar = location.bar;
    this.beat = location.beat;
    if (values.expected !== undefined) this.expected = values.expected;
    if (values.actual !== undefined) this.actual = values.actual;
  }
}

export type ParseSolfaTextOptions = {
  /** ScoreModel metadata is not part of the Sol-fa text grammar. */
  title?: string;
};

type Cell =
  { kind: 'syllable'; pitch: string } | { kind: 'hold' } | { kind: 'rest' };

type ParsedBar = { cells: Cell[] };
type ParsedPart = { id: PartId; bars: ParsedBar[] };
type PartId = 'S' | 'A' | 'T' | 'B';
type MutableNote = ScoreNoteInput & {
  pitch: string | null;
  dur: number;
  tie: boolean;
  onset: number;
};
type NoteRef = {
  note: MutableNote;
  part: PartId;
  measureIndex: number;
  beat: number;
};

const PART_IDS: readonly PartId[] = ['S', 'A', 'T', 'B'];
const PART_CLEF: Record<PartId, ScorePartInput['clef']> = {
  S: 'treble',
  A: 'treble',
  T: 'treble8vb',
  B: 'bass',
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
const FIFTHS_BY_DOH: Record<string, number> = {
  Cb: -7,
  Gb: -6,
  Db: -5,
  Ab: -4,
  Eb: -3,
  Bb: -2,
  F: -1,
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  'F#': 6,
  'C#': 7,
};
const EPSILON = 0.000001;
const MAX_TEXT_SLOT_COUNT = 8192;
const SYLLABLE_TO_ALTERATION: Record<
  string,
  { degree: number; alteration: -1 | 0 | 1 }
> = {
  d: { degree: 0, alteration: 0 },
  di: { degree: 0, alteration: 1 },
  r: { degree: 1, alteration: 0 },
  ri: { degree: 1, alteration: 1 },
  ra: { degree: 1, alteration: -1 },
  m: { degree: 2, alteration: 0 },
  me: { degree: 2, alteration: -1 },
  f: { degree: 3, alteration: 0 },
  fi: { degree: 3, alteration: 1 },
  s: { degree: 4, alteration: 0 },
  si: { degree: 4, alteration: 1 },
  se: { degree: 4, alteration: -1 },
  l: { degree: 5, alteration: 0 },
  li: { degree: 5, alteration: 1 },
  le: { degree: 5, alteration: -1 },
  t: { degree: 6, alteration: 0 },
  te: { degree: 6, alteration: -1 },
};
const DEGREE_SYLLABLES = ['d', 'r', 'm', 'f', 's', 'l', 't'] as const;

function fail(
  code: SolfaTextErrorCode,
  message: string,
  location: SolfaTextLocation,
  values: { expected?: number | string; actual?: number | string } = {}
): never {
  throw new SolfaTextError(code, message, location, values);
}

function headerLocation(): SolfaTextLocation {
  return { part: 'Header', bar: 1, beat: 1 };
}

function keySignatureAccidentals(
  key: Pick<ScoreKey, 'fifths'>
): Map<string, string> {
  const accidentals = new Map<string, string>();
  if (key.fifths > 0) {
    for (const letter of SHARP_ORDER.slice(0, key.fifths))
      accidentals.set(letter, '#');
  } else if (key.fifths < 0) {
    for (const letter of FLAT_ORDER.slice(0, Math.abs(key.fifths)))
      accidentals.set(letter, 'b');
  }
  return accidentals;
}

function accidentalSemitones(accidental: string): number {
  return [...accidental].reduce(
    (sum, symbol) => sum + (symbol === '#' ? 1 : -1),
    0
  );
}

function accidentalFromSemitones(semitones: number): string | undefined {
  if (semitones === 0) return '';
  if (semitones === 1) return '#';
  if (semitones === 2) return '##';
  if (semitones === -1) return 'b';
  if (semitones === -2) return 'bb';
  return undefined;
}

function letterAtOffset(letter: string, offset: number): string {
  return LETTERS[
    (LETTERS.indexOf(letter as (typeof LETTERS)[number]) + offset) % 7
  ]!;
}

function spelledKeyTonic(fifths: number): string {
  const tonicLetter = MAJOR_TONIC_BY_FIFTHS[fifths];
  if (!tonicLetter) throw new Error(`Unsupported key signature: ${fifths}`);
  return `${tonicLetter}${keySignatureAccidentals({ fifths }).get(tonicLetter) ?? ''}`;
}

function relativeMinorName(fifths: number): string {
  const majorTonic = MAJOR_TONIC_BY_FIFTHS[fifths];
  if (!majorTonic) throw new Error(`Unsupported key signature: ${fifths}`);
  const minorLetter = letterAtOffset(majorTonic, 5);
  return `${minorLetter}${keySignatureAccidentals({ fifths }).get(minorLetter) ?? ''}`;
}

function keyFromHeader(doh: string, lah: string | undefined): ScoreKey {
  const fifths = FIFTHS_BY_DOH[doh];
  if (fifths === undefined) {
    fail(
      'INVALID_HEADER',
      `unsupported Doh spelling “${doh}”`,
      headerLocation()
    );
  }
  if (lah !== undefined && lah !== relativeMinorName(fifths)) {
    fail(
      'INVALID_HEADER',
      `Lah ${lah} does not match the relative minor ${relativeMinorName(fifths)} for Doh ${doh}`,
      headerLocation(),
      { expected: relativeMinorName(fifths), actual: lah }
    );
  }
  return { fifths, mode: lah === undefined ? 'major' : 'minor' };
}

function parseSyllablePitch(
  syllable: string,
  octaveMarks: string,
  key: ScoreKey,
  location: SolfaTextLocation
): string {
  const definition = SYLLABLE_TO_ALTERATION[syllable];
  if (!definition) {
    fail(
      'INVALID_SYNTAX',
      `unsupported Sol-fa syllable “${syllable}”`,
      location
    );
  }
  if (octaveMarks.includes("'") && octaveMarks.includes(',')) {
    fail(
      'INVALID_SYNTAX',
      'octave marks cannot mix apostrophes and commas',
      location
    );
  }
  const dohLetter = MAJOR_TONIC_BY_FIFTHS[key.fifths];
  if (!dohLetter)
    fail('INVALID_HEADER', 'unsupported key signature', headerLocation());
  const letter = letterAtOffset(dohLetter, definition.degree);
  const signatureAccidental = keySignatureAccidentals(key).get(letter) ?? '';
  const accidental = accidentalFromSemitones(
    accidentalSemitones(signatureAccidental) + definition.alteration
  );
  if (accidental === undefined) {
    fail(
      'UNSUPPORTED_STRUCTURE',
      `the spelling for ${syllable} in this key needs more than a double accidental`,
      location
    );
  }

  const dohOctave = nearestDohOctave(key);
  const octaveWrap = Math.floor(
    (LETTERS.indexOf(dohLetter) + definition.degree) / 7
  );
  const markShift = octaveMarks.startsWith("'")
    ? octaveMarks.length
    : octaveMarks.startsWith(',')
      ? -octaveMarks.length
      : 0;
  const octave = dohOctave + octaveWrap + markShift;
  return `${letter}${accidental}${octave}`;
}

function midiPitchClass(letter: string, accidental: string): number {
  const base = NATURAL_PITCH_CLASS[letter as (typeof LETTERS)[number]] ?? 0;
  return (base + accidentalSemitones(accidental) + 12) % 12;
}

function nearestDohOctave(key: ScoreKey): number {
  const tonicLetter = MAJOR_TONIC_BY_FIFTHS[key.fifths];
  if (!tonicLetter) throw new Error(`Unsupported key signature: ${key.fifths}`);
  const accidental = keySignatureAccidentals(key).get(tonicLetter) ?? '';
  const pitchClass = midiPitchClass(tonicLetter, accidental);
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
  return nearestOctave;
}

function parseCellToken(
  token: string,
  key: ScoreKey,
  location: SolfaTextLocation
): Cell {
  const value = token.trim();
  if (value === '' || value === '0') return { kind: 'rest' };
  if (value === '-') return { kind: 'hold' };
  const match = /^(di|ri|fi|si|li|ra|me|se|le|te|d|r|m|f|s|l|t)(['",]*)$/.exec(
    value
  );
  if (!match) {
    fail('INVALID_SYNTAX', `unsupported beat token “${value}”`, location);
  }
  return {
    kind: 'syllable',
    pitch: parseSyllablePitch(match[1]!, match[2] ?? '', key, location),
  };
}

function parseBeat(
  value: string,
  key: ScoreKey,
  location: SolfaTextLocation
): [Cell, Cell] {
  const dotCount = [...value].filter((char) => char === '.').length;
  if (dotCount > 1)
    fail(
      'INVALID_SYNTAX',
      'a beat may be split into only two half-beats',
      location
    );
  if (dotCount === 1) {
    const [left = '', right = ''] = value.split('.');
    return [
      parseCellToken(left, key, location),
      parseCellToken(right, key, location),
    ];
  }
  const first = parseCellToken(value, key, location);
  const second: Cell =
    first.kind === 'syllable' || first.kind === 'hold'
      ? { kind: 'hold' }
      : { kind: 'rest' };
  return [first, second];
}

function parsePartRow(
  id: PartId,
  payload: string,
  key: ScoreKey,
  time: { beats: number; beatType: number }
): ParsedPart {
  const rowLocation = { part: id, bar: 1, beat: 1 };
  if (!payload.includes('|')) {
    fail(
      'INVALID_SYNTAX',
      'part rows must use | to mark bar boundaries',
      rowLocation
    );
  }
  const pieces = payload.split('|');
  if (pieces[0]?.trim() === '') pieces.shift();
  if (pieces.at(-1)?.trim() === '') pieces.pop();
  if (pieces.length === 0)
    fail('INVALID_SYNTAX', 'part row has no bars', rowLocation);

  const bars: ParsedBar[] = [];
  for (const [barIndex, piece] of pieces.entries()) {
    const beatFields = piece.split(':');
    if (beatFields.length !== time.beats) {
      const location = {
        part: id,
        bar: barIndex + 1,
        beat:
          beatFields.length > time.beats
            ? time.beats + 1
            : beatFields.length + 1,
      };
      fail(
        'DURATION_MISMATCH',
        `bar duration expected ${time.beats} beats, got ${beatFields.length} beats`,
        location,
        { expected: time.beats, actual: beatFields.length }
      );
    }
    const cells: Cell[] = [];
    for (const [beatIndex, field] of beatFields.entries()) {
      cells.push(
        ...parseBeat(field, key, {
          part: id,
          bar: barIndex + 1,
          beat: beatIndex + 1,
        })
      );
    }
    bars.push({ cells });
  }
  return { id, bars };
}

function parseLyricTrack(
  text: string,
  verse: number,
  location: SolfaTextLocation
): ScoreLyric[] {
  const tokens = text.match(/[^\s-]+|-/g) ?? [];
  const groups: string[][] = [];
  let joinNext = false;
  for (const token of tokens) {
    if (token === '-') {
      if (groups.length === 0 || joinNext) {
        fail(
          'INVALID_SYNTAX',
          'a lyric hyphen must join two syllables',
          location
        );
      }
      joinNext = true;
      continue;
    }
    if (joinNext) {
      groups.at(-1)!.push(token);
      joinNext = false;
    } else {
      groups.push([token]);
    }
  }
  if (joinNext)
    fail('INVALID_SYNTAX', 'a lyric hyphen must join two syllables', location);

  const lyrics: ScoreLyric[] = [];
  for (const group of groups) {
    for (const [index, lyricText] of group.entries()) {
      const syllabic: ScoreLyric['syllabic'] =
        group.length === 1
          ? 'single'
          : index === 0
            ? 'begin'
            : index === group.length - 1
              ? 'end'
              : 'middle';
      lyrics.push({ text: lyricText, syllabic, verse });
    }
  }
  return lyrics;
}

function lyricNoteReferences(
  part: ScorePartInput,
  beatUnit: number
): NoteRef[] {
  const result: NoteRef[] = [];
  let prior: MutableNote | undefined;
  for (const [measureIndex, measure] of part.measures.entries()) {
    for (const noteInput of measure.notes ?? []) {
      const note = noteInput as MutableNote;
      const continuation = Boolean(
        prior?.tie && prior.pitch !== null && prior.pitch === note.pitch
      );
      if (note.pitch !== null && !continuation) {
        result.push({
          note,
          part: part.id as PartId,
          measureIndex,
          beat: Math.max(1, Math.floor((note.onset ?? 0) / beatUnit) + 1),
        });
      }
      prior = note;
    }
  }
  return result;
}

function attachLyrics(
  parts: ScorePartInput[],
  tracks: Map<number, ScoreLyric[]>,
  beatUnit: number
): void {
  for (const [verse, lyrics] of tracks) {
    for (const part of parts) {
      const events = lyricNoteReferences(part, beatUnit);
      if (lyrics.length !== events.length) {
        const missing = events[Math.min(lyrics.length, events.length - 1)];
        const location = missing
          ? { part: part.id, bar: missing.measureIndex + 1, beat: missing.beat }
          : { part: part.id, bar: Math.max(1, part.measures.length), beat: 1 };
        fail(
          'LYRIC_ALIGNMENT',
          `L${verse} has ${lyrics.length} syllables but ${part.id} has ${events.length} sung note onsets`,
          location,
          { expected: events.length, actual: lyrics.length }
        );
      }
      events.forEach(({ note }, index) => {
        const existing = note.lyrics ?? (note.lyric ? [note.lyric] : []);
        const item = lyrics[index]!;
        note.lyrics = [
          ...existing.filter((lyric) => lyric.verse !== verse),
          item,
        ].sort((left, right) => (left.verse ?? 1) - (right.verse ?? 1));
        note.lyric = note.lyrics[0];
      });
    }
  }
}

function parseHeaderKey(line: string): ScoreKey | undefined {
  const match =
    /^Doh\s+is\s+([A-G](?:#|b)?)(?:\s*·\s*Lah\s+is\s+([A-G](?:#|b)?))?$/i.exec(
      line
    );
  if (!match) return undefined;
  const doh = match[1]!;
  const lah = match[2];
  return keyFromHeader(doh, lah);
}

function isPartId(value: string): value is PartId {
  return (PART_IDS as readonly string[]).includes(value);
}

/** Parse the supported plain-text Sol-fa grammar into the shared ScoreModel. */
export function parseSolfaText(
  input: string,
  options: ParseSolfaTextOptions = {}
): ScoreModel {
  let key: ScoreKey | undefined;
  let time: { beats: number; beatType: number } | undefined;
  let tempo: number | undefined;
  let rowsStarted = false;
  const rawParts = new Map<PartId, string>();
  const rawTracks = new Map<number, string>();

  for (const rawLine of input.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const lineLocation = headerLocation();
    if (/^(Doh|Time|Tempo)\b/i.test(line)) {
      if (rowsStarted)
        fail(
          'INVALID_SYNTAX',
          'headers must appear before part and lyric rows',
          lineLocation
        );
      if (/^Doh\b/i.test(line)) {
        if (key)
          fail(
            'DUPLICATE_ROW',
            'Doh header appears more than once',
            headerLocation()
          );
        key = parseHeaderKey(line);
        if (!key)
          fail(
            'INVALID_HEADER',
            'expected “Doh is X” or “Doh is X · Lah is Y”',
            headerLocation()
          );
      } else if (/^Time\b/i.test(line)) {
        if (time)
          fail(
            'DUPLICATE_ROW',
            'Time header appears more than once',
            headerLocation()
          );
        const match = /^Time\s+(\d+)\/(\d+)$/i.exec(line);
        if (!match)
          fail(
            'INVALID_HEADER',
            'expected a meter such as “Time 4/4”',
            headerLocation()
          );
        time = { beats: Number(match[1]), beatType: Number(match[2]) };
        if (
          !Number.isSafeInteger(time.beats) ||
          time.beats < 1 ||
          !Number.isSafeInteger(time.beatType) ||
          time.beatType < 1
        ) {
          fail(
            'INVALID_HEADER',
            'meter values must be positive integers',
            headerLocation()
          );
        }
        if (time.beats * 2 > MAX_TEXT_SLOT_COUNT) {
          fail(
            'UNSUPPORTED_STRUCTURE',
            'meter is too large for the text grid',
            headerLocation(),
            { expected: MAX_TEXT_SLOT_COUNT / 2, actual: time.beats }
          );
        }
      } else {
        if (tempo !== undefined)
          fail(
            'DUPLICATE_ROW',
            'Tempo header appears more than once',
            headerLocation()
          );
        const match = /^Tempo\s+(\d+)$/i.exec(line);
        if (!match)
          fail(
            'INVALID_HEADER',
            'expected a whole-number tempo such as “Tempo 90”',
            headerLocation()
          );
        tempo = Number(match[1]);
        if (!Number.isInteger(tempo) || tempo < 20 || tempo > 300) {
          fail(
            'INVALID_HEADER',
            'tempo must be between 20 and 300 beats per minute',
            headerLocation(),
            { expected: '20–300', actual: tempo }
          );
        }
      }
      continue;
    }

    const lyricMatch = /^L(\d+)\s*:(.*)$/i.exec(line);
    if (lyricMatch) {
      rowsStarted = true;
      const verse = Number(lyricMatch[1]);
      if (!Number.isSafeInteger(verse) || verse < 1 || verse > 64) {
        fail(
          'INVALID_SYNTAX',
          'lyric track numbers must be between 1 and 64',
          lineLocation
        );
      }
      if (rawTracks.has(verse))
        fail('DUPLICATE_ROW', `L${verse} appears more than once`, lineLocation);
      rawTracks.set(verse, lyricMatch[2]!.trim());
      continue;
    }

    const partMatch = /^([SATB])\s*:(.*)$/.exec(line);
    if (partMatch) {
      rowsStarted = true;
      const partId = partMatch[1]!;
      if (!isPartId(partId))
        fail('INVALID_SYNTAX', `unsupported part row ${partId}`, lineLocation);
      if (rawParts.has(partId))
        fail('DUPLICATE_ROW', `${partId} appears more than once`, {
          part: partId,
          bar: 1,
          beat: 1,
        });
      rawParts.set(partId, partMatch[2]!.trim());
      continue;
    }
    if (/^[A-Za-z0-9]+\s*:/.test(line)) {
      fail(
        'INVALID_SYNTAX',
        `unsupported row “${line.split(':', 1)[0]}”`,
        lineLocation
      );
    }
    fail('INVALID_SYNTAX', `unrecognized line “${line}”`, lineLocation);
  }

  if (!key) fail('MISSING_HEADER', 'missing Doh/key header', headerLocation());
  if (!time)
    fail('MISSING_HEADER', 'missing Time meter header', headerLocation());
  if (tempo === undefined)
    fail('MISSING_HEADER', 'missing Tempo header', headerLocation());
  if (rawParts.size === 0)
    fail(
      'INVALID_SYNTAX',
      'at least one S, A, T, or B part row is required',
      headerLocation()
    );

  const parsedParts: ParsedPart[] = [];
  for (const id of PART_IDS) {
    const payload = rawParts.get(id);
    if (payload !== undefined)
      parsedParts.push(parsePartRow(id, payload, key, time));
  }
  const measureCounts = parsedParts.map((part) => part.bars.length);
  if (measureCounts.some((count) => count !== measureCounts[0])) {
    const partWithMismatch = parsedParts.find(
      (part) => part.bars.length !== measureCounts[0]
    )!;
    fail(
      'DURATION_MISMATCH',
      `part rows must have the same number of bars; expected ${measureCounts[0]}, got ${partWithMismatch.bars.length}`,
      {
        part: partWithMismatch.id,
        bar: Math.min(measureCounts[0]!, partWithMismatch.bars.length) + 1,
        beat: 1,
      },
      { expected: measureCounts[0]!, actual: partWithMismatch.bars.length }
    );
  }

  const parts: ScorePartInput[] = parsedParts.map((part) => {
    const measures: ScorePartInput['measures'] = [];
    let previousTailNote: MutableNote | undefined;
    let previousTailPitch: string | null = null;
    const halfBeat = 2 / time!.beatType;
    for (const [measureIndex, bar] of part.bars.entries()) {
      const notes: MutableNote[] = [];
      let active: MutableNote | undefined;
      let finalPitch: string | null = null;
      for (const [slotIndex, cell] of bar.cells.entries()) {
        const onset = slotIndex * halfBeat;
        if (cell.kind === 'syllable') {
          const note: MutableNote = {
            pitch: cell.pitch,
            dur: halfBeat,
            tie: false,
            voice: '1',
            staff: 1,
            chord: false,
            onset,
          };
          notes.push(note);
          active = note;
          finalPitch = cell.pitch;
        } else if (cell.kind === 'rest') {
          if (active?.pitch === null) {
            active.dur += halfBeat;
          } else {
            const note: MutableNote = {
              pitch: null,
              dur: halfBeat,
              tie: false,
              voice: '1',
              staff: 1,
              chord: false,
              onset,
            };
            notes.push(note);
            active = note;
          }
          finalPitch = null;
        } else if (slotIndex === 0) {
          if (!previousTailNote || previousTailPitch === null) {
            fail(
              'INVALID_HOLD',
              'a hold must continue a sung note from the previous beat or bar',
              {
                part: part.id,
                bar: measureIndex + 1,
                beat: 1,
              }
            );
          }
          previousTailNote.tie = true;
          const note: MutableNote = {
            pitch: previousTailPitch,
            dur: halfBeat,
            tie: false,
            voice: '1',
            staff: 1,
            chord: false,
            onset,
          };
          notes.push(note);
          active = note;
          finalPitch = previousTailPitch;
        } else {
          if (!active || active.pitch === null) {
            fail(
              'INVALID_HOLD',
              'a hold must immediately continue a sung note',
              {
                part: part.id,
                bar: measureIndex + 1,
                beat: Math.floor(slotIndex / 2) + 1,
              }
            );
          }
          active.dur += halfBeat;
          finalPitch = active.pitch;
        }
        if (active && active.dur > 64 + EPSILON) {
          fail(
            'UNSUPPORTED_STRUCTURE',
            'one note or rest exceeds the ScoreModel duration limit of 64 quarter notes',
            {
              part: part.id,
              bar: measureIndex + 1,
              beat: Math.floor(slotIndex / 2) + 1,
            },
            { expected: 64, actual: active.dur }
          );
        }
      }
      measures.push({ number: measureIndex + 1, notes });
      previousTailNote = notes.at(-1);
      previousTailPitch = finalPitch;
    }
    return { id: part.id, clef: PART_CLEF[part.id], measures };
  });

  for (const [verse, text] of rawTracks) {
    const lyrics = parseLyricTrack(text, verse, {
      part: parsedParts[0]!.id,
      bar: 1,
      beat: 1,
    });
    attachLyrics(parts, new Map([[verse, lyrics]]), 4 / time.beatType);
  }

  const modelInput: ScoreModelInput = {
    title: options.title?.trim() || 'Untitled score',
    key,
    time,
    tempo,
    parts,
  };
  const validated = scoreModelSchema.safeParse(modelInput);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    const path = issue?.path ?? [];
    const partIndex = typeof path[1] === 'number' ? path[1] : 0;
    const partId = parts[partIndex]?.id ?? 'Header';
    fail(
      'INVALID_SCORE_MODEL',
      issue?.message ?? 'score model validation failed',
      {
        part: partId,
        bar: 1,
        beat: 1,
      }
    );
  }
  return validated.data;
}

function parsePitch(
  pitch: string
): { letter: string; accidental: string; octave: number } | undefined {
  const match = /^([A-G])([#b]{0,2})(-?\d+)$/.exec(pitch);
  if (!match) return undefined;
  return {
    letter: match[1]!,
    accidental: match[2] ?? '',
    octave: Number(match[3]),
  };
}

function pitchToSyllable(
  pitch: string,
  key: ScoreKey,
  location: SolfaTextLocation
): string {
  const parsed = parsePitch(pitch);
  if (!parsed)
    fail('UNSUPPORTED_STRUCTURE', `invalid pitch ${pitch}`, location);
  const dohLetter = MAJOR_TONIC_BY_FIFTHS[key.fifths];
  if (!dohLetter)
    fail(
      'UNSUPPORTED_STRUCTURE',
      `unsupported key signature ${key.fifths}`,
      location
    );
  const expectedAccidental =
    keySignatureAccidentals(key).get(parsed.letter) ?? '';
  const difference =
    accidentalSemitones(parsed.accidental) -
    accidentalSemitones(expectedAccidental);
  const degree =
    (LETTERS.indexOf(parsed.letter as (typeof LETTERS)[number]) -
      LETTERS.indexOf(dohLetter) +
      7) %
    7;
  let syllable: string = DEGREE_SYLLABLES[degree]!;
  if (difference !== 0) {
    if (difference !== -1 && difference !== 1) {
      fail(
        'UNSUPPORTED_STRUCTURE',
        `pitch ${pitch} has an alteration not supported by the approved spelled-degree Sol-fa table`,
        location
      );
    }
    const chromatic = chromaticSolfaSyllable(
      DEGREE_SYLLABLES[degree]!,
      difference > 0 ? 'raised' : 'lowered'
    );
    if (!chromatic) {
      fail(
        'UNSUPPORTED_STRUCTURE',
        `pitch ${pitch} has no entry in the approved spelled-degree Sol-fa table; no enharmonic respelling was applied`,
        location
      );
    }
    syllable = chromatic;
  }

  const dohOctave = nearestDohOctave(key);
  const octaveDifference = Math.floor(
    (parsed.octave * 7 +
      LETTERS.indexOf(parsed.letter as (typeof LETTERS)[number]) -
      (dohOctave * 7 + LETTERS.indexOf(dohLetter))) /
      7
  );
  const marks =
    octaveDifference > 0
      ? "'".repeat(octaveDifference)
      : ','.repeat(Math.abs(octaveDifference));
  return `${syllable}${marks}`;
}

function sameKey(left: ScoreKey, right: ScoreKey): boolean {
  return left.fifths === right.fifths && left.mode === right.mode;
}

function noteLyrics(
  note: ScoreModel['parts'][number]['measures'][number]['notes'][number]
): ScoreLyric[] {
  if (note.lyrics?.length) return note.lyrics;
  return note.lyric ? [note.lyric] : [];
}

function getSyllableEvents(
  part: ScoreModel['parts'][number],
  partId: PartId,
  beatUnit: number,
  measureDuration: number
): Array<{
  note: ScoreModel['parts'][number]['measures'][number]['notes'][number];
  measureIndex: number;
  beat: number;
  start: number;
  end: number;
  continuation: boolean;
}> {
  const entries: Array<{
    note: ScoreModel['parts'][number]['measures'][number]['notes'][number];
    measureIndex: number;
    beat: number;
    start: number;
    end: number;
    continuation: boolean;
  }> = [];
  for (const [measureIndex, measure] of part.measures.entries()) {
    let cursor = 0;
    for (const note of measure.notes) {
      const onset = note.onset ?? cursor;
      const positionInMeasure = onset;
      const ref = {
        note,
        measureIndex,
        beat: Math.max(1, Math.floor(onset / beatUnit) + 1),
        start: positionInMeasure,
        end: positionInMeasure + note.dur,
        continuation: false,
      };
      entries.push(ref);
      cursor = onset + note.dur;
    }
  }
  // A tie always targets the next note in this one part, including across bars.
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index]!;
    const next = entries[index + 1];
    current.continuation = Boolean(
      index > 0 && entries[index - 1]!.note.tie && current.note.pitch !== null
    );
    if (current.note.tie) {
      const currentAbsoluteEnd =
        current.measureIndex * measureDuration + current.end;
      const nextAbsoluteStart = next
        ? next.measureIndex * measureDuration + next.start
        : Number.NaN;
      if (
        !next ||
        current.note.pitch === null ||
        next.note.pitch !== current.note.pitch ||
        Math.abs(nextAbsoluteStart - currentAbsoluteEnd) > EPSILON
      ) {
        fail(
          'UNSUPPORTED_STRUCTURE',
          'tie must connect contiguous notes of the same pitch',
          { part: partId, bar: current.measureIndex + 1, beat: current.beat }
        );
      }
    }
  }
  return entries;
}

function lyricVerseMap(
  entries: ReturnType<typeof getSyllableEvents>,
  partId: PartId
): Map<number, Array<ScoreLyric | undefined>> {
  const verses = new Map<number, Array<ScoreLyric | undefined>>();
  const sung = entries.filter(
    (entry) => entry.note.pitch !== null && !entry.continuation
  );
  for (const entry of entries) {
    const lyrics = noteLyrics(entry.note);
    if ((entry.note.pitch === null || entry.continuation) && lyrics.length) {
      fail(
        'UNSUPPORTED_STRUCTURE',
        'lyrics on rests or tied continuation notes cannot be represented',
        {
          part: partId,
          bar: entry.measureIndex + 1,
          beat: entry.beat,
        }
      );
    }
    if (entry.note.pitch === null || entry.continuation) continue;
    const seen = new Set<number>();
    lyrics.forEach((lyric, lyricIndex) => {
      const verse = lyric.verse ?? lyricIndex + 1;
      if (verse < 1 || verse > 64 || seen.has(verse)) {
        fail(
          'UNSUPPORTED_STRUCTURE',
          `invalid or repeated lyric verse ${verse}`,
          {
            part: partId,
            bar: entry.measureIndex + 1,
            beat: entry.beat,
          }
        );
      }
      seen.add(verse);
      const values =
        verses.get(verse) ??
        Array.from({ length: sung.length }, () => undefined);
      values[sung.indexOf(entry)] = lyric;
      verses.set(verse, values);
    });
  }
  return verses;
}

function canonicalLyricText(
  lyrics: Array<ScoreLyric | undefined>,
  verse: number,
  location: SolfaTextLocation
): string {
  let output = '';
  let inWord = false;
  for (const lyric of lyrics) {
    if (!lyric)
      fail('LYRIC_ALIGNMENT', `L${verse} is missing a syllable`, location);
    const text = lyric.text;
    if (!text || /[\s-]/.test(text)) {
      fail(
        'UNSUPPORTED_STRUCTURE',
        `lyric syllable “${text}” contains whitespace or a reserved hyphen`,
        location
      );
    }
    const type = lyric.syllabic ?? 'single';
    if (type === 'begin') {
      if (inWord)
        fail(
          'UNSUPPORTED_STRUCTURE',
          'invalid lyric syllabic sequence',
          location
        );
      output += `${output ? ' ' : ''}${text}`;
      inWord = true;
    } else if (type === 'middle') {
      if (!inWord)
        fail(
          'UNSUPPORTED_STRUCTURE',
          'lyric middle syllable has no begin syllable',
          location
        );
      output += `-${text}`;
    } else if (type === 'end') {
      if (!inWord)
        fail(
          'UNSUPPORTED_STRUCTURE',
          'lyric end syllable has no begin syllable',
          location
        );
      output += `-${text}`;
      inWord = false;
    } else {
      if (inWord)
        fail(
          'UNSUPPORTED_STRUCTURE',
          'lyric word is missing its end syllable',
          location
        );
      output += `${output ? ' ' : ''}${text}`;
    }
  }
  if (inWord)
    fail(
      'UNSUPPORTED_STRUCTURE',
      'lyric word is missing its end syllable',
      location
    );
  return output;
}

type SerializedSlot = {
  token: string;
  group: number;
  kind: 'syllable' | 'hold' | 'rest';
};

function modelToSolfaTextValidated(model: ScoreModel): string {
  if (model.key.mode !== 'major' && model.key.mode !== 'minor') {
    fail(
      'UNSUPPORTED_STRUCTURE',
      `key mode ${model.key.mode} has no header form in this grammar`,
      headerLocation()
    );
  }
  const doh = spelledKeyTonic(model.key.fifths);
  const header = [
    `Doh is ${doh}${model.key.mode === 'minor' ? ` · Lah is ${relativeMinorName(model.key.fifths)}` : ''}`,
    `Time ${model.time.beats}/${model.time.beatType}`,
    `Tempo ${model.tempo}`,
  ];
  const orderedParts = [...model.parts].sort(
    (left, right) =>
      PART_IDS.indexOf(left.id as PartId) - PART_IDS.indexOf(right.id as PartId)
  );
  if (orderedParts.some((part) => !isPartId(part.id))) {
    const invalid = orderedParts.find((part) => !isPartId(part.id))!;
    fail(
      'UNSUPPORTED_STRUCTURE',
      `part ${invalid.id} has no row in the SATB grammar`,
      {
        part: invalid.id,
        bar: 1,
        beat: 1,
      }
    );
  }
  if (
    new Set(orderedParts.map((part) => part.id)).size !== orderedParts.length
  ) {
    fail('UNSUPPORTED_STRUCTURE', 'part IDs must be unique', headerLocation());
  }
  const barCounts = orderedParts.map((part) => part.measures.length);
  if (barCounts.some((count) => count !== barCounts[0])) {
    const bad = orderedParts.find(
      (part) => part.measures.length !== barCounts[0]
    )!;
    fail(
      'UNSUPPORTED_STRUCTURE',
      'all SATB rows must have the same number of bars',
      {
        part: bad.id,
        bar: Math.min(barCounts[0]!, bad.measures.length) + 1,
        beat: 1,
      },
      { expected: barCounts[0]!, actual: bad.measures.length }
    );
  }

  const beatUnit = 4 / model.time.beatType;
  const halfBeat = beatUnit / 2;
  const slotCount = model.time.beats * 2;
  if (!Number.isSafeInteger(slotCount) || slotCount > MAX_TEXT_SLOT_COUNT) {
    fail(
      'UNSUPPORTED_STRUCTURE',
      'meter is too large for the text grid',
      headerLocation(),
      {
        expected: MAX_TEXT_SLOT_COUNT,
        actual: slotCount,
      }
    );
  }
  const serializedRows: string[] = [];
  const allEntries = new Map<PartId, ReturnType<typeof getSyllableEvents>>();
  const allLyrics = new Map<
    PartId,
    Map<number, Array<ScoreLyric | undefined>>
  >();
  let groupCounter = 0;

  for (const part of orderedParts) {
    const partId = part.id as PartId;
    if (part.clef !== PART_CLEF[partId]) {
      fail(
        'UNSUPPORTED_STRUCTURE',
        `clef ${part.clef} cannot be represented for ${partId}`,
        {
          part: partId,
          bar: 1,
          beat: 1,
        }
      );
    }
    const entries = getSyllableEvents(
      part,
      partId,
      beatUnit,
      model.time.beats * beatUnit
    );
    allEntries.set(partId, entries);
    allLyrics.set(partId, lyricVerseMap(entries, partId));
    const continuationNotes = new Set(
      entries.filter((entry) => entry.continuation).map((entry) => entry.note)
    );
    const groupByNote = new Map<
      ScoreModel['parts'][number]['measures'][number]['notes'][number],
      number
    >();
    let priorPitchedEntry: (typeof entries)[number] | undefined;
    for (const entry of entries) {
      if (entry.note.pitch === null) continue;
      const group =
        entry.continuation && priorPitchedEntry
          ? groupByNote.get(priorPitchedEntry.note)!
          : ++groupCounter;
      groupByNote.set(entry.note, group);
      priorPitchedEntry = entry;
    }
    const partBars: string[] = [];
    for (const [measureIndex, measure] of part.measures.entries()) {
      const location = { part: partId, bar: measureIndex + 1, beat: 1 };
      if (measure.number !== measureIndex + 1) {
        fail(
          'UNSUPPORTED_STRUCTURE',
          'bar numbers must be sequential from 1',
          location,
          {
            expected: measureIndex + 1,
            actual: measure.number,
          }
        );
      }
      if (measure.key && !sameKey(measure.key, model.key)) {
        fail(
          'UNSUPPORTED_STRUCTURE',
          'mid-score key changes are not supported by this text grammar',
          location
        );
      }
      const slots: Array<SerializedSlot | undefined> = Array.from({
        length: slotCount,
      });
      let cursor = 0;
      let lastRestGroup: number | undefined;
      for (const note of measure.notes) {
        if (
          note.voice !== '1' ||
          note.staff !== 1 ||
          note.chord ||
          note.tuplet
        ) {
          fail(
            'UNSUPPORTED_STRUCTURE',
            'multiple voices, additional staves, chords, and tuplets are not representable',
            {
              part: partId,
              bar: measureIndex + 1,
              beat: Math.max(1, Math.floor(cursor / beatUnit) + 1),
            }
          );
        }
        const onset = note.onset ?? cursor;
        const onsetSlot = Math.round(onset / halfBeat);
        const durationSlots = Math.round(note.dur / halfBeat);
        const locationAtNote = {
          part: partId,
          bar: measureIndex + 1,
          beat: Math.max(1, Math.floor(onset / beatUnit) + 1),
        };
        if (Math.abs(onset / halfBeat - onsetSlot) > EPSILON) {
          fail(
            'UNSUPPORTED_STRUCTURE',
            'note onset is finer than a half-beat',
            locationAtNote,
            {
              expected: halfBeat,
              actual: onset,
            }
          );
        }
        if (Math.abs(note.dur / halfBeat - durationSlots) > EPSILON) {
          fail(
            'UNSUPPORTED_STRUCTURE',
            'note duration is finer than a half-beat',
            locationAtNote,
            {
              expected: halfBeat,
              actual: note.dur,
            }
          );
        }
        if (Math.abs(onsetSlot - cursor / halfBeat) > EPSILON) {
          fail(
            'DURATION_MISMATCH',
            'notes must be ordered and contiguous within the bar',
            locationAtNote,
            {
              expected: cursor,
              actual: onset,
            }
          );
        }
        if (durationSlots < 1 || onsetSlot + durationSlots > slotCount) {
          fail(
            'DURATION_MISMATCH',
            'note extends outside the bar',
            locationAtNote,
            {
              expected: slotCount,
              actual: onsetSlot + durationSlots,
            }
          );
        }
        let group: number;
        let kind: SerializedSlot['kind'];
        let token: string;
        if (note.pitch === null) {
          kind = 'rest';
          token = '0';
          group = lastRestGroup ?? ++groupCounter;
          lastRestGroup = group;
        } else {
          lastRestGroup = undefined;
          const continuation = continuationNotes.has(note);
          kind = continuation ? 'hold' : 'syllable';
          group = groupByNote.get(note)!;
          token = continuation
            ? '-'
            : pitchToSyllable(note.pitch, model.key, locationAtNote);
        }
        for (let offset = 0; offset < durationSlots; offset += 1) {
          const slotKind: SerializedSlot['kind'] =
            note.pitch === null ? 'rest' : offset === 0 ? kind : 'hold';
          slots[onsetSlot + offset] = {
            token:
              slotKind === 'rest' ? '0' : slotKind === 'hold' ? '-' : token,
            group,
            kind: slotKind,
          };
        }
        cursor += note.dur;
      }
      const expectedDuration = model.time.beats * beatUnit;
      if (Math.abs(cursor - expectedDuration) > EPSILON) {
        const actualBeats = cursor / beatUnit;
        fail(
          'DURATION_MISMATCH',
          `bar duration expected ${model.time.beats} beats, got ${actualBeats} beats`,
          {
            part: partId,
            bar: measureIndex + 1,
            beat: Math.min(model.time.beats, Math.floor(actualBeats) + 1),
          },
          { expected: model.time.beats, actual: actualBeats }
        );
      }
      const beatTexts: string[] = [];
      for (let beat = 0; beat < model.time.beats; beat += 1) {
        const first = slots[beat * 2]!;
        const second = slots[beat * 2 + 1]!;
        beatTexts.push(
          first.group === second.group
            ? first.token
            : `${first.token}.${second.token}`
        );
      }
      partBars.push(beatTexts.join(' : '));
    }
    serializedRows.push(`${partId}: | ${partBars.join(' | ')} |`);
  }

  const verseNumbers = [
    ...new Set([...allLyrics.values()].flatMap((verses) => [...verses.keys()])),
  ].sort((left, right) => left - right);
  const lyricRows: string[] = [];
  for (const verse of verseNumbers) {
    const missingTrack = orderedParts.find(
      (part) => !allLyrics.get(part.id as PartId)!.has(verse)
    );
    if (missingTrack) {
      fail(
        'LYRIC_ALIGNMENT',
        `L${verse} must be present on every SATB row`,
        {
          part: missingTrack.id,
          bar: 1,
          beat: 1,
        },
        { expected: orderedParts.length, actual: orderedParts.length - 1 }
      );
    }
    let reference: Array<ScoreLyric | undefined> | undefined;
    let referencePart: PartId | undefined;
    for (const part of orderedParts) {
      const partId = part.id as PartId;
      const verses = allLyrics.get(partId)!;
      const lyrics = verses.get(verse);
      const entries = allEntries.get(partId)!;
      const eventCount = entries.filter(
        (entry) => entry.note.pitch !== null && !entry.continuation
      ).length;
      if (!lyrics) continue;
      if (lyrics.length !== eventCount || lyrics.some((lyric) => !lyric)) {
        const firstMissing = lyrics.findIndex((lyric) => !lyric);
        const event = entries.filter(
          (entry) => entry.note.pitch !== null && !entry.continuation
        )[Math.max(0, firstMissing)];
        fail(
          'LYRIC_ALIGNMENT',
          `L${verse} must supply one lyric syllable for each sung note`,
          {
            part: partId,
            bar: event ? event.measureIndex + 1 : 1,
            beat: event?.beat ?? 1,
          },
          { expected: eventCount, actual: lyrics.filter(Boolean).length }
        );
      }
      if (!reference) {
        reference = lyrics;
        referencePart = partId;
      } else if (JSON.stringify(lyrics) !== JSON.stringify(reference)) {
        fail(
          'LYRIC_ALIGNMENT',
          `L${verse} must be identical and aligned across SATB rows`,
          {
            part: partId,
            bar: 1,
            beat: 1,
          },
          {
            expected: `${referencePart} lyric track`,
            actual: `${partId} lyric track`,
          }
        );
      }
    }
    if (reference) {
      const firstPart = orderedParts[0]!.id as PartId;
      const events = allEntries
        .get(firstPart)!
        .filter((entry) => entry.note.pitch !== null && !entry.continuation);
      lyricRows.push(
        `L${verse}: ${canonicalLyricText(reference, verse, {
          part: firstPart,
          bar: events[0]?.measureIndex + 1 || 1,
          beat: events[0]?.beat ?? 1,
        })}`
      );
    }
  }

  return [
    ...header,
    '',
    ...serializedRows,
    ...(lyricRows.length ? ['', ...lyricRows] : []),
  ].join('\n');
}

/** Serialize a representable ScoreModel to canonical Sol-fa text. */
export function modelToSolfaText(modelInput: ScoreModel): string {
  const parsed = scoreModelSchema.safeParse(modelInput);
  if (!parsed.success) {
    fail(
      'INVALID_SCORE_MODEL',
      parsed.error.issues[0]?.message ?? 'invalid score model',
      headerLocation()
    );
  }
  return modelToSolfaTextValidated(parsed.data);
}

/** Alias for callers that prefer an explicit serialization verb. */
export const serializeSolfaText = modelToSolfaText;
/** Alias for callers that prefer source-format-first naming. */
export const solfaTextToModel = parseSolfaText;
