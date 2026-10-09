import { describe, expect, it } from 'vitest';
import {
  modelToSolfaText,
  parseSolfaText,
  type ScoreModel,
} from '@choirscore/shared';
import {
  applyAccidental,
  deleteGridEvent,
  removeGridLyric,
  setGridLyric,
  setNoteDuration,
  setRest,
  setSolfaPitch,
  solfaGridSelectionForNote,
  shiftOctave,
  toggleHoldToNext,
} from './solfaGridModel';

const BASIC_TEXT = `Doh is C
Time 4/4
Tempo 96
S: | d : r : m : f |
A: | d : r : m : f |
T: | d : r : m : f |
B: | d : r : m : f |`;

function baseModel(): ScoreModel {
  return parseSolfaText(BASIC_TEXT, { title: 'Morning Light' });
}

function fullLyricModel(): ScoreModel {
  return parseSolfaText(
    `${BASIC_TEXT}
L1: one two three four`,
    { title: 'Morning Light' }
  );
}

function cell(partId = 'S', noteIndex = 0, model = baseModel()) {
  return solfaGridSelectionForNote(model, partId, 0, noteIndex);
}

function notes(model: ScoreModel, partId = 'S') {
  return model.parts.find((part) => part.id === partId)!.measures[0]!.notes;
}

function expectCanonicalParity(model: ScoreModel) {
  const canonical = modelToSolfaText(model);
  expect(
    modelToSolfaText(parseSolfaText(canonical, { title: model.title }))
  ).toBe(canonical);
}

describe('Sol-fa Grid model edits', () => {
  it('edits a note through codec-resolved syllable, accidental and octave actions', () => {
    const original = baseModel();
    const pitched = setSolfaPitch(original, cell(), 'r');
    expect(notes(pitched)[0]!.pitch).toBe('D4');
    expect(original.parts[0]!.measures[0]!.notes[0]!.pitch).toBe('C4');
    expect(pitched).not.toBe(original);

    const accidental = applyAccidental(pitched, cell(), 'sharp');
    expect(notes(accidental)[0]!.pitch).toBe('D#4');

    const octave = shiftOctave(accidental, cell(), 1);
    expect(notes(octave)[0]!.pitch).toBe('D#5');
    expect(modelToSolfaText(octave)).toContain("S: | ri' : r : m : f |");
    expectCanonicalParity(octave);
  });

  it('changes duration in half-beat steps while preserving contiguous full-bar duration', () => {
    const changed = setNoteDuration(baseModel(), cell(), 1.5);
    expect(notes(changed).map(({ dur, onset }) => ({ dur, onset }))).toEqual([
      { dur: 1.5, onset: 0 },
      { dur: 0.5, onset: 1.5 },
      { dur: 1, onset: 2 },
      { dur: 1, onset: 3 },
    ]);
    expectCanonicalParity(changed);
  });

  it('creates and removes a held continuation through the shared tie model', () => {
    const held = toggleHoldToNext(baseModel(), cell());
    expect(notes(held)[0]).toMatchObject({ pitch: 'C4', tie: true });
    expect(notes(held)[1]!.pitch).toBe('C4');
    expect(modelToSolfaText(held)).toContain('S: | d : - : m : f |');
    expectCanonicalParity(held);

    const continued = toggleHoldToNext(held, cell());
    expect(notes(continued)[0]!.tie).toBe(false);
    expectCanonicalParity(continued);
  });

  it('propagates pitch through a tie chain and preserves its bar total on duration edits', () => {
    const held = toggleHoldToNext(baseModel(), cell());
    const changedPitch = setSolfaPitch(held, cell('S', 1, held), 'r');
    expect(
      notes(changedPitch)
        .slice(0, 2)
        .map((note) => note.pitch)
    ).toEqual(['D4', 'D4']);
    expect(notes(changedPitch)[0]!.tie).toBe(true);

    const resized = setNoteDuration(
      changedPitch,
      cell('S', 0, changedPitch),
      1.5
    );
    expect(
      resized.parts[0]!.measures[0]!.notes.reduce(
        (sum, note) => sum + note.dur,
        0
      )
    ).toBe(4);
    expect(
      notes(resized)
        .slice(0, 2)
        .map(({ pitch, tie }) => ({ pitch, tie }))
    ).toEqual([
      { pitch: 'D4', tie: true },
      { pitch: 'D4', tie: false },
    ]);
    expectCanonicalParity(resized);
  });

  it('addresses cells by part, bar, beat, and subdivision even when event ordinals reset per bar', () => {
    const twoBars = parseSolfaText(
      `Doh is C\nTime 4/4\nTempo 96\nS: | d : r : m : f | d : r : m : f |\nA: | d : r : m : f | d : r : m : f |\nT: | d : r : m : f | d : r : m : f |\nB: | d : r : m : f | d : r : m : f |`,
      { title: 'Two bars' }
    );
    const secondBarFirstBeat = solfaGridSelectionForNote(twoBars, 'S', 1, 0);
    expect(secondBarFirstBeat).toMatchObject({
      partId: 'S',
      barIndex: 1,
      barNumber: 2,
      beat: 1,
      subdivision: 0,
      cellOrdinal: 0,
    });
    const edited = setSolfaPitch(twoBars, secondBarFirstBeat, 'r');
    expect(edited.parts[0]!.measures[0]!.notes[0]!.pitch).toBe('C4');
    expect(edited.parts[0]!.measures[1]!.notes[0]!.pitch).toBe('D4');
    expectCanonicalParity(edited);
  });

  it('sets a rest and deletes an event without changing measure duration', () => {
    const rested = setRest(baseModel(), cell('S', 1));
    expect(notes(rested)[1]!.pitch).toBeNull();
    expect(modelToSolfaText(rested)).toContain('S: | d : 0 : m : f |');

    const deleted = deleteGridEvent(baseModel(), cell('S', 1));
    expect(notes(deleted)).toHaveLength(4);
    expect(notes(deleted).map((note) => note.pitch)).toEqual([
      'C4',
      'E4',
      'F4',
      null,
    ]);
    expect(notes(deleted).reduce((sum, note) => sum + note.dur, 0)).toBe(4);
    expectCanonicalParity(rested);
    expectCanonicalParity(deleted);
  });

  it('updates a complete lyric verse across represented parts and removes the verse as a whole', () => {
    const edited = setGridLyric(fullLyricModel(), cell('A', 1), 1, 'light');
    for (const partId of ['S', 'A', 'T', 'B']) {
      expect(notes(edited, partId)[1]!.lyrics).toContainEqual({
        text: 'light',
        syllabic: 'single',
        verse: 1,
      });
    }
    expect(modelToSolfaText(edited)).toContain('L1: one light three four');
    expectCanonicalParity(edited);

    const withoutVerse = removeGridLyric(edited, cell(), 1);
    expect(
      withoutVerse.parts
        .flatMap((part) => part.measures[0]!.notes)
        .every((note) => !note.lyrics?.length && !note.lyric)
    ).toBe(true);
    expect(modelToSolfaText(withoutVerse)).not.toContain('L1:');
    expectCanonicalParity(withoutVerse);
  });

  it('rejects a partial new lyric track and invalid accidental/duration edits atomically', () => {
    const original = baseModel();
    expect(() => setGridLyric(original, cell(), 1, 'hello')).toThrow(
      /lyric for every sung onset/
    );
    expect(() => applyAccidental(original, cell(), 'double-sharp')).toThrow(
      /alteration not supported/
    );
    expect(() => setNoteDuration(original, cell(), 2)).toThrow(
      /adjacent event is too short/
    );
    expect(notes(original)[0]!.pitch).toBe('C4');
    expect(notes(original)[0]!.dur).toBe(1);
    expect(notes(original)[0]!.lyrics).toBeUndefined();
    expectCanonicalParity(original);
  });

  it('can create a new complete verse when the score has one sung onset per part', () => {
    const oneNoteText = `Doh is C
Time 4/4
Tempo 90
S: | d : - : - : - |
A: | d : - : - : - |
T: | d : - : - : - |
B: | d : - : - : - |`;
    const oneNoteScore = parseSolfaText(oneNoteText, { title: 'One note' });
    const edited = setGridLyric(oneNoteScore, cell(), 1, 'Amen');
    expect(modelToSolfaText(edited)).toContain('L1: Amen');
    expectCanonicalParity(edited);
  });
});
