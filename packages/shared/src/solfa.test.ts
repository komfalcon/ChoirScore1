import { describe, expect, it } from 'vitest';
import { modelToSolfa } from './solfa.js';
import { scoreModelSchema, type ScoreModel } from './scoreModel.js';

function model(
  parts: unknown[],
  options: {
    fifths?: number;
    mode?: ScoreModel['key']['mode'];
    beats?: number;
    beatType?: number;
  } = {}
): ScoreModel {
  return scoreModelSchema.parse({
    title: 'Sol-fa test',
    key: {
      fifths: options.fifths ?? 0,
      mode: options.mode ?? 'major',
    },
    time: { beats: options.beats ?? 4, beatType: options.beatType ?? 4 },
    tempo: 90,
    parts,
  });
}

function part(id: string, name: string, measures: unknown[]) {
  return { id, name, clef: 'treble', measures };
}

function cell(
  score: ScoreModel,
  partId: string,
  measureIndex: number,
  beatIndex: number,
  segmentIndex = 0
) {
  return modelToSolfa(score).systems[0]!.parts.find(
    (candidate) => candidate.id === partId
  )!.measures[measureIndex]!.beats[beatIndex]!.segments[segmentIndex]!;
}

describe('modelToSolfa', () => {
  it('prints the Bb doh header and maps Bb in the signature to doh', () => {
    const score = model(
      [
        part('S', 'Soprano', [
          { number: 1, notes: [{ pitch: 'Bb3', dur: 1 }] },
        ]),
      ],
      { fifths: -2 }
    );
    const layout = modelToSolfa(score);

    expect(layout.header.keyText).toBe('Doh is Bb');
    expect(cell(score, 'S', 0, 0)).toMatchObject({
      kind: 'syllable',
      text: 'd',
    });
  });

  it('maps a second major key using its own doh and key signature', () => {
    const score = model(
      [part('S', 'Soprano', [{ number: 1, notes: [{ pitch: 'G3', dur: 1 }] }])],
      { fifths: 1 }
    );
    const layout = modelToSolfa(score);

    expect(layout.header.keyText).toBe('Doh is G');
    expect(cell(score, 'S', 0, 0)).toMatchObject({
      kind: 'syllable',
      text: 'd',
    });
  });

  it('uses a deterministic shared doh octave across all voice parts', () => {
    const score = model([
      part('S', 'Soprano', [
        {
          number: 1,
          notes: [
            { pitch: 'C3', dur: 1 },
            { pitch: 'C4', dur: 1 },
            { pitch: 'C5', dur: 1 },
          ],
        },
      ]),
      part('A', 'Alto', [
        {
          number: 1,
          notes: [
            { pitch: 'C3', dur: 1 },
            { pitch: 'C4', dur: 1 },
            { pitch: 'C5', dur: 1 },
          ],
        },
      ]),
    ]);
    const layout = modelToSolfa(score);

    for (const partId of ['S', 'A']) {
      const rendered = layout.systems[0]!.parts.find(
        (entry) => entry.id === partId
      )!;
      expect(
        rendered.measures[0]!.beats.map((beat) => beat.segments[0]!.text).slice(
          0,
          3
        )
      ).toEqual(['d,', 'd', "d'"]);
    }
  });

  it('aligns whole and half beats, holds, rests, and offbeat notes by bar position', () => {
    const score = model([
      part('T', 'Tenor', [
        {
          number: 7,
          notes: [
            { pitch: 'C4', dur: 2, onset: 0 },
            { pitch: null, dur: 0.5, onset: 2 },
            { pitch: 'D4', dur: 0.5, onset: 2.5 },
          ],
        },
      ]),
    ]);
    const layout = modelToSolfa(score);
    const beats = layout.systems[0]!.parts[0]!.measures[0]!.beats;

    expect(beats[0]!.segments).toHaveLength(1);
    expect(beats[0]!.segments[0]).toMatchObject({
      kind: 'syllable',
      text: 'd',
    });
    expect(beats[1]!.segments[0]).toMatchObject({ kind: 'hold', text: '-' });
    expect(beats[2]!.segments).toHaveLength(2);
    expect(beats[2]!.segments[0]).toMatchObject({ kind: 'rest', text: '' });
    expect(beats[2]!.segments[1]).toMatchObject({
      kind: 'syllable',
      text: 'r',
    });
    expect(beats[3]!.segments).toHaveLength(1);
    expect(beats[3]!.segments[0]).toMatchObject({ kind: 'rest', text: '' });
  });

  it('keeps chromatic notes visibly unsupported and never substitutes a natural syllable', () => {
    const score = model([
      part('S', 'Soprano', [{ number: 1, notes: [{ pitch: 'F#4', dur: 1 }] }]),
    ]);
    const layout = modelToSolfa(score);

    expect(cell(score, 'S', 0, 0)).toMatchObject({
      kind: 'unsupported',
      text: '?',
      pitch: 'F#4',
    });
    expect(layout.warnings).toContainEqual(
      expect.objectContaining({
        code: 'CHROMATIC_NOTE',
        pitch: 'F#4',
        message: expect.stringContaining('owner/director confirms'),
      })
    );
    expect(layout.warnings[0]!.message).toContain(
      'No natural-note substitution'
    );
  });

  it('rejects and marks a quarter-beat duration instead of rounding it into a syllable', () => {
    const score = model([
      part('A', 'Alto', [{ number: 3, notes: [{ pitch: 'C4', dur: 0.25 }] }]),
    ]);
    const layout = modelToSolfa(score);

    expect(cell(score, 'A', 0, 0)).toMatchObject({
      kind: 'unsupported',
      text: '?',
    });
    expect(layout.warnings).toContainEqual(
      expect.objectContaining({
        code: 'UNSUPPORTED_SUBDIVISION',
        message: expect.stringContaining('quarter-beat'),
      })
    );
  });

  it('adds a new Doh marker when the key changes mid-score', () => {
    const score = model([
      part('S', 'Soprano', [
        { number: 1, notes: [{ pitch: 'C4', dur: 1 }] },
        {
          number: 2,
          key: { fifths: -2, mode: 'major' },
          notes: [{ pitch: 'Bb3', dur: 1 }],
        },
      ]),
    ]);
    const layout = modelToSolfa(score);

    expect(layout.header.keyText).toBe('Doh is C');
    expect(layout.systems[0]!.measures[1]!.dohMarker).toBe('Doh is Bb');
    expect(cell(score, 'S', 1, 0)).toMatchObject({
      kind: 'syllable',
      text: 'd',
    });
  });

  it('shows relative-major Doh and minor-home Lah', () => {
    const score = model(
      [part('A', 'Alto', [{ number: 1, notes: [{ pitch: 'A3', dur: 1 }] }])],
      { mode: 'minor' }
    );
    const layout = modelToSolfa(score);

    expect(layout.header.doh).toBe('C');
    expect(layout.header.lah).toBe('A');
    expect(layout.header.keyText).toBe('Doh is C · Lah is A');
    expect(cell(score, 'A', 0, 0)).toMatchObject({
      kind: 'syllable',
      text: 'l,',
    });
  });

  it('keeps verses independent across bars and assigns no new lyric to held notes', () => {
    const score = model([
      part('T', 'Tenor', [
        {
          number: 1,
          notes: [
            {
              pitch: 'C4',
              dur: 2,
              tie: true,
              lyrics: [
                { text: 'Hal', syllabic: 'begin', verse: 1 },
                { text: 'O', verse: 2 },
              ],
            },
          ],
        },
        {
          number: 2,
          notes: [
            { pitch: 'C4', dur: 1 },
            {
              pitch: 'D4',
              dur: 1,
              lyrics: [
                { text: 'le', syllabic: 'middle', verse: 1 },
                { text: 'Joy', verse: 2 },
              ],
            },
            {
              pitch: 'E4',
              dur: 2,
              lyrics: [
                { text: 'lu', syllabic: 'end', verse: 1 },
                { text: 'ful', syllabic: 'end', verse: 2 },
              ],
            },
          ],
        },
      ]),
    ]);
    const layout = modelToSolfa(score);
    const rendered = layout.systems[0]!.parts[0]!;
    const verseOneBar1 = rendered.measures[0]!.beats[0]!.segments[0]!.lyrics;
    const bar1Hold = rendered.measures[0]!.beats[1]!.segments[0]!;
    const bar2Hold = rendered.measures[1]!.beats[0]!.segments[0]!;
    const verseTwoBar2 = rendered.measures[1]!.beats[1]!.segments[0]!.lyrics;

    expect(verseOneBar1).toEqual([
      { verse: 1, text: 'Hal', syllabic: 'begin' },
      { verse: 2, text: 'O' },
    ]);
    expect(bar1Hold).toMatchObject({ kind: 'hold', lyrics: [] });
    expect(bar2Hold).toMatchObject({ kind: 'hold', lyrics: [] });
    expect(verseTwoBar2).toContainEqual({ verse: 2, text: 'Joy' });
    expect(rendered.measures[1]!.beats[2]!.segments[0]!.lyrics).toContainEqual({
      verse: 1,
      text: 'lu',
      syllabic: 'end',
    });
  });
});
