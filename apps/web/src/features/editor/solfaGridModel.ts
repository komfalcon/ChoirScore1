import {
  modelToSolfaText,
  parseSolfaText,
  scoreModelSchema,
  type ScoreModel,
  type ScoreNote,
  type ScorePart,
  type ScoreLyric,
} from '@choirscore/shared';

export type SolfaGridSelection = {
  partId: string;
  /** Zero-based bar position in the part; the score's displayed bar number is also checked. */
  barIndex: number;
  barNumber: number;
  /** One-based beat and zero-based half-beat subdivision within that bar. */
  beat: number;
  subdivision: 0 | 1;
  /** Disambiguates overlapping/chord cells without treating eventId as persistent. */
  cellOrdinal: number;
};

export type SolfaGridAccidental =
  'natural' | 'sharp' | 'flat' | 'double-sharp' | 'double-flat';

export type SolfaGridSyllable =
  | 'd'
  | 'di'
  | 'r'
  | 'ri'
  | 'ra'
  | 'm'
  | 'me'
  | 'f'
  | 'fi'
  | 's'
  | 'si'
  | 'se'
  | 'l'
  | 'li'
  | 'le'
  | 't'
  | 'te';

type NoteLocation = {
  partId: string;
  note: ScoreNote;
  measureIndex: number;
  noteIndex: number;
  globalIndex: number;
};

const ACCIDENTAL_SUFFIX: Record<SolfaGridAccidental, string> = {
  natural: '',
  sharp: '#',
  flat: 'b',
  'double-sharp': '##',
  'double-flat': 'bb',
};
const EPSILON = 0.000001;

/**
 * Validate a proposed edit against both the shared schema and the exact codec
 * grammar. Round-trip parity is checked before a model is returned to the UI.
 */
export function validateSolfaGridModel(candidate: unknown): ScoreModel {
  const model = scoreModelSchema.parse(candidate);
  const canonical = modelToSolfaText(model);
  const decoded = parseSolfaText(canonical, { title: model.title });
  if (modelToSolfaText(decoded) !== canonical) {
    throw new Error('The edit does not preserve canonical Sol-fa text.');
  }
  return model;
}

function partFor(model: ScoreModel, partId: string): ScorePart {
  const part = model.parts.find((candidate) => candidate.id === partId);
  if (!part) throw new Error(`Part ${partId} is not in this score.`);
  return part;
}

function locationsFor(part: ScorePart): NoteLocation[] {
  const locations: NoteLocation[] = [];
  for (const [measureIndex, measure] of part.measures.entries()) {
    for (const [noteIndex, note] of measure.notes.entries()) {
      locations.push({
        partId: part.id,
        measureIndex,
        noteIndex,
        note,
        globalIndex: locations.length,
      });
    }
  }
  return locations;
}

function cellCoordinatesForMeasure(
  model: ScoreModel,
  measure: ScorePart['measures'][number]
): Array<
  Pick<SolfaGridSelection, 'barNumber' | 'beat' | 'subdivision' | 'cellOrdinal'>
> {
  const halfBeat = 2 / model.time.beatType;
  const countsBySlot = new Map<number, number>();
  let cursor = 0;
  let previousOnset = 0;
  return measure.notes.map((note) => {
    const onset = note.onset ?? (note.chord ? previousOnset : cursor);
    if (!note.chord) {
      previousOnset = onset;
      cursor = onset + note.dur;
    }
    const slot = Math.round(onset / halfBeat);
    const beat = Math.floor(slot / 2) + 1;
    const subdivision = (slot % 2) as 0 | 1;
    const cellOrdinal = countsBySlot.get(slot) ?? 0;
    countsBySlot.set(slot, cellOrdinal + 1);
    return { barNumber: measure.number, beat, subdivision, cellOrdinal };
  });
}

/** Create a positional cell address from a model note; no codec eventId is persisted. */
export function solfaGridSelectionForNote(
  model: ScoreModel,
  partId: string,
  barIndex: number,
  noteIndex: number
): SolfaGridSelection {
  const part = partFor(model, partId);
  const measure = part.measures[barIndex];
  if (!measure) throw new Error('The selected bar is not in this score.');
  const coordinates = cellCoordinatesForMeasure(model, measure)[noteIndex];
  if (!coordinates) throw new Error('The selected cell is not in this bar.');
  return { partId, barIndex, ...coordinates };
}

function selectedLocation(
  model: ScoreModel,
  selection: SolfaGridSelection
): NoteLocation {
  const part = partFor(model, selection.partId);
  const measure = part.measures[selection.barIndex];
  if (!measure || measure.number !== selection.barNumber) {
    throw new Error('The selected bar is no longer in this score.');
  }
  const coordinates = cellCoordinatesForMeasure(model, measure);
  const noteIndex = coordinates.findIndex(
    (item) =>
      item.beat === selection.beat &&
      item.subdivision === selection.subdivision &&
      item.cellOrdinal === selection.cellOrdinal
  );
  const location = locationsFor(part).find(
    (item) =>
      item.measureIndex === selection.barIndex && item.noteIndex === noteIndex
  );
  if (!location) throw new Error('Select a note cell before editing.');
  return location;
}

function updateNotes(
  model: ScoreModel,
  partId: string,
  updates: ReadonlyMap<number, (note: ScoreNote) => ScoreNote>
): ScoreModel {
  let globalIndex = 0;
  const parts = model.parts.map((part) => {
    if (part.id !== partId) return part;
    return {
      ...part,
      measures: part.measures.map((measure) => ({
        ...measure,
        notes: measure.notes.map((note) => {
          const update = updates.get(globalIndex++);
          return update ? update(note) : note;
        }),
      })),
    };
  });
  return { ...model, parts };
}

function clearLyrics(note: ScoreNote): ScoreNote {
  const { lyric: _lyric, lyrics: _lyrics, ...withoutLyrics } = note;
  return withoutLyrics;
}

function noteWithLyrics(note: ScoreNote, lyrics: ScoreLyric[]): ScoreNote {
  const { lyric: _lyric, lyrics: _oldLyrics, ...withoutLyrics } = note;
  const ordered = [...lyrics].sort(
    (left, right) => (left.verse ?? 1) - (right.verse ?? 1)
  );
  if (ordered.length === 0) return withoutLyrics;
  return { ...withoutLyrics, lyric: ordered[0], lyrics: ordered };
}

function syllablePitch(
  model: ScoreModel,
  syllable: SolfaGridSyllable,
  octaveShift: number
): string {
  // Let the codec resolve scale spelling, key signature and octave reference.
  const header = modelToSolfaText(model).split('\n').slice(0, 3);
  const beats = Array.from({ length: model.time.beats }, (_, index) =>
    index === 0
      ? `${syllable}${octaveShift > 0 ? "'".repeat(octaveShift) : ','.repeat(Math.abs(octaveShift))}`
      : '0'
  );
  const oneCell = parseSolfaText(
    [...header, `S: | ${beats.join(' : ')} |`].join('\n'),
    { title: model.title }
  );
  const pitch = oneCell.parts[0]?.measures[0]?.notes.find(
    (note) => note.pitch !== null
  )?.pitch;
  if (!pitch) throw new Error(`Could not resolve Sol-fa syllable ${syllable}.`);
  return pitch;
}

function replaceTiedPitch(
  model: ScoreModel,
  location: NoteLocation,
  pitch: string
): ScoreModel {
  const locations = locationsFor(partFor(model, location.partId));
  let first = location.globalIndex;
  while (
    first > 0 &&
    locations[first - 1]!.note.tie &&
    locations[first - 1]!.note.pitch === locations[first]!.note.pitch
  )
    first -= 1;
  let last = location.globalIndex;
  while (
    last < locations.length - 1 &&
    locations[last]!.note.tie &&
    locations[last]!.note.pitch === locations[last + 1]!.note.pitch
  )
    last += 1;
  const updates = new Map<number, (note: ScoreNote) => ScoreNote>();
  for (let index = first; index <= last; index += 1) {
    updates.set(index, (note) => ({ ...note, pitch }));
  }
  return updateNotes(model, location.partId, updates);
}

export function setSolfaPitch(
  model: ScoreModel,
  selection: SolfaGridSelection,
  syllable: SolfaGridSyllable,
  octaveShift = 0
): ScoreModel {
  if (!Number.isInteger(octaveShift) || Math.abs(octaveShift) > 4) {
    throw new Error(
      'Choose an octave shift between four octaves below and above.'
    );
  }
  const location = selectedLocation(model, selection);
  const pitch = syllablePitch(model, syllable, octaveShift);
  return validateSolfaGridModel(replaceTiedPitch(model, location, pitch));
}

export function applyAccidental(
  model: ScoreModel,
  selection: SolfaGridSelection,
  accidental: SolfaGridAccidental
): ScoreModel {
  const location = selectedLocation(model, selection);
  if (!location.note.pitch)
    throw new Error('Rests do not have accidentals. Set a note pitch first.');
  const match = /^([A-G])(?:#{1,2}|b{1,2})?(-?\d+)$/.exec(location.note.pitch);
  if (!match)
    throw new Error(`Unsupported pitch spelling ${location.note.pitch}.`);
  const pitch = `${match[1]}${ACCIDENTAL_SUFFIX[accidental]}${match[2]}`;
  return validateSolfaGridModel(replaceTiedPitch(model, location, pitch));
}

export function shiftOctave(
  model: ScoreModel,
  selection: SolfaGridSelection,
  amount: -1 | 1
): ScoreModel {
  const location = selectedLocation(model, selection);
  if (!location.note.pitch)
    throw new Error('Rests do not have an octave. Set a note pitch first.');
  const match = /^([A-G](?:#{1,2}|b{1,2})?)(-?\d+)$/.exec(location.note.pitch);
  if (!match)
    throw new Error(`Unsupported pitch spelling ${location.note.pitch}.`);
  const pitch = `${match[1]}${Number(match[2]) + amount}`;
  return validateSolfaGridModel(replaceTiedPitch(model, location, pitch));
}

function reflow(notes: ScoreNote[]): ScoreNote[] {
  let onset = 0;
  return notes.map((note) => {
    const next = { ...note, onset };
    onset += note.dur;
    return next;
  });
}

export function setNoteDuration(
  model: ScoreModel,
  selection: SolfaGridSelection,
  duration: number
): ScoreModel {
  const location = selectedLocation(model, selection);
  const measure = partFor(model, selection.partId).measures[
    location.measureIndex
  ]!;
  const halfBeat = 2 / model.time.beatType;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 64 ||
    Math.abs(duration / halfBeat - Math.round(duration / halfBeat)) > EPSILON
  ) {
    throw new Error(
      `Choose a duration in half-beat increments (minimum ${halfBeat} quarter-note units).`
    );
  }
  const delta = duration - location.note.dur;
  if (Math.abs(delta) < EPSILON) return model;
  const notes = [...measure.notes];
  const neighborIndex =
    location.noteIndex + 1 < notes.length
      ? location.noteIndex + 1
      : location.noteIndex - 1;
  if (neighborIndex < 0) {
    if (delta > 0)
      throw new Error('The note cannot be longer than the remaining bar.');
    const rest = clearLyrics({
      ...location.note,
      pitch: null,
      dur: -delta,
      tie: false,
    });
    notes[location.noteIndex] = {
      ...location.note,
      dur: duration,
      tie: false,
    };
    notes.push(rest);
  } else {
    const neighbor = notes[neighborIndex]!;
    const nextNeighborDuration = neighbor.dur - delta;
    if (nextNeighborDuration < halfBeat - EPSILON) {
      throw new Error(
        'The adjacent event is too short to rebalance this duration.'
      );
    }
    notes[location.noteIndex] = { ...location.note, dur: duration };
    notes[neighborIndex] = { ...neighbor, dur: nextNeighborDuration };
  }
  const parts = model.parts.map((part) =>
    part.id !== selection.partId
      ? part
      : {
          ...part,
          measures: part.measures.map((item, index) =>
            index !== location.measureIndex
              ? item
              : {
                  ...item,
                  notes: reflow(notes),
                }
          ),
        }
  );
  return validateSolfaGridModel({ ...model, parts });
}

export function setRest(
  model: ScoreModel,
  selection: SolfaGridSelection
): ScoreModel {
  const part = partFor(model, selection.partId);
  const locations = locationsFor(part);
  const location = selectedLocation(model, selection);
  const updates = new Map<number, (note: ScoreNote) => ScoreNote>();
  if (location.globalIndex > 0) {
    const previous = locations[location.globalIndex - 1]!;
    if (previous.note.tie)
      updates.set(previous.globalIndex, (note) => ({ ...note, tie: false }));
  }
  updates.set(location.globalIndex, (note) => ({
    ...clearLyrics(note),
    pitch: null,
    tie: false,
  }));
  return validateSolfaGridModel(updateNotes(model, selection.partId, updates));
}

export function toggleHoldToNext(
  model: ScoreModel,
  selection: SolfaGridSelection
): ScoreModel {
  const location = selectedLocation(model, selection);
  const locations = locationsFor(partFor(model, selection.partId));
  const current = location.note;
  const updates = new Map<number, (note: ScoreNote) => ScoreNote>();
  if (current.tie) {
    updates.set(location.globalIndex, (note) => ({ ...note, tie: false }));
  } else {
    const previous = locations[location.globalIndex - 1];
    if (previous?.note.tie && previous.note.pitch === current.pitch) {
      updates.set(previous.globalIndex, (note) => ({ ...note, tie: false }));
    } else {
      const next = locations[location.globalIndex + 1];
      if (!current.pitch)
        throw new Error('A rest cannot hold a pitch. Set a note first.');
      if (!next)
        throw new Error('A hold needs a following event in this score.');
      updates.set(location.globalIndex, (note) => ({ ...note, tie: true }));
      updates.set(next.globalIndex, (note) => ({
        ...clearLyrics(note),
        pitch: current.pitch,
      }));
    }
  }
  return validateSolfaGridModel(updateNotes(model, selection.partId, updates));
}

export function deleteGridEvent(
  model: ScoreModel,
  selection: SolfaGridSelection
): ScoreModel {
  const part = partFor(model, selection.partId);
  const location = selectedLocation(model, selection);
  const locations = locationsFor(part);
  const measure = part.measures[location.measureIndex]!;
  const notes = [...measure.notes];
  const removed = notes.splice(location.noteIndex, 1)[0]!;
  const updates = new Map<number, (note: ScoreNote) => ScoreNote>();
  if (location.globalIndex > 0) {
    const previous = locations[location.globalIndex - 1]!;
    if (previous.note.tie)
      updates.set(previous.globalIndex, (note) => ({ ...note, tie: false }));
  }
  const rest = clearLyrics({ ...removed, pitch: null, tie: false });
  notes.push(rest);
  const changedPart: ScorePart = {
    ...part,
    measures: part.measures.map((item, index) =>
      index !== location.measureIndex
        ? item
        : {
            ...item,
            notes: reflow(notes),
          }
    ),
  };
  const parts = model.parts.map((candidate) =>
    candidate.id === part.id ? changedPart : candidate
  );
  const withRemovedEvent = updateNotes({ ...model, parts }, part.id, updates);
  return validateSolfaGridModel(withRemovedEvent);
}

function sungNoteGlobalIndexes(part: ScorePart): number[] {
  const locations = locationsFor(part);
  return locations.flatMap((location, index) => {
    if (location.note.pitch === null) return [];
    const previous = locations[index - 1];
    const isContinuation = Boolean(
      previous?.note.tie && previous.note.pitch === location.note.pitch
    );
    return isContinuation ? [] : [location.globalIndex];
  });
}

function lyricsOf(note: ScoreNote) {
  return note.lyrics?.length
    ? [...note.lyrics]
    : note.lyric
      ? [note.lyric]
      : [];
}

function updateSharedLyric(
  model: ScoreModel,
  selection: SolfaGridSelection,
  verse: number,
  text: string | null
): ScoreModel {
  if (!Number.isInteger(verse) || verse < 1 || verse > 64) {
    throw new Error('Choose a lyric verse from 1 to 64.');
  }
  const selected = selectedLocation(model, selection);
  if (text === null) {
    let candidate = model;
    for (const part of model.parts) {
      const updates = new Map<number, (note: ScoreNote) => ScoreNote>();
      for (const location of locationsFor(part)) {
        const existing = lyricsOf(location.note);
        const remaining = existing.filter((lyric) => lyric.verse !== verse);
        if (remaining.length !== existing.length) {
          updates.set(location.globalIndex, (note) =>
            noteWithLyrics(note, remaining)
          );
        }
      }
      candidate = updateNotes(candidate, part.id, updates);
    }
    return validateSolfaGridModel(candidate);
  }
  const sourceSungIndexes = sungNoteGlobalIndexes(
    partFor(model, selection.partId)
  );
  const ordinal = sourceSungIndexes.indexOf(selected.globalIndex);
  if (ordinal < 0)
    throw new Error(
      'Lyrics attach only to sung note onsets, not rests or holds.'
    );
  const verseExists = model.parts.some((part) =>
    locationsFor(part).some((location) =>
      lyricsOf(location.note).some((lyric) => lyric.verse === verse)
    )
  );
  const updatesByPart = new Map<
    string,
    Map<number, (note: ScoreNote) => ScoreNote>
  >();
  for (const part of model.parts) {
    const sungIndexes = sungNoteGlobalIndexes(part);
    if (!verseExists && sungIndexes.length !== 1) {
      throw new Error(
        'The codec requires a lyric for every sung onset in a verse. This control can add a new verse only when the score has one sung onset; otherwise edit an existing complete verse track.'
      );
    }
    const targetIndex = sungIndexes[ordinal];
    if (targetIndex === undefined) {
      throw new Error(
        'The codec requires the same lyric syllables across every part.'
      );
    }
    const note = locationsFor(part)[targetIndex]!.note;
    const lyrics = lyricsOf(note).filter((lyric) => lyric.verse !== verse);
    lyrics.push({ text, syllabic: 'single', verse });
    const partUpdates =
      updatesByPart.get(part.id) ??
      new Map<number, (note: ScoreNote) => ScoreNote>();
    partUpdates.set(targetIndex, (current) => noteWithLyrics(current, lyrics));
    updatesByPart.set(part.id, partUpdates);
  }
  let candidate = model;
  for (const [partId, updates] of updatesByPart) {
    candidate = updateNotes(candidate, partId, updates);
  }
  return validateSolfaGridModel(candidate);
}

export function setGridLyric(
  model: ScoreModel,
  selection: SolfaGridSelection,
  verse: number,
  text: string
): ScoreModel {
  return updateSharedLyric(model, selection, verse, text);
}

export function removeGridLyric(
  model: ScoreModel,
  selection: SolfaGridSelection,
  verse: number
): ScoreModel {
  return updateSharedLyric(model, selection, verse, null);
}
