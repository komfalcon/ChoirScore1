import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import {
  scoreImportWarningSchema,
  scorePreservationFromWarnings,
  scorePreservationSchema,
  type ScoreImportWarning,
  type ScoreImportWarningCode,
} from './scoreContracts.js';
import {
  scoreKeyModeSchema,
  scoreModelSchema,
  scoreModelWireSchema,
  scoreSyllabicSchema,
  type ScoreClef,
  type ScoreKey,
  type ScoreModel,
  type ScoreModelInput,
  type ScoreNoteInput,
} from './scoreModel.js';

export const MAX_MUSICXML_BYTES = 6 * 1024 * 1024;
export const MAX_XML_ELEMENT_DEPTH = 256;
const MAX_DIVISIONS = 1_000_000;

const musicXmlPreservationSchema = z
  .object({
    /** Verbatim source used to preserve constructs not represented by ScoreModel. */
    sourceXml: z.string().min(1).max(MAX_MUSICXML_BYTES),
    /** Snapshot of the public model projection at import time. */
    modelSnapshot: z.string().min(1),
    /** True when edits could discard semantics not represented by ScoreModel. */
    requiresSourcePreservation: z.boolean(),
  })
  .strict();

/** Internal converter result. The `preservation` field is not part of the API model. */
export const preservedScoreModelSchema = scoreModelSchema
  .extend({ preservation: musicXmlPreservationSchema.optional() })
  .strict();
export type PreservedScoreModel = z.infer<typeof preservedScoreModelSchema>;

export const musicXmlConversionResultSchema = z
  .object({
    model: preservedScoreModelSchema,
    warnings: z.array(scoreImportWarningSchema),
    preservation: scorePreservationSchema,
  })
  .strict();
export type MusicXmlConversionResult = z.infer<
  typeof musicXmlConversionResultSchema
>;

export const musicXmlConversionErrorCodeSchema = z.enum([
  'FILE_TOO_LARGE',
  'DOCTYPE_NOT_ALLOWED',
  'MALFORMED_XML',
  'XML_DEPTH_LIMIT',
  'UNSUPPORTED_ROOT',
  'NO_PARTS',
  'INVALID_SCORE',
  'PRESERVATION_CONTEXT_CHANGED',
  'SOURCE_PROVENANCE_REQUIRED',
  'UNREPRESENTABLE_DURATION',
]);
export type MusicXmlConversionErrorCode = z.infer<
  typeof musicXmlConversionErrorCodeSchema
>;

export class MusicXmlConversionError extends Error {
  readonly code: MusicXmlConversionErrorCode;
  readonly issues: ScoreImportWarning[];

  constructor(
    code: MusicXmlConversionErrorCode,
    message: string,
    issues: ScoreImportWarning[] = []
  ) {
    super(message);
    this.name = 'MusicXmlConversionError';
    this.code = code;
    this.issues = issues;
  }
}

export const modelToMusicXmlOptionsSchema = z
  .object({ mode: z.literal('new-score') })
  .strict();
export type ModelToMusicXmlOptions = z.infer<
  typeof modelToMusicXmlOptionsSchema
>;

type OrderedNode = Record<string, unknown> & {
  ':@'?: Record<string, string>;
};

/**
 * Ordered tree mode preserves child ordering. DTD/entity processing remains off;
 * `musicXmlToModel` rejects DTD declarations before this parser receives input.
 */
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  htmlEntities: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
});

const supportedElementNames = new Set([
  'score-partwise',
  'work',
  'work-title',
  'movement-title',
  'identification',
  'creator',
  'part-list',
  'score-part',
  'part-name',
  'part',
  'measure',
  'attributes',
  'divisions',
  'key',
  'fifths',
  'mode',
  'time',
  'beats',
  'beat-type',
  'clef',
  'sign',
  'line',
  'clef-octave-change',
  'note',
  'chord',
  'pitch',
  'step',
  'alter',
  'octave',
  'rest',
  'duration',
  'tie',
  'voice',
  'staff',
  'type',
  'dot',
  'time-modification',
  'actual-notes',
  'normal-notes',
  'normal-type',
  'lyric',
  'syllabic',
  'text',
  'notations',
  'tied',
  'backup',
  'forward',
  'direction',
  'direction-type',
  'metronome',
  'beat-unit',
  'per-minute',
  'sound',
]);

const supportedAttributesByElement: Record<string, Set<string>> = {
  'score-partwise': new Set(['version']),
  'score-part': new Set(['id']),
  part: new Set(['id']),
  measure: new Set(['number']),
  tie: new Set(['type']),
  tied: new Set(['type']),
  creator: new Set(['type']),
  sound: new Set(['tempo']),
  lyric: new Set(['number']),
};

function tagName(node: OrderedNode | undefined): string | undefined {
  if (!node) return undefined;
  return Object.keys(node).find((key) => key !== ':@' && key !== '#text');
}

function elementChildren(node: OrderedNode | undefined): OrderedNode[] {
  const tag = tagName(node);
  const value = tag ? node?.[tag] : undefined;
  return Array.isArray(value) ? (value as OrderedNode[]) : [];
}

function children(node: OrderedNode | undefined, name: string): OrderedNode[] {
  return elementChildren(node).filter((child) => tagName(child) === name);
}

function firstChild(
  node: OrderedNode | undefined,
  name: string
): OrderedNode | undefined {
  return children(node, name)[0];
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(amp|lt|gt|quot|apos);|&#(\d{1,7});|&#x([\da-f]{1,6});/gi,
    (
      entity,
      named: string | undefined,
      decimal: string | undefined,
      hex: string | undefined
    ) => {
      if (named) {
        const replacements: Record<string, string> = {
          amp: '&',
          lt: '<',
          gt: '>',
          quot: '"',
          apos: "'",
        };
        return replacements[named.toLowerCase()] ?? entity;
      }
      const codePoint = decimal
        ? Number(decimal)
        : Number.parseInt(hex ?? '', 16);
      if (
        !Number.isInteger(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return entity;
      }
      return String.fromCodePoint(codePoint);
    }
  );
}

function rawText(node: OrderedNode | undefined): string | undefined {
  if (!node) return undefined;
  const directText = node['#text'];
  if (typeof directText === 'string') return decodeXmlEntities(directText);
  const textPieces = elementChildren(node)
    .map((child) => child['#text'])
    .filter((value): value is string => typeof value === 'string');
  return textPieces.length ? decodeXmlEntities(textPieces.join('')) : undefined;
}

function childText(
  node: OrderedNode | undefined,
  name: string
): string | undefined {
  return rawText(firstChild(node, name));
}

function attribute(
  node: OrderedNode | undefined,
  name: string
): string | undefined {
  const value = node?.[':@']?.[`@_${name}`];
  return typeof value === 'string' ? decodeXmlEntities(value) : undefined;
}

function numericText(
  node: OrderedNode | undefined,
  name: string
): number | undefined {
  const value = childText(node, name)?.trim();
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^-?\d+$/.test(value.trim())) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

function issue(
  warnings: ScoreImportWarning[],
  code: ScoreImportWarningCode,
  message: string,
  extra: Partial<
    Pick<ScoreImportWarning, 'path' | 'partId' | 'measure' | 'noteIndex'>
  > = {}
): void {
  warnings.push({ code, message, ...extra });
}

function collectUnsupportedAttributes(
  node: OrderedNode,
  elementName: string,
  path: string,
  warnings: ScoreImportWarning[],
  seen: Set<string>
): void {
  const knownAttributes =
    supportedAttributesByElement[elementName] ?? new Set<string>();
  for (const attributeKey of Object.keys(node[':@'] ?? {})) {
    const attributeName = attributeKey.replace(/^@_/, '');
    if (
      attributeName === 'xmlns' ||
      attributeName.startsWith('xmlns:') ||
      knownAttributes.has(attributeName)
    ) {
      continue;
    }
    const attributePath = `${path}/@${attributeName}`;
    const attributeKeyForSeen = `attribute:${elementName}@${attributeName}`;
    if (seen.has(attributeKeyForSeen)) continue;
    seen.add(attributeKeyForSeen);
    issue(
      warnings,
      'UNSUPPORTED_ATTRIBUTE_PRESERVED',
      `MusicXML attribute @${attributeName} on <${elementName}> is not represented in the shared model; the original XML is preserved.`,
      { path: attributePath }
    );
  }
}

function collectUnsupported(
  root: OrderedNode,
  warnings: ScoreImportWarning[]
): void {
  const seen = new Set<string>();
  const stack: Array<{ node: OrderedNode; path: string; depth: number }> = [
    { node: root, path: '/score-partwise', depth: 0 },
  ];
  while (stack.length) {
    const current = stack.pop()!;
    const currentName = tagName(current.node);
    if (currentName) {
      collectUnsupportedAttributes(
        current.node,
        currentName,
        current.path,
        warnings,
        seen
      );
    }
    const currentChildren = elementChildren(current.node);
    for (let index = currentChildren.length - 1; index >= 0; index -= 1) {
      const child = currentChildren[index]!;
      const name = tagName(child);
      if (!name) continue;
      const depth = current.depth + 1;
      if (depth > MAX_XML_ELEMENT_DEPTH) {
        throw new MusicXmlConversionError(
          'XML_DEPTH_LIMIT',
          `MusicXML exceeds the ${MAX_XML_ELEMENT_DEPTH}-element nesting limit.`
        );
      }
      const path = `${current.path}/${name}`;
      if (!supportedElementNames.has(name) && !seen.has(name)) {
        seen.add(name);
        issue(
          warnings,
          'UNSUPPORTED_CONSTRUCT_PRESERVED',
          `MusicXML element <${name}> is not represented in the shared model; the original XML is preserved.`,
          { path }
        );
      }
      stack.push({ node: child, path, depth });
    }
  }
}

function parsePitch(note: OrderedNode): string | null | undefined {
  if (firstChild(note, 'rest')) return null;
  const pitch = firstChild(note, 'pitch');
  if (!pitch) return undefined;
  const step = childText(pitch, 'step')?.trim().toUpperCase();
  const octave = parseInteger(childText(pitch, 'octave'));
  const alter = numericText(pitch, 'alter') ?? 0;
  if (!step || !/^[A-G]$/.test(step) || octave === undefined) return undefined;
  if (!Number.isInteger(alter) || Math.abs(alter) > 2) return undefined;
  const accidental =
    alter > 0 ? '#'.repeat(alter) : 'b'.repeat(Math.abs(alter));
  return `${step}${accidental}${octave}`;
}

function parseClef(
  node: OrderedNode,
  warnings: ScoreImportWarning[],
  partId: string
): ScoreClef {
  const sign = childText(node, 'sign')?.trim().toUpperCase();
  const line = parseInteger(childText(node, 'line'));
  const octaveChangeText = childText(node, 'clef-octave-change')?.trim();
  const octaveChange = parseInteger(octaveChangeText);
  const hasNoEffectiveOctaveChange =
    octaveChangeText === undefined || octaveChange === 0;
  if (sign === 'G' && line === 2 && octaveChange === -1) return 'treble8vb';
  if (sign === 'G' && line === 2 && hasNoEffectiveOctaveChange) {
    return 'treble';
  }
  if (sign === 'F' && line === 4 && hasNoEffectiveOctaveChange) return 'bass';
  issue(
    warnings,
    'UNSUPPORTED_CLEF_PRESERVED',
    `Clef ${sign ?? 'unknown'}${line ? ` on line ${line}` : ''}${octaveChangeText === undefined ? '' : ` with octave change ${octaveChangeText}`} is not represented; the original XML is preserved and treble is used in the model.`,
    { partId, path: '/score-partwise/part/measure/attributes/clef' }
  );
  return 'treble';
}

function clefSourceSignature(node: OrderedNode): string {
  const sign = childText(node, 'sign')?.trim().toUpperCase() ?? '';
  const lineText = childText(node, 'line')?.trim();
  const octaveChangeText = childText(node, 'clef-octave-change')?.trim();
  const line = parseInteger(lineText) ?? lineText ?? '';
  const octaveChange = parseInteger(octaveChangeText) ?? octaveChangeText ?? '';
  const staffNumber = parseInteger(attribute(node, 'number')) ?? 1;
  return JSON.stringify([sign, line, octaveChange, staffNumber]);
}

function parseNote(
  node: OrderedNode,
  divisions: number,
  cursor: number,
  previousOnset: number,
  partId: string,
  measureNumber: number,
  noteIndex: number,
  warnings: ScoreImportWarning[]
): { note?: ScoreNoteInput; nextCursor: number; onset: number } {
  if (firstChild(node, 'grace')) {
    issue(
      warnings,
      'UNSUPPORTED_GRACE_NOTE_PRESERVED',
      'Grace note is not represented in the model; the original XML is preserved.',
      { partId, measure: measureNumber, noteIndex }
    );
    return { nextCursor: cursor, onset: previousOnset };
  }

  const durationTicks = numericText(node, 'duration');
  const pitch = parsePitch(node);
  if (
    durationTicks === undefined ||
    durationTicks <= 0 ||
    divisions <= 0 ||
    pitch === undefined
  ) {
    issue(
      warnings,
      pitch === undefined
        ? 'UNSUPPORTED_PITCH_PRESERVED'
        : 'UNSUPPORTED_CONSTRUCT_PRESERVED',
      'This note is not represented in the shared model; the original XML is preserved.',
      { partId, measure: measureNumber, noteIndex }
    );
    return { nextCursor: cursor, onset: previousOnset };
  }

  const chord = Boolean(firstChild(node, 'chord'));
  const onset = chord ? previousOnset : cursor;
  const duration = durationTicks / divisions;
  const voice = childText(node, 'voice')?.trim() || '1';
  const staff = parseInteger(childText(node, 'staff')) ?? 1;
  const noteTies = children(node, 'tie');
  const notationTies = children(firstChild(node, 'notations'), 'tied');
  if (
    [...noteTies, ...notationTies].some(
      (tie) => attribute(tie, 'type') === 'stop'
    )
  ) {
    issue(
      warnings,
      'UNSUPPORTED_CONSTRUCT_PRESERVED',
      'Tie-stop notation is not represented independently; the original XML is preserved.',
      { partId, measure: measureNumber, noteIndex }
    );
  }
  const tieStarts = noteTies.some((tie) => attribute(tie, 'type') === 'start');
  const tieStartsInNotation = notationTies.some(
    (tie) => attribute(tie, 'type') === 'start'
  );

  const lyricNodes = children(node, 'lyric');
  const parsedLyrics = lyricNodes.map((lyricNode, index) => {
    const text = childText(lyricNode, 'text') ?? '';
    const syllabic = scoreSyllabicSchema.safeParse(
      childText(lyricNode, 'syllabic')?.trim()
    );
    const verseNumber = parseInteger(attribute(lyricNode, 'number'));
    const verse =
      verseNumber !== undefined && verseNumber > 0 && verseNumber <= 64
        ? verseNumber
        : lyricNodes.length > 1
          ? index + 1
          : undefined;
    return {
      text,
      ...(syllabic.success ? { syllabic: syllabic.data } : {}),
      ...(verse ? { verse } : {}),
    };
  });
  const lyric = parsedLyrics[0];

  const timeModification = firstChild(node, 'time-modification');
  const actualNotes = parseInteger(childText(timeModification, 'actual-notes'));
  const normalNotes = parseInteger(childText(timeModification, 'normal-notes'));
  const normalTypeValue = childText(timeModification, 'normal-type')?.trim();
  const normalType = z
    .enum(['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th'])
    .safeParse(normalTypeValue);
  const tuplet =
    actualNotes && actualNotes > 0 && normalNotes && normalNotes > 0
      ? {
          actualNotes,
          normalNotes,
          ...(normalType.success ? { normalType: normalType.data } : {}),
        }
      : undefined;

  const modelNote: ScoreNoteInput = {
    pitch,
    dur: duration,
    tie: tieStarts || tieStartsInNotation,
    voice,
    staff,
    onset,
    chord,
    ...(lyric ? { lyric } : {}),
    ...(parsedLyrics.length > 1 ? { lyrics: parsedLyrics } : {}),
    ...(tuplet ? { tuplet } : {}),
  };
  return {
    note: modelNote,
    nextCursor: chord ? cursor : cursor + duration,
    onset,
  };
}

function parseMusicXmlKey(
  node: OrderedNode | undefined,
  warnings?: ScoreImportWarning[],
  partId?: string
): ScoreKey {
  const fifthsValue = numericText(node, 'fifths');
  const modeValue = childText(node, 'mode')?.trim().toLowerCase() || 'major';
  const parsedMode = scoreKeyModeSchema.safeParse(modeValue);
  const fifths =
    fifthsValue !== undefined &&
    Number.isInteger(fifthsValue) &&
    fifthsValue >= -7 &&
    fifthsValue <= 7
      ? fifthsValue
      : 0;
  if (node && warnings && !parsedMode.success) {
    issue(
      warnings,
      'UNSUPPORTED_KEY_MODE_PRESERVED',
      `Key mode ${modeValue} is not represented; original XML is preserved and major is used in the model.`,
      { partId }
    );
  }
  return { fifths, mode: parsedMode.success ? parsedMode.data : 'major' };
}

function sameScoreKey(left: ScoreKey, right: ScoreKey): boolean {
  return left.fifths === right.fifths && left.mode === right.mode;
}

type GlobalScoreSettings = {
  key: ScoreKey;
  beats: number;
  beatType: number;
};

function readKeyAndTime(
  root: OrderedNode,
  warnings: ScoreImportWarning[]
): GlobalScoreSettings {
  let result: GlobalScoreSettings | undefined;
  const initialKeyByPart = new Set<string>();
  for (const part of children(root, 'part')) {
    const partId = attribute(part, 'id');
    const partKeyId = partId ?? `part-${initialKeyByPart.size}`;
    for (const [measureIndex, measure] of children(part, 'measure').entries()) {
      const attributes = firstChild(measure, 'attributes');
      if (!attributes) continue;
      const keyNode = firstChild(attributes, 'key');
      const time = firstChild(attributes, 'time');
      if (!keyNode && !time) continue;

      const key = parseMusicXmlKey(keyNode, warnings, partId);
      const beatsValue = childText(time, 'beats')?.trim();
      const beats = parseInteger(beatsValue);
      const beatType = parseInteger(childText(time, 'beat-type'));
      if (time && (!beats || beats < 1 || !beatType || beatType < 1)) {
        issue(
          warnings,
          'UNSUPPORTED_TIME_SIGNATURE_PRESERVED',
          'Additive or senza-misura time is not represented; original XML is preserved and 4/4 is used in the model.',
          { partId }
        );
      }
      const candidate = {
        key,
        beats: beats && beats > 0 ? beats : 4,
        beatType: beatType && beatType > 0 ? beatType : 4,
      };
      const isFirstKeyForPart =
        Boolean(keyNode) && !initialKeyByPart.has(partKeyId);
      if (keyNode) initialKeyByPart.add(partKeyId);
      if (!result) {
        result = candidate;
      } else {
        const initialPartKeyMismatch =
          isFirstKeyForPart &&
          measureIndex === 0 &&
          !sameScoreKey(result.key, candidate.key);
        const timeMismatch =
          Boolean(time) &&
          (result.beats !== candidate.beats ||
            result.beatType !== candidate.beatType);
        if (initialPartKeyMismatch || timeMismatch) {
          issue(
            warnings,
            'MID_SCORE_ATTRIBUTES_PRESERVED',
            initialPartKeyMismatch
              ? 'Parts begin with different key signatures; the original XML is preserved.'
              : 'Mid-score time-signature changes are not represented globally; original XML is preserved.',
            { partId }
          );
        }
      }
    }
  }
  return (
    result ?? {
      key: { fifths: 0, mode: 'major' },
      beats: 4,
      beatType: 4,
    }
  );
}

function readKeyChanges(
  root: OrderedNode,
  initialKey: ScoreKey,
  warnings: ScoreImportWarning[]
): Map<number, ScoreKey> {
  const parts = children(root, 'part');
  const measureCount = Math.max(
    0,
    ...parts.map((part) => children(part, 'measure').length)
  );
  const changes = new Map<number, ScoreKey>();
  let activeKey = initialKey;
  for (let measureIndex = 0; measureIndex < measureCount; measureIndex += 1) {
    const candidates = parts.flatMap((part) => {
      const measure = children(part, 'measure')[measureIndex];
      const keyNode = firstChild(firstChild(measure, 'attributes'), 'key');
      return keyNode ? [parseMusicXmlKey(keyNode)] : [];
    });
    if (!candidates.length) continue;
    const nextKey = candidates[0]!;
    if (candidates.some((candidate) => !sameScoreKey(candidate, nextKey))) {
      issue(
        warnings,
        'MID_SCORE_ATTRIBUTES_PRESERVED',
        'Parts declare different key signatures in the same measure; the original XML is preserved.',
        { measure: measureIndex + 1 }
      );
    }
    if (!sameScoreKey(activeKey, nextKey)) {
      activeKey = nextKey;
      if (measureIndex > 0) changes.set(measureIndex, nextKey);
    }
  }
  return changes;
}

function parseMetronomeTempo(
  metronome: OrderedNode,
  warnings: ScoreImportWarning[],
  partId: string | undefined
): number | undefined {
  const perMinuteText = childText(metronome, 'per-minute')?.trim();
  if (perMinuteText === undefined) return undefined;

  const beatUnit = childText(metronome, 'beat-unit')?.trim().toLowerCase();
  const quarterUnitsByBeatUnit: Record<string, number> = {
    longa: 16,
    breve: 8,
    whole: 4,
    half: 2,
    quarter: 1,
    eighth: 0.5,
    '16th': 0.25,
    '32nd': 0.125,
    '64th': 0.0625,
    '128th': 0.03125,
    '256th': 0.015625,
    '512th': 0.0078125,
    '1024th': 0.00390625,
  };
  const baseQuarterUnits = beatUnit
    ? quarterUnitsByBeatUnit[beatUnit]
    : undefined;
  const dots = children(metronome, 'beat-unit-dot').length;
  const dotFactor = dots === 0 ? 1 : 2 - 1 / 2 ** dots;
  const perMinute = Number(perMinuteText);
  const quarterTempo =
    baseQuarterUnits === undefined
      ? Number.NaN
      : perMinute * baseQuarterUnits * dotFactor;
  const roundedTempo = Math.round(quarterTempo);
  if (
    Number.isFinite(quarterTempo) &&
    Math.abs(quarterTempo - roundedTempo) < 1e-8 &&
    roundedTempo >= 20 &&
    roundedTempo <= 300
  ) {
    return roundedTempo;
  }

  issue(
    warnings,
    'UNSUPPORTED_TEMPO_PRESERVED',
    'Metronome beat-unit/per-minute cannot be represented as an integer from 20 to 300 quarter-note BPM; the source is preserved and 90 BPM is used in the model when no supported tempo is available.',
    {
      partId,
      path: '/score-partwise/part/measure/direction/direction-type/metronome',
    }
  );
  return undefined;
}

function parseTempo(root: OrderedNode, warnings: ScoreImportWarning[]): number {
  let firstTempo: number | undefined;
  let warnedAdditionalTempo = false;
  for (const part of children(root, 'part')) {
    const partId = attribute(part, 'id');
    for (const measure of children(part, 'measure')) {
      for (const direction of children(measure, 'direction')) {
        let soundTempo: number | undefined;
        const sound = firstChild(direction, 'sound');
        const soundTempoText = attribute(sound, 'tempo')?.trim();
        if (soundTempoText !== undefined) {
          const parsedSoundTempo = Number(soundTempoText);
          if (
            Number.isInteger(parsedSoundTempo) &&
            parsedSoundTempo >= 20 &&
            parsedSoundTempo <= 300
          ) {
            soundTempo = parsedSoundTempo;
          } else {
            issue(
              warnings,
              'UNSUPPORTED_TEMPO_PRESERVED',
              'Sound tempo is not an integer from 20 to 300 BPM; the source is preserved and 90 BPM is used in the model when no supported tempo is available.',
              {
                partId,
                path: '/score-partwise/part/measure/direction/sound/@tempo',
              }
            );
          }
        }

        const directionTempos = soundTempo === undefined ? [] : [soundTempo];
        let matchedSoundMetronome = false;
        for (const directionType of children(direction, 'direction-type')) {
          for (const metronome of children(directionType, 'metronome')) {
            const metronomeTempo = parseMetronomeTempo(
              metronome,
              warnings,
              partId
            );
            if (metronomeTempo === undefined) continue;
            if (soundTempo === metronomeTempo && !matchedSoundMetronome) {
              matchedSoundMetronome = true;
              continue;
            }
            directionTempos.push(metronomeTempo);
          }
        }

        for (const directionTempo of directionTempos) {
          if (firstTempo === undefined) {
            firstTempo = directionTempo;
          } else if (!warnedAdditionalTempo) {
            issue(
              warnings,
              'ADDITIONAL_TEMPO_MARKING_PRESERVED',
              'Additional tempo markings are not represented in the shared model; the original XML is preserved.',
              {
                partId,
                measure: parseInteger(attribute(measure, 'number')),
                path: '/score-partwise/part/measure/direction',
              }
            );
            warnedAdditionalTempo = true;
          }
        }
      }
    }
  }
  return firstTempo ?? 90;
}

function buildPart(
  part: OrderedNode,
  partNames: Map<string, string>,
  partIndex: number,
  keyChanges: Map<number, ScoreKey>,
  warnings: ScoreImportWarning[]
): ScoreModelInput['parts'][number] {
  const partId = attribute(part, 'id') || `P${partIndex + 1}`;
  const partName = partNames.get(partId)?.trim();
  let divisions = 1;
  let clef: ScoreClef = 'treble';
  let activeClefSignature: string | undefined;
  let sawNote = false;
  let warnedMidScoreClefChange = false;
  const measures = children(part, 'measure').map((measure, measureIndex) => {
    const measureNumber =
      parseInteger(attribute(measure, 'number')) ?? measureIndex + 1;
    let cursor = 0;
    let previousOnset = 0;
    let noteIndex = 0;
    const notes: ScoreNoteInput[] = [];

    for (const event of elementChildren(measure)) {
      const name = tagName(event);
      if (name === 'attributes') {
        const nextDivisions = numericText(event, 'divisions');
        if (nextDivisions && nextDivisions > 0) divisions = nextDivisions;
        for (const clefNode of children(event, 'clef')) {
          const signature = clefSourceSignature(clefNode);
          const parsedClef = parseClef(clefNode, warnings, partId);
          if (activeClefSignature === undefined) {
            activeClefSignature = signature;
            clef = parsedClef;
            if (sawNote && !warnedMidScoreClefChange) {
              issue(
                warnings,
                'MID_SCORE_CLEF_CHANGE_PRESERVED',
                'A clef first introduced after musical content is not represented over time; the original XML is preserved.',
                {
                  partId,
                  measure: measureNumber,
                  path: '/score-partwise/part/measure/attributes/clef',
                }
              );
              warnedMidScoreClefChange = true;
            }
          } else if (signature !== activeClefSignature) {
            if (!warnedMidScoreClefChange) {
              issue(
                warnings,
                'MID_SCORE_CLEF_CHANGE_PRESERVED',
                'Mid-score clef changes are not represented over time; the original XML is preserved.',
                {
                  partId,
                  measure: measureNumber,
                  path: '/score-partwise/part/measure/attributes/clef',
                }
              );
              warnedMidScoreClefChange = true;
            }
            activeClefSignature = signature;
          }
        }
      } else if (name === 'backup' || name === 'forward') {
        const ticks = Number(rawText(event)?.trim() ?? 0);
        const amount = (Number.isFinite(ticks) ? ticks : 0) / divisions;
        cursor =
          name === 'backup' ? Math.max(0, cursor - amount) : cursor + amount;
        previousOnset = cursor;
      } else if (name === 'note') {
        sawNote = true;
        const parsed = parseNote(
          event,
          divisions,
          cursor,
          previousOnset,
          partId,
          measureNumber,
          noteIndex,
          warnings
        );
        if (parsed.note) {
          notes.push(parsed.note);
          previousOnset = parsed.onset;
          noteIndex += 1;
        }
        cursor = parsed.nextCursor;
      }
    }
    const key = keyChanges.get(measureIndex);
    return { number: measureNumber, notes, ...(key ? { key } : {}) };
  });

  if (!measures.length) {
    throw new MusicXmlConversionError(
      'INVALID_SCORE',
      `MusicXML part ${partId} has no measures.`
    );
  }
  return {
    id: partId,
    ...(partName ? { name: partName } : {}),
    clef,
    measures,
  };
}

function snapshot(model: ScoreModel): string {
  return JSON.stringify(scoreModelWireSchema.parse(model));
}

function xmlForSecureParsing(xml: string): string {
  if (/<!\s*ENTITY\b/i.test(xml)) {
    throw new MusicXmlConversionError(
      'DOCTYPE_NOT_ALLOWED',
      'Entity declarations are not allowed in MusicXML.'
    );
  }
  const doctype = /<!DOCTYPE\b[^>]*>/i.exec(xml);
  if (!doctype) return xml;
  const standardMusicXmlDoctype =
    /^<!DOCTYPE\s+score-partwise\s+PUBLIC\s+["']-\/\/Recordare\/\/DTD MusicXML \d+(?:\.\d+)? Partwise\/\/EN["']\s+["']https?:\/\/www\.musicxml\.org\/dtds\/partwise\.dtd["']\s*>$/is;
  if (doctype[0].includes('[') || !standardMusicXmlDoctype.test(doctype[0])) {
    throw new MusicXmlConversionError(
      'DOCTYPE_NOT_ALLOWED',
      'Only the standard external MusicXML partwise DTD is accepted; it is never fetched or processed.'
    );
  }
  const withoutDoctype = xml.replace(doctype[0], '');
  if (/<!DOCTYPE\b/i.test(withoutDoctype)) {
    throw new MusicXmlConversionError(
      'DOCTYPE_NOT_ALLOWED',
      'Multiple DOCTYPE declarations are not allowed.'
    );
  }
  return withoutDoctype;
}

function enforceXmlDepthLimit(xml: string): void {
  let position = 0;
  let depth = 0;
  while (position < xml.length) {
    const start = xml.indexOf('<', position);
    if (start < 0) return;
    if (xml.startsWith('<!--', start)) {
      const end = xml.indexOf('-->', start + 4);
      if (end < 0) return;
      position = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', start)) {
      const end = xml.indexOf(']]>', start + 9);
      if (end < 0) return;
      position = end + 3;
      continue;
    }
    if (xml.startsWith('<?', start)) {
      const end = xml.indexOf('?>', start + 2);
      if (end < 0) return;
      position = end + 2;
      continue;
    }

    let quote: string | undefined;
    let end = start + 1;
    for (; end < xml.length; end += 1) {
      const character = xml[end]!;
      if (quote) {
        if (character === quote) quote = undefined;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        break;
      }
    }
    if (end >= xml.length) return;
    const token = xml.slice(start + 1, end).trim();
    if (!token.startsWith('!')) {
      if (token.startsWith('/')) {
        depth = Math.max(0, depth - 1);
      } else if (!/\/\s*$/.test(token)) {
        depth += 1;
        if (depth > MAX_XML_ELEMENT_DEPTH) {
          throw new MusicXmlConversionError(
            'XML_DEPTH_LIMIT',
            `MusicXML exceeds the ${MAX_XML_ELEMENT_DEPTH}-element nesting limit.`
          );
        }
      }
    }
    position = end + 1;
  }
}

/** Convert partwise MusicXML text into the shared score model. */
export function musicXmlToModel(xml: string): MusicXmlConversionResult {
  if (new TextEncoder().encode(xml).byteLength > MAX_MUSICXML_BYTES) {
    throw new MusicXmlConversionError(
      'FILE_TOO_LARGE',
      `MusicXML exceeds the ${MAX_MUSICXML_BYTES}-byte limit.`
    );
  }
  const parseInput = xmlForSecureParsing(xml);
  enforceXmlDepthLimit(parseInput);
  if (
    XMLValidator.validate(parseInput, { allowBooleanAttributes: false }) !==
    true
  ) {
    throw new MusicXmlConversionError(
      'MALFORMED_XML',
      'MusicXML is not well-formed XML.'
    );
  }

  let parsed: unknown;
  try {
    parsed = parser.parse(parseInput);
  } catch {
    throw new MusicXmlConversionError(
      'MALFORMED_XML',
      'MusicXML could not be parsed.'
    );
  }
  const root = Array.isArray(parsed)
    ? (parsed as OrderedNode[]).find(
        (node) => tagName(node) === 'score-partwise'
      )
    : undefined;
  if (!root) {
    throw new MusicXmlConversionError(
      'UNSUPPORTED_ROOT',
      'Only MusicXML score-partwise documents are supported.'
    );
  }
  const parts = children(root, 'part');
  if (parts.length === 0) {
    throw new MusicXmlConversionError(
      'NO_PARTS',
      'MusicXML must contain at least one part.'
    );
  }

  const warnings: ScoreImportWarning[] = [];
  collectUnsupported(root, warnings);
  const partNames = new Map<string, string>();
  const partList = firstChild(root, 'part-list');
  for (const scorePart of children(partList, 'score-part')) {
    const id = attribute(scorePart, 'id');
    const name = childText(scorePart, 'part-name')?.trim();
    if (id && name) partNames.set(id, name);
  }

  const work = firstChild(root, 'work');
  const identification = firstChild(root, 'identification');
  const workTitles = children(work, 'work-title')
    .map((node) => rawText(node)?.trim() ?? '')
    .filter(Boolean);
  const movementTitles = children(root, 'movement-title')
    .map((node) => rawText(node)?.trim() ?? '')
    .filter(Boolean);
  const title = workTitles[0] ?? movementTitles[0] ?? 'Untitled score';
  const hasAdditionalTitle =
    workTitles.length > 1 ||
    movementTitles.length > (workTitles.length > 0 ? 0 : 1);
  if (hasAdditionalTitle) {
    issue(
      warnings,
      'ADDITIONAL_TITLE_PRESERVED',
      'Additional work or movement title values are not represented separately; the original XML is preserved.',
      {
        path:
          workTitles.length > 1
            ? '/score-partwise/work/work-title'
            : '/score-partwise/movement-title',
      }
    );
  }

  const creatorNodes = children(identification, 'creator');
  const composerNode = creatorNodes.find(
    (creator) =>
      attribute(creator, 'type')?.toLowerCase() === 'composer' &&
      Boolean(rawText(creator)?.trim())
  );
  const composer = rawText(composerNode)?.trim() || null;
  for (const creator of creatorNodes) {
    if (creator === composerNode || !rawText(creator)?.trim()) continue;
    const creatorType = attribute(creator, 'type')?.trim() || 'unspecified';
    issue(
      warnings,
      'UNMODELED_CREATOR_CREDIT_PRESERVED',
      `Creator credit type ${creatorType} is not represented separately; the original XML is preserved.`,
      { path: '/score-partwise/identification/creator' }
    );
  }
  const settings = readKeyAndTime(root, warnings);
  const keyChanges = readKeyChanges(root, settings.key, warnings);
  const modelWithoutPreservation = scoreModelSchema.safeParse({
    title,
    composer,
    key: settings.key,
    time: { beats: settings.beats, beatType: settings.beatType },
    tempo: parseTempo(root, warnings),
    parts: parts.map((part, index) =>
      buildPart(part, partNames, index, keyChanges, warnings)
    ),
  });
  if (!modelWithoutPreservation.success) {
    throw new MusicXmlConversionError(
      'INVALID_SCORE',
      'MusicXML could not be represented by the shared score model.'
    );
  }

  const preservationStatus = scorePreservationFromWarnings(warnings);
  const model = preservedScoreModelSchema.parse({
    ...modelWithoutPreservation.data,
    preservation: {
      sourceXml: xml,
      modelSnapshot: snapshot(modelWithoutPreservation.data),
      requiresSourcePreservation:
        preservationStatus.state === 'opaque_constructs_preserved',
    },
  });
  return musicXmlConversionResultSchema.parse({
    model,
    warnings,
    preservation: preservationStatus,
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function pitchComponents(pitch: string): {
  step: string;
  alter: number;
  octave: number;
} {
  const match = /^([A-G])((?:#{1,2}|b{1,2})?)(-?\d+)$/.exec(pitch);
  if (!match)
    throw new MusicXmlConversionError(
      'INVALID_SCORE',
      'Invalid scientific pitch.'
    );
  const accidental = match[2] ?? '';
  return {
    step: match[1]!,
    alter: accidental.startsWith('#')
      ? accidental.length
      : accidental.startsWith('b')
        ? -accidental.length
        : 0,
    octave: Number(match[3]),
  };
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right !== 0) [left, right] = [right, left % right];
  return left || 1;
}

function rationalDenominator(value: number): number {
  for (let denominator = 1; denominator <= 4096; denominator += 1) {
    if (
      Math.abs(value * denominator - Math.round(value * denominator)) < 1e-8
    ) {
      return denominator;
    }
  }
  return MAX_DIVISIONS;
}

function musicXmlTicks(
  value: number,
  divisions: number,
  label: string
): number {
  const scaled = value * divisions;
  const ticks = Math.round(scaled);
  if (
    !Number.isSafeInteger(ticks) ||
    Math.abs(scaled - ticks) > 1e-8 ||
    (value > 0 && ticks === 0)
  ) {
    throw new MusicXmlConversionError(
      'UNREPRESENTABLE_DURATION',
      `${label} ${value} cannot be represented as an exact, nonzero MusicXML tick count with at most ${MAX_DIVISIONS} divisions per quarter.`
    );
  }
  return ticks;
}

function divisionsFor(model: ScoreModel): number {
  let divisions = 1;
  for (const part of model.parts) {
    for (const measure of part.measures) {
      for (const note of measure.notes) {
        for (const value of [note.dur, note.onset ?? 0]) {
          const denominator = rationalDenominator(value);
          const next =
            (divisions / greatestCommonDivisor(divisions, denominator)) *
            denominator;
          divisions = Math.min(MAX_DIVISIONS, next);
        }
      }
    }
  }
  for (const part of model.parts) {
    for (const measure of part.measures) {
      for (const note of measure.notes) {
        musicXmlTicks(note.dur, divisions, 'Note duration');
        if (note.onset !== undefined) {
          musicXmlTicks(note.onset, divisions, 'Note onset');
        }
      }
    }
  }
  return divisions;
}

function durationNotation(duration: number): { type?: string; dots: number } {
  const choices: Array<[number, string, number]> = [
    [6, 'whole', 1],
    [4, 'whole', 0],
    [3, 'half', 1],
    [2, 'half', 0],
    [1.5, 'quarter', 1],
    [1, 'quarter', 0],
    [0.75, 'eighth', 1],
    [0.5, 'eighth', 0],
    [0.375, '16th', 1],
    [0.25, '16th', 0],
    [0.1875, '32nd', 1],
    [0.125, '32nd', 0],
    [0.09375, '64th', 1],
    [0.0625, '64th', 0],
  ];
  const match = choices.find(
    ([value]) => Math.abs(duration - value) < 0.000001
  );
  return match ? { type: match[1], dots: match[2] } : { dots: 0 };
}

function textTag(tag: string, value: string | number): string {
  return `<${tag}>${escapeXml(String(value))}</${tag}>`;
}

function clefLines(clef: ScoreClef, indent: string): string[] {
  if (clef === 'bass') {
    return [
      `${indent}<clef>`,
      `${indent}  <sign>F</sign>`,
      `${indent}  <line>4</line>`,
      `${indent}</clef>`,
    ];
  }
  const lines = [
    `${indent}<clef>`,
    `${indent}  <sign>G</sign>`,
    `${indent}  <line>2</line>`,
  ];
  if (clef === 'treble8vb')
    lines.push(`${indent}  <clef-octave-change>-1</clef-octave-change>`);
  lines.push(`${indent}</clef>`);
  return lines;
}

function keyLines(key: ScoreKey, indent: string): string[] {
  return [
    `${indent}<key>`,
    `${indent}  ${textTag('fifths', key.fifths)}`,
    `${indent}  ${textTag('mode', key.mode)}`,
    `${indent}</key>`,
  ];
}

function attributesLines(
  model: ScoreModel,
  clef: ScoreClef,
  divisions: number,
  key: ScoreKey = model.key
): string[] {
  return [
    '      <attributes>',
    `        ${textTag('divisions', divisions)}`,
    ...keyLines(key, '        '),
    '        <time>',
    `          ${textTag('beats', model.time.beats)}`,
    `          ${textTag('beat-type', model.time.beatType)}`,
    '        </time>',
    ...clefLines(clef, '        '),
    '      </attributes>',
  ];
}

function noteLines(
  note: ScoreModel['parts'][number]['measures'][number]['notes'][number],
  divisions: number,
  indent: string
): string[] {
  const lines = [`${indent}<note>`];
  if (note.chord) lines.push(`${indent}  <chord/>`);
  if (note.pitch === null) {
    lines.push(`${indent}  <rest/>`);
  } else {
    const pitch = pitchComponents(note.pitch);
    lines.push(
      `${indent}  <pitch>`,
      `${indent}    ${textTag('step', pitch.step)}`
    );
    if (pitch.alter !== 0)
      lines.push(`${indent}    ${textTag('alter', pitch.alter)}`);
    lines.push(
      `${indent}    ${textTag('octave', pitch.octave)}`,
      `${indent}  </pitch>`
    );
  }
  lines.push(
    `${indent}  ${textTag('duration', musicXmlTicks(note.dur, divisions, 'Note duration'))}`
  );
  if (note.tie) lines.push(`${indent}  <tie type="start"/>`);
  lines.push(`${indent}  ${textTag('voice', note.voice)}`);

  const nominalDuration = note.tuplet
    ? (note.dur * note.tuplet.actualNotes) / note.tuplet.normalNotes
    : note.dur;
  const notation = durationNotation(nominalDuration);
  const type = notation.type;
  if (type) lines.push(`${indent}  ${textTag('type', type)}`);
  for (let dot = 0; dot < notation.dots; dot += 1)
    lines.push(`${indent}  <dot/>`);
  if (note.tuplet) {
    lines.push(
      `${indent}  <time-modification>`,
      `${indent}    ${textTag('actual-notes', note.tuplet.actualNotes)}`,
      `${indent}    ${textTag('normal-notes', note.tuplet.normalNotes)}`,
      ...(note.tuplet.normalType
        ? [`${indent}    ${textTag('normal-type', note.tuplet.normalType)}`]
        : []),
      `${indent}  </time-modification>`
    );
  }
  const lyricVerses = note.lyrics?.length
    ? note.lyrics
    : note.lyric
      ? [note.lyric]
      : [];
  lyricVerses.forEach((lyric, index) => {
    const verse =
      lyric.verse ?? (lyricVerses.length > 1 ? index + 1 : undefined);
    lines.push(`${indent}  <lyric${verse ? ` number="${verse}"` : ''}>`);
    if (lyric.syllabic) {
      lines.push(`${indent}    ${textTag('syllabic', lyric.syllabic)}`);
    }
    lines.push(
      `${indent}    ${textTag('text', lyric.text)}`,
      `${indent}  </lyric>`
    );
  });
  if (note.tie) {
    lines.push(
      `${indent}  <notations>`,
      `${indent}    <tied type="start"/>`,
      `${indent}  </notations>`
    );
  }
  lines.push(`${indent}  ${textTag('staff', note.staff)}`, `${indent}</note>`);
  return lines;
}

function measureEventLines(
  measure: ScoreModel['parts'][number]['measures'][number],
  divisions: number
): string[] {
  const lines: string[] = [];
  let cursor = 0;
  let previousOnset = 0;
  for (const note of measure.notes) {
    const onset = note.chord
      ? (note.onset ?? previousOnset)
      : (note.onset ?? cursor);
    if (note.chord) {
      if (Math.abs(onset - previousOnset) > 0.000001) {
        throw new MusicXmlConversionError(
          'INVALID_SCORE',
          'A chord member must share the previous onset.'
        );
      }
    } else if (onset < cursor - 0.000001) {
      lines.push(
        '      <backup>',
        `        ${textTag('duration', musicXmlTicks(cursor - onset, divisions, 'Backup duration'))}`,
        '      </backup>'
      );
      cursor = onset;
    } else if (onset > cursor + 0.000001) {
      lines.push(
        '      <forward>',
        `        ${textTag('duration', musicXmlTicks(onset - cursor, divisions, 'Forward duration'))}`,
        '      </forward>'
      );
      cursor = onset;
    }
    lines.push(...noteLines(note, divisions, '      '));
    if (!note.chord) {
      previousOnset = onset;
      cursor = onset + note.dur;
    }
  }
  return lines;
}

function canonicalMusicXml(model: ScoreModel): string {
  const divisions = divisionsFor(model);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<score-partwise version="4.0">',
    '  <work>',
    `    ${textTag('work-title', model.title)}`,
    '  </work>',
  ];
  if (model.composer) {
    lines.push(
      '  <identification>',
      `    <creator type="composer">${escapeXml(model.composer)}</creator>`,
      '  </identification>'
    );
  }
  lines.push('  <part-list>');
  for (const part of model.parts) {
    lines.push(
      `    <score-part id="${escapeXml(part.id)}">`,
      `      ${textTag('part-name', part.name ?? part.id)}`,
      '    </score-part>'
    );
  }
  lines.push('  </part-list>');

  for (const [partIndex, part] of model.parts.entries()) {
    lines.push(`  <part id="${escapeXml(part.id)}">`);
    for (const [measureIndex, measure] of part.measures.entries()) {
      lines.push(`    <measure number="${measure.number}">`);
      if (measureIndex === 0) {
        lines.push(
          ...attributesLines(
            model,
            part.clef,
            divisions,
            measure.key ?? model.key
          )
        );
      } else if (measure.key) {
        lines.push(
          '      <attributes>',
          ...keyLines(measure.key, '        '),
          '      </attributes>'
        );
      }
      if (partIndex === 0 && measureIndex === 0) {
        lines.push(
          '      <direction>',
          '        <direction-type>',
          '          <metronome>',
          `            ${textTag('beat-unit', 'quarter')}`,
          `            ${textTag('per-minute', model.tempo)}`,
          '          </metronome>',
          '        </direction-type>',
          `        <sound tempo="${model.tempo}"/>`,
          '      </direction>'
        );
      }
      lines.push(...measureEventLines(measure, divisions));
      lines.push('    </measure>');
    }
    lines.push('  </part>');
  }
  lines.push('</score-partwise>');
  return `${lines.join('\n')}\n`;
}

/** Export canonical MusicXML for new models; unchanged imports use source passthrough. */
export function modelToMusicXml(
  modelInput: ScoreModel | PreservedScoreModel,
  options?: ModelToMusicXmlOptions
): string {
  const parsedOptions = options
    ? modelToMusicXmlOptionsSchema.parse(options)
    : undefined;
  const parsed = preservedScoreModelSchema.parse(modelInput);
  const { preservation, ...content } = parsed;
  const model = scoreModelSchema.parse(content);
  if (preservation) {
    const unchanged = snapshot(model) === preservation.modelSnapshot;
    if (unchanged) return preservation.sourceXml;
    if (preservation.requiresSourcePreservation) {
      throw new MusicXmlConversionError(
        'PRESERVATION_CONTEXT_CHANGED',
        'This imported score is read-only because it contains MusicXML constructs outside the shared model; restore the unchanged source model or keep the original MusicXML.'
      );
    }
  } else if (!parsedOptions) {
    throw new MusicXmlConversionError(
      'SOURCE_PROVENANCE_REQUIRED',
      'No source-preservation context is available. Pass { mode: "new-score" } only when creating MusicXML from a model that is not an imported score.'
    );
  }
  const xml = canonicalMusicXml(model);
  if (XMLValidator.validate(xml) !== true) {
    throw new MusicXmlConversionError(
      'INVALID_SCORE',
      'Generated MusicXML failed XML validation.'
    );
  }
  return xml;
}
