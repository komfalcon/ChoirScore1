import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_MUSICXML_BYTES,
  MAX_XML_ELEMENT_DEPTH,
  MusicXmlConversionError,
  modelToMusicXml,
  musicXmlToModel,
  type MusicXmlConversionErrorCode,
} from './musicxml.js';
import { scoreModelSchema } from './scoreModel.js';

const fixture = readFileSync(
  new URL('../test/fixtures/musescore-4.7.5-satb.musicxml', import.meta.url),
  'utf8'
);

function expectConversionError(
  input: string,
  code: MusicXmlConversionErrorCode
): void {
  try {
    musicXmlToModel(input);
  } catch (error) {
    expect(error).toBeInstanceOf(MusicXmlConversionError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected MusicXmlConversionError with code ${code}.`);
}

describe('MusicXML converters', () => {
  it('reads a genuine MuseScore 4.7.5 four-part export into the shared score model', () => {
    expect(fixture).toContain('<software>MuseScore Studio 4.7.5</software>');
    const result = musicXmlToModel(fixture);

    expect(result.model.title).toContain('Morning Light');
    expect(result.model.composer).toBe('ChoirScore test tune');
    expect(result.model.key).toEqual({ fifths: 1, mode: 'major' });
    expect(result.model.time).toEqual({ beats: 4, beatType: 4 });
    expect(result.model.parts.map((part) => part.id)).toEqual([
      'P1',
      'P2',
      'P3',
      'P4',
    ]);
    expect(result.model.parts.map((part) => part.name)).toEqual([
      'Soprano',
      'Alto',
      'Tenor',
      'Bass',
    ]);
    expect(result.model.parts.every((part) => part.measures.length === 2)).toBe(
      true
    );
    expect(result.model.parts[2]?.clef).toBe('treble8vb');
    expect(result.model.parts[3]?.clef).toBe('bass');

    const sopranoNotes = result.model.parts[0]!.measures[0]!.notes;
    expect(sopranoNotes[0]).toMatchObject({
      pitch: 'F5',
      dur: 1,
      lyric: { text: 'Morning', syllabic: 'single' },
    });
    expect(sopranoNotes.filter((note) => note.tuplet)).toHaveLength(3);
    expect(
      sopranoNotes.some((note) => Math.abs(note.dur - 1 / 3) < 0.000001)
    ).toBe(true);
    expect(sopranoNotes.at(-1)?.tie).toBe(true);
    expect(
      result.warnings.some((warning) =>
        warning.path?.includes('other-notation')
      )
    ).toBe(true);
    expect(
      result.warnings.some((warning) =>
        warning.message.includes('Tie-stop notation')
      )
    ).toBe(true);
  });

  it('returns the exact original XML when an imported model is unchanged, including unmodelled notation', () => {
    const result = musicXmlToModel(fixture);
    expect(modelToMusicXml(result.model)).toBe(fixture);
    expect(result.model.preservation?.sourceXml).toBe(fixture);
    expect(result.model.preservation?.sourceXml).toContain(
      '<other-notation type="single">ChoirScore preservation sentinel</other-notation>'
    );
    expect(
      scoreModelSchema.safeParse(result.model).success,
      'converter sidecar must not leak into the public/wire model schema'
    ).toBe(false);
  });

  it('fails closed rather than silently losing preserved constructs after a model edit', () => {
    const imported = musicXmlToModel(fixture);
    const changed = { ...imported.model, title: 'Edited title' };
    expect(() => modelToMusicXml(changed)).toThrowError(
      /cannot be canonically re-exported after model changes/i
    );
  });

  it('canonically exports a new model and round-trips voices, lyrics, ties and exact triplet timing', () => {
    const model = scoreModelSchema.parse({
      title: 'New model',
      composer: 'ChoirScore',
      key: { fifths: 0, mode: 'major' },
      time: { beats: 4, beatType: 4 },
      tempo: 96,
      parts: [
        {
          id: 'S',
          name: 'Soprano',
          clef: 'treble',
          measures: [
            {
              number: 1,
              notes: [
                {
                  pitch: 'C5',
                  dur: 1 / 3,
                  tie: true,
                  voice: '1',
                  staff: 1,
                  onset: 0,
                  chord: false,
                  lyric: { text: 'Tri-', syllabic: 'begin' },
                  tuplet: {
                    actualNotes: 3,
                    normalNotes: 2,
                    normalType: 'quarter',
                  },
                },
                {
                  pitch: 'D5',
                  dur: 1 / 3,
                  tie: false,
                  voice: '2',
                  staff: 1,
                  onset: 1 / 3,
                  chord: false,
                },
              ],
            },
          ],
        },
      ],
    });

    const xml = modelToMusicXml(model);
    expect(xml).toContain('<score-partwise version="4.0">');
    expect(xml).toContain('<actual-notes>3</actual-notes>');
    expect(xml).toContain('<duration>1</duration>');
    const roundTripped = musicXmlToModel(xml).model;
    expect(roundTripped.title).toBe(model.title);
    expect(roundTripped.parts[0]?.measures[0]?.notes).toMatchObject([
      {
        pitch: 'C5',
        dur: 1 / 3,
        tie: true,
        voice: '1',
        onset: 0,
        lyric: { text: 'Tri-', syllabic: 'begin' },
        tuplet: { actualNotes: 3, normalNotes: 2, normalType: 'quarter' },
      },
      { pitch: 'D5', dur: 1 / 3, voice: '2', onset: 1 / 3 },
    ]);
  });

  it('rejects malformed, oversized, timewise, entity and non-MusicXML external-DTD inputs', () => {
    expectConversionError('<score-partwise', 'MALFORMED_XML');
    expectConversionError('<score-timewise/>', 'UNSUPPORTED_ROOT');
    expectConversionError('<score-partwise/>', 'NO_PARTS');
    expectConversionError(' '.repeat(MAX_MUSICXML_BYTES + 1), 'FILE_TOO_LARGE');
    const deepXml = `<score-partwise>${'<x>'.repeat(MAX_XML_ELEMENT_DEPTH)}${'</x>'.repeat(MAX_XML_ELEMENT_DEPTH)}</score-partwise>`;
    expectConversionError(deepXml, 'XML_DEPTH_LIMIT');
    expectConversionError(
      '<!DOCTYPE score-partwise [<!ENTITY x "expansion">]><score-partwise/>',
      'DOCTYPE_NOT_ALLOWED'
    );
    expectConversionError(
      '<!DOCTYPE score-partwise SYSTEM "https://attacker.example/evil.dtd"><score-partwise/>',
      'DOCTYPE_NOT_ALLOWED'
    );
  });
});
