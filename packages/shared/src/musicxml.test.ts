import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_MUSICXML_BYTES,
  MAX_XML_ELEMENT_DEPTH,
  MusicXmlConversionError,
  modelToMusicXml,
  musicXmlToModel,
  type MusicXmlConversionResult,
  type MusicXmlConversionErrorCode,
} from './musicxml.js';
import {
  scoreContentWriteErrorResponseSchema,
  scoreDetailSchema,
  scoreImportResultSchema,
  scorePartSummariesFromModel,
  scoreSummarySchema,
  type ScoreImportWarningCode,
} from './scoreContracts.js';
import { scoreModelSchema } from './scoreModel.js';

const fixture = readFileSync(
  new URL('../test/fixtures/musescore-4.7.5-satb.musicxml', import.meta.url),
  'utf8'
);
const midScoreClefChangeFixture = readFileSync(
  new URL('../test/fixtures/mid-score-clef-change.musicxml', import.meta.url),
  'utf8'
);
const additionalTempoMarkingFixture = readFileSync(
  new URL(
    '../test/fixtures/additional-tempo-marking.musicxml',
    import.meta.url
  ),
  'utf8'
);
const singleDirectionMultipleTempoMarkingsFixture = readFileSync(
  new URL(
    '../test/fixtures/single-direction-multiple-tempo-markings.musicxml',
    import.meta.url
  ),
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

function expectExportError(
  action: () => string,
  code: MusicXmlConversionErrorCode
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(MusicXmlConversionError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected MusicXmlConversionError with code ${code}.`);
}

function expectOpaqueReadOnly(
  xml: string,
  result: MusicXmlConversionResult,
  warningCode: ScoreImportWarningCode
): void {
  expect(result.warnings).toContainEqual(
    expect.objectContaining({ code: warningCode })
  );
  expect(result.preservation).toMatchObject({
    state: 'opaque_constructs_preserved',
    readOnlyReason: 'UNSUPPORTED_MUSICXML_CONSTRUCTS_PRESERVED',
  });
  expect(result.preservation.preservedConstructs).toContainEqual(
    expect.objectContaining({ code: warningCode })
  );
  const partIds = result.model.parts.map((part) => part.id);
  const summary = scoreSummarySchema.parse({
    id: 'opaque-import',
    title: result.model.title,
    composer: result.model.composer,
    key: result.model.key,
    time: result.model.time,
    partIds,
    parts: scorePartSummariesFromModel({ parts: result.model.parts }),
    partCount: partIds.length,
    measureCount: Math.max(
      ...result.model.parts.map((part) => part.measures.length)
    ),
    visibility: 'private',
    creator: { id: 'user-1', displayName: 'Test User' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isOwner: true,
    canView: true,
    canEdit: true,
    canEditContent: false,
    canManageAccess: true,
    canChangeVisibility: true,
    canSetChoirVisibility: false,
    preservation: result.preservation,
  });
  expect(summary).toMatchObject({
    canEdit: true,
    canEditContent: false,
    preservation: result.preservation,
  });
  const importResponse = scoreImportResultSchema.parse({
    score: summary,
    versionId: 'version-1',
    warnings: result.warnings,
  });
  expect(importResponse.warnings).toContainEqual(
    expect.objectContaining({ code: warningCode })
  );
  const { preservation: _sourcePreservation, ...wireModelInput } = result.model;
  const detail = scoreDetailSchema.parse({
    ...summary,
    currentVersionId: 'version-1',
    version: {
      id: 'version-1',
      note: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: { id: 'user-1', displayName: 'Test User' },
    },
    model: scoreModelSchema.parse(wireModelInput),
    musicXml: xml,
  });
  expect(detail).toMatchObject({ canEditContent: false, musicXml: xml });
  expect(result.model.preservation?.requiresSourcePreservation).toBe(true);
  expect(result.model.preservation?.sourceXml).toBe(xml);
  expect(modelToMusicXml(result.model)).toBe(xml);
  expectExportError(
    () =>
      modelToMusicXml({
        ...result.model,
        title: `${result.model.title} edited`,
      }),
    'PRESERVATION_CONTEXT_CHANGED'
  );
  expect(
    scoreContentWriteErrorResponseSchema.parse({
      error: {
        code: 'SCORE_CONTENT_READ_ONLY',
        message: 'Opaque MusicXML content is preserved.',
        preservation: result.preservation,
      },
    }).error.code
  ).toBe('SCORE_CONTENT_READ_ONLY');
}

function tempoOnlyXml(perMinute: string, beatUnit = 'quarter'): string {
  return `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="voice-x"><part-name>Voice</part-name></score-part></part-list><part id="voice-x"><measure number="1"><attributes><divisions>1</divisions></attributes><direction><direction-type><metronome><beat-unit>${beatUnit}</beat-unit><per-minute>${perMinute}</per-minute></metronome></direction-type></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
}

function keyChangeXml(): string {
  return `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="S"><part-name>Soprano</part-name></score-part><score-part id="A"><part-name>Alto</part-name></score-part></part-list><part id="S"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure><measure number="2"><attributes><key><fifths>-2</fifths><mode>major</mode></key></attributes><note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>1</duration></note></measure></part><part id="A"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure><measure number="2"><attributes><key><fifths>-2</fifths><mode>major</mode></key></attributes><note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
}

function twoVerseXml(): string {
  return `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="A"><part-name>Alto</part-name></score-part></part-list><part id="A"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><lyric number="1"><syllabic>begin</syllabic><text>Hal</text></lyric><lyric number="2"><text>Joy</text></lyric></note></measure></part></score-partwise>`;
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
    expect(scorePartSummariesFromModel({ parts: result.model.parts })).toEqual([
      { id: 'P1', label: 'Soprano' },
      { id: 'P2', label: 'Alto' },
      { id: 'P3', label: 'Tenor' },
      { id: 'P4', label: 'Bass' },
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
    expect(result.preservation).toMatchObject({
      state: 'opaque_constructs_preserved',
      readOnlyReason: 'UNSUPPORTED_MUSICXML_CONSTRUCTS_PRESERVED',
    });
  });

  it('models mid-score key changes and re-exports them without opaque warnings', () => {
    const imported = musicXmlToModel(keyChangeXml());

    expect(imported.model.key).toEqual({ fifths: 0, mode: 'major' });
    expect(imported.model.parts[0]?.measures[1]?.key).toEqual({
      fifths: -2,
      mode: 'major',
    });
    expect(imported.model.parts[1]?.measures[1]?.key).toEqual({
      fifths: -2,
      mode: 'major',
    });
    expect(imported.warnings).not.toContainEqual(
      expect.objectContaining({ code: 'MID_SCORE_ATTRIBUTES_PRESERVED' })
    );
    expect(imported.preservation.state).toBe('clean');

    const exported = modelToMusicXml({
      ...imported.model,
      title: 'Edited key change',
    });
    const roundTripped = musicXmlToModel(exported);
    expect(roundTripped.model.parts[0]?.measures[1]?.key).toEqual({
      fifths: -2,
      mode: 'major',
    });
  });

  it('retains numbered lyric verses as independent per-note lyric tracks', () => {
    const imported = musicXmlToModel(twoVerseXml());
    const note = imported.model.parts[0]?.measures[0]?.notes[0];

    expect(note?.lyric).toEqual({
      text: 'Hal',
      syllabic: 'begin',
      verse: 1,
    });
    expect(note?.lyrics).toEqual([
      { text: 'Hal', syllabic: 'begin', verse: 1 },
      { text: 'Joy', verse: 2 },
    ]);
    expect(imported.warnings).not.toContainEqual(
      expect.objectContaining({ code: 'MULTIPLE_LYRICS_PRESERVED' })
    );
    expect(imported.preservation.state).toBe('clean');

    const exported = modelToMusicXml({
      ...imported.model,
      title: 'Edited verses',
    });
    expect(exported).toContain('<lyric number="1">');
    expect(exported).toContain('<lyric number="2">');
    expect(
      musicXmlToModel(exported).model.parts[0]?.measures[0]?.notes[0]?.lyrics
    ).toEqual(note?.lyrics);
  });

  it('returns the exact original XML when an imported model is unchanged, including unmodelled notation', () => {
    const result = musicXmlToModel(fixture);
    expect(modelToMusicXml(result.model)).toBe(fixture);
    expect(result.model.preservation?.sourceXml).toBe(fixture);
    expect(result.model.preservation?.requiresSourcePreservation).toBe(true);
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
    expectExportError(
      () => modelToMusicXml(changed),
      'PRESERVATION_CONTEXT_CHANGED'
    );
    const { preservation: _discarded, ...wireModel } = imported.model;
    expectExportError(
      () => modelToMusicXml(wireModel),
      'SOURCE_PROVENANCE_REQUIRED'
    );
  });

  it('allows canonical edits to imported scores only when no opaque content was found', () => {
    const imported = musicXmlToModel(tempoOnlyXml('120'));
    expect(imported.preservation.state).toBe('clean');
    const changed = { ...imported.model, title: 'Edited safely' };
    const exported = modelToMusicXml(changed);
    expect(musicXmlToModel(exported).model.title).toBe('Edited safely');
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

    expectExportError(
      () => modelToMusicXml(model),
      'SOURCE_PROVENANCE_REQUIRED'
    );
    const xml = modelToMusicXml(model, { mode: 'new-score' });
    expect(xml).toContain('<score-partwise version="4.0">');
    expect(xml).toContain('<divisions>3</divisions>');
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

  it('rejects positive durations that cannot be represented as exact nonzero ticks', () => {
    const tiny = scoreModelSchema.parse({
      title: 'Tiny duration',
      key: { fifths: 0, mode: 'major' },
      time: { beats: 4, beatType: 4 },
      parts: [
        {
          id: 'voice-1',
          clef: 'treble',
          measures: [
            {
              number: 1,
              notes: [{ pitch: 'C4', dur: 0.0000001 }],
            },
          ],
        },
      ],
    });
    expectExportError(
      () => modelToMusicXml(tiny, { mode: 'new-score' }),
      'UNREPRESENTABLE_DURATION'
    );
  });

  it('reads metronome-only per-minute values and warns when they cannot be modeled', () => {
    expect(musicXmlToModel(tempoOnlyXml('126')).model.tempo).toBe(126);
    const unsupported = musicXmlToModel(tempoOnlyXml('allegro'));
    expect(unsupported.model.tempo).toBe(90);
    expect(unsupported.warnings).toContainEqual(
      expect.objectContaining({ code: 'UNSUPPORTED_TEMPO_PRESERVED' })
    );
    expect(unsupported.preservation.state).toBe('opaque_constructs_preserved');
  });

  it('preserves mid-score clef changes and rejects editing their lossy model projection', () => {
    const result = musicXmlToModel(midScoreClefChangeFixture);
    expect(result.model.parts[0]?.clef).toBe('treble');
    expect(result.warnings).toContainEqual({
      code: 'MID_SCORE_CLEF_CHANGE_PRESERVED',
      message:
        'Mid-score clef changes are not represented over time; the original XML is preserved.',
      partId: 'voice-x',
      measure: 1,
      path: '/score-partwise/part/measure/attributes/clef',
    });
    expectOpaqueReadOnly(
      midScoreClefChangeFixture,
      result,
      'MID_SCORE_CLEF_CHANGE_PRESERVED'
    );
  });

  it('preserves additional tempo directions after the first valid tempo', () => {
    const result = musicXmlToModel(additionalTempoMarkingFixture);
    expect(result.model.tempo).toBe(120);
    expect(result.warnings).toContainEqual({
      code: 'ADDITIONAL_TEMPO_MARKING_PRESERVED',
      message:
        'Additional tempo markings are not represented in the shared model; the original XML is preserved.',
      partId: 'voice-x',
      measure: 1,
      path: '/score-partwise/part/measure/direction',
    });
    expectOpaqueReadOnly(
      additionalTempoMarkingFixture,
      result,
      'ADDITIONAL_TEMPO_MARKING_PRESERVED'
    );
  });

  it('preserves multiple tempo markings inside a single direction', () => {
    const result = musicXmlToModel(singleDirectionMultipleTempoMarkingsFixture);
    expect(result.model.tempo).toBe(120);
    expect(result.warnings).toContainEqual({
      code: 'ADDITIONAL_TEMPO_MARKING_PRESERVED',
      message:
        'Additional tempo markings are not represented in the shared model; the original XML is preserved.',
      partId: 'voice-x',
      measure: 1,
      path: '/score-partwise/part/measure/direction',
    });
    expectOpaqueReadOnly(
      singleDirectionMultipleTempoMarkingsFixture,
      result,
      'ADDITIONAL_TEMPO_MARKING_PRESERVED'
    );
  });

  it('marks a G clef with octave-change 1 read-only instead of exporting ordinary treble', () => {
    const xml = tempoOnlyXml('120').replace(
      '<divisions>1</divisions>',
      '<divisions>1</divisions><clef><sign>G</sign><line>2</line><clef-octave-change>1</clef-octave-change></clef>'
    );
    const result = musicXmlToModel(xml);
    expect(result.model.parts[0]?.clef).toBe('treble');
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'UNSUPPORTED_CLEF_PRESERVED',
        path: '/score-partwise/part/measure/attributes/clef',
      })
    );
    expectOpaqueReadOnly(xml, result, 'UNSUPPORTED_CLEF_PRESERVED');

    const bassXml = tempoOnlyXml('120').replace(
      '<divisions>1</divisions>',
      '<divisions>1</divisions><clef><sign>F</sign><line>4</line><clef-octave-change>1</clef-octave-change></clef>'
    );
    const bassResult = musicXmlToModel(bassXml);
    expect(bassResult.warnings).toContainEqual(
      expect.objectContaining({ code: 'UNSUPPORTED_CLEF_PRESERVED' })
    );
    expectOpaqueReadOnly(bassXml, bassResult, 'UNSUPPORTED_CLEF_PRESERVED');
  });

  it('marks work and movement titles read-only when the movement title is not modeled', () => {
    const xml = tempoOnlyXml('120').replace(
      '<part-list>',
      '<work><work-title>Full Work</work-title></work><movement-title>Movement I</movement-title><part-list>'
    );
    const result = musicXmlToModel(xml);
    expect(result.model.title).toBe('Full Work');
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'ADDITIONAL_TITLE_PRESERVED',
        path: '/score-partwise/movement-title',
      })
    );
    expectOpaqueReadOnly(xml, result, 'ADDITIONAL_TITLE_PRESERVED');
  });

  it('marks non-composer creator credits read-only instead of discarding them', () => {
    const xml = tempoOnlyXml('120').replace(
      '<part-list>',
      '<identification><creator type="composer">Composer Name</creator><creator type="lyricist">Lyricist Name</creator></identification><part-list>'
    );
    const result = musicXmlToModel(xml);
    expect(result.model.composer).toBe('Composer Name');
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'UNMODELED_CREATOR_CREDIT_PRESERVED',
        path: '/score-partwise/identification/creator',
      })
    );
    expectOpaqueReadOnly(xml, result, 'UNMODELED_CREATOR_CREDIT_PRESERVED');
  });

  it('warns and marks the source read-only for unsupported attributes such as print-object="no"', () => {
    const xml = fixture.replace(/<note(?=[\s>])/, '<note print-object="no"');
    const result = musicXmlToModel(xml);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'UNSUPPORTED_ATTRIBUTE_PRESERVED',
        path: expect.stringContaining('/@print-object'),
      })
    );
    expect(result.preservation.state).toBe('opaque_constructs_preserved');
    expect(modelToMusicXml(result.model)).toBe(xml);

    const rootAttributeXml = fixture.replace(
      '<score-partwise version="4.0">',
      '<score-partwise version="4.0" custom-root-flag="yes">'
    );
    const rootAttributeResult = musicXmlToModel(rootAttributeXml);
    expect(rootAttributeResult.warnings).toContainEqual(
      expect.objectContaining({
        code: 'UNSUPPORTED_ATTRIBUTE_PRESERVED',
        path: '/score-partwise/@custom-root-flag',
      })
    );
  });

  it('uses the source part name or deterministic Part N fallback, never the MusicXML ID', () => {
    const xml = fixture
      .replace('<score-part id="P2">', '<score-part id="voice-2">')
      .replace('<part id="P2">', '<part id="voice-2">')
      .replace('<part-name>Alto</part-name>', '');
    const model = musicXmlToModel(xml).model;
    expect(model.parts[1]).toMatchObject({ id: 'voice-2' });
    expect(model.parts[1]?.name).toBeUndefined();
    expect(scorePartSummariesFromModel({ parts: model.parts })[1]).toEqual({
      id: 'voice-2',
      label: 'Part 2',
    });
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
