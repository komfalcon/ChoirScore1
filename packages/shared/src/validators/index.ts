import {
  DEFAULT_VOICE_RANGES,
  mapScorePartsToVoiceParts,
  voiceRangesForScoreParts,
  type VoicePartId,
  type VoiceRanges,
} from '../voiceRanges.js';
import {
  VoiceMappingError,
  type VoiceMappingFailureKind,
} from '../voiceMappingError.js';
import { midiForPitch } from '../pitch.js';
import type {
  ScoreModel,
  ScoreMeasure,
  ScoreNote,
  ScorePart,
} from '../scoreModel.js';

/** Stable codes shared by current and planned score validators. */
export type ValidationIssueCode =
  | 'MEASURE_DURATION'
  | 'OUT_OF_RANGE'
  | 'VOICE_MAPPING'
  | 'VOICE_CROSSING'
  | 'SPACING'
  | 'PARALLEL_FIFTHS'
  | 'PARALLEL_OCTAVES'
  | 'LARGE_LEAP'
  | 'MELODY_CHANGED'
  | 'ONSET_MISMATCH'
  | 'LYRIC_MISMATCH';

/** A located, user-readable score-validation finding. */
export interface Issue {
  part: string;
  measure: number;
  /** One-based beat position in the time signature's denominator units. */
  beat: number;
  code: ValidationIssueCode;
  message: string;
}

export interface ValidationResult {
  errors: Issue[];
  warnings: Issue[];
}

const DURATION_EPSILON = 1e-9;

const VOICE_MAPPING_MESSAGES: Readonly<
  Record<VoiceMappingFailureKind, string>
> = {
  'duplicate-part-id':
    'Score-part IDs are duplicated; SATB validation was skipped.',
  'conflicting-identities':
    'A score part has conflicting canonical ID and name identities; SATB validation was skipped.',
  'unmapped-part':
    'A score part has no exact canonical SATB identity; SATB validation was skipped.',
  'duplicate-identity':
    'Multiple score parts share a canonical SATB identity; SATB validation was skipped.',
  'noncanonical-profile-key':
    'A voice-range profile key is not canonical SATB; range validation was skipped.',
  'missing-profile-range':
    'A mapped SATB part has no configured range; range validation was skipped.',
};

function comparePartIds(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

/**
 * Locate a score-level mapping failure deterministically without exposing the
 * resolver's exception text or guessing a voice identity. Part-specific errors
 * use that part; multi-part ambiguities use the lowest implicated part ID.
 */
function voiceMappingIssue(model: ScoreModel, error: VoiceMappingError): Issue {
  const lowestMeasure = (part: ScorePart) =>
    Math.min(...part.measures.map((candidate) => candidate.number));
  const implicatedIds = new Set(error.partIds);
  const byLocation = (first: ScorePart, second: ScorePart) =>
    comparePartIds(first.id, second.id) ||
    lowestMeasure(first) - lowestMeasure(second);
  const implicatedParts = model.parts
    .filter((part) => implicatedIds.has(part.id))
    .sort(byLocation);
  const part = implicatedParts[0] ?? [...model.parts].sort(byLocation)[0];
  const measure = part ? lowestMeasure(part) : 1;

  return {
    part: part?.id ?? 'score',
    measure,
    beat: 1,
    code: 'VOICE_MAPPING',
    message: VOICE_MAPPING_MESSAGES[error.kind],
  };
}

function roundedBeat(positionInQuarterNotes: number, beatType: number): number {
  const beat = 1 + (positionInQuarterNotes * beatType) / 4;
  return Math.round(beat * 1_000_000) / 1_000_000;
}

/**
 * Checks each part/measure's timeline extent against the time-signature
 * length, expressed in quarter-note units. Timeline positions follow
 * notePositions: each staff/voice advances independently, chord members share
 * an onset, and the measure extent is the furthest event end, not a sum.
 * A mismatch is located at the first missing or excess duration boundary; the
 * issue's beat is one-based.
 */
export function validateMeasureDuration(model: ScoreModel): ValidationResult {
  const expectedDuration = (model.time.beats * 4) / model.time.beatType;
  const errors: Issue[] = [];

  for (const part of model.parts) {
    for (const measure of part.measures) {
      const actualDuration = notePositions(measure).reduce(
        (furthestEnd, { note, onset }) =>
          Math.max(furthestEnd, onset + note.dur),
        0
      );
      if (Math.abs(actualDuration - expectedDuration) <= DURATION_EPSILON) {
        continue;
      }

      const boundary = Math.min(actualDuration, expectedDuration);
      errors.push({
        part: part.id,
        measure: measure.number,
        beat: roundedBeat(boundary, model.time.beatType),
        code: 'MEASURE_DURATION',
        message: `Measure duration is ${actualDuration} quarter-note units; expected ${expectedDuration}.`,
      });
    }
  }

  return { errors, warnings: [] };
}

interface NotePosition {
  note: ScoreNote;
  onset: number;
}

/**
 * Resolves explicit note onsets and derives omitted ones. Each (staff, voice)
 * timeline advances independently; chord members share the preceding onset.
 * Used by validators that need event positions, including duration and range.
 */
function notePositions(measure: ScoreMeasure): NotePosition[] {
  const nextOnsetByStream = new Map<string, number>();
  const lastOnsetByStream = new Map<string, number>();

  return measure.notes.map((note) => {
    const stream = `${note.staff}\u0000${note.voice}`;
    const nextOnset = nextOnsetByStream.get(stream) ?? 0;
    const onset =
      note.onset ??
      (note.chord ? (lastOnsetByStream.get(stream) ?? nextOnset) : nextOnset);

    if (!note.chord || !lastOnsetByStream.has(stream)) {
      lastOnsetByStream.set(stream, onset);
    }
    nextOnsetByStream.set(stream, Math.max(nextOnset, onset + note.dur));
    return { note, onset };
  });
}

const ADJACENT_VOICE_PARTS: ReadonlyArray<readonly [VoicePartId, VoicePartId]> =
  [
    ['S', 'A'],
    ['A', 'T'],
    ['T', 'B'],
  ];

const ONSET_EPSILON = 1e-9;

interface SoundingPitch {
  pitch: string;
  midi: number;
}

interface SoundingOnset {
  onset: number;
  pitches: SoundingPitch[];
}

/**
 * Groups pitched events by their resolved onset. Rests remain in the source
 * timeline (and therefore advance it) but do not contribute a pitch; each tied
 * note segment is still a separate model event at its own onset.
 */
function soundingPitchesByOnset(measure: ScoreMeasure): SoundingOnset[] {
  const groups: SoundingOnset[] = [];
  const positions = notePositions(measure).sort(
    (first, second) => first.onset - second.onset
  );

  for (const { note, onset } of positions) {
    if (note.pitch === null) continue;

    let group = groups[groups.length - 1];
    if (!group || Math.abs(group.onset - onset) > ONSET_EPSILON) {
      group = { onset, pitches: [] };
      groups.push(group);
    }
    group.pitches.push({ pitch: note.pitch, midi: midiForPitch(note.pitch) });
  }

  return groups;
}

/**
 * Checks PRD §10.4's adjacent SATB ordering rules at shared note onsets.
 * Score-part identity follows the shared exact-ID/canonical-name mapping.
 */
export function validateVoiceCrossing(model: ScoreModel): ValidationResult {
  let mapping: ReturnType<typeof mapScorePartsToVoiceParts>;
  try {
    mapping = mapScorePartsToVoiceParts(model.parts);
  } catch (error) {
    if (!(error instanceof VoiceMappingError)) throw error;
    return { errors: [voiceMappingIssue(model, error)], warnings: [] };
  }
  const partsById = new Map<string, ScorePart>(
    model.parts.map((part) => [part.id, part])
  );
  const errors: Issue[] = [];

  for (const [upperVoice, lowerVoice] of ADJACENT_VOICE_PARTS) {
    const upperPartId = mapping.byVoicePart[upperVoice];
    const lowerPartId = mapping.byVoicePart[lowerVoice];
    if (!upperPartId || !lowerPartId) continue;

    const upperPart = partsById.get(upperPartId)!;
    const lowerPart = partsById.get(lowerPartId)!;
    const lowerMeasures = new Map(
      lowerPart.measures.map((measure) => [measure.number, measure])
    );

    for (const upperMeasure of upperPart.measures) {
      const lowerMeasure = lowerMeasures.get(upperMeasure.number);
      if (!lowerMeasure) continue;

      const lowerOnsets = soundingPitchesByOnset(lowerMeasure);
      for (const upperOnset of soundingPitchesByOnset(upperMeasure)) {
        const lowerOnset = lowerOnsets.find(
          (candidate) =>
            Math.abs(candidate.onset - upperOnset.onset) <= ONSET_EPSILON
        );
        if (!lowerOnset) continue;

        let crossing:
          { upper: SoundingPitch; lower: SoundingPitch } | undefined;
        for (const upperPitch of upperOnset.pitches) {
          const lowerPitch = lowerOnset.pitches.find(
            (candidate) => upperPitch.midi < candidate.midi
          );
          if (lowerPitch) {
            crossing = { upper: upperPitch, lower: lowerPitch };
            break;
          }
        }
        if (!crossing) continue;

        errors.push({
          part: upperPart.id,
          measure: upperMeasure.number,
          beat: roundedBeat(upperOnset.onset, model.time.beatType),
          code: 'VOICE_CROSSING',
          message: `${upperVoice} (${crossing.upper.pitch}) is below ${lowerVoice} (${crossing.lower.pitch}) at a shared onset.`,
        });
      }
    }
  }

  return { errors, warnings: [] };
}

const SPACING_VOICE_PARTS: ReadonlyArray<readonly [VoicePartId, VoicePartId]> =
  [
    ['S', 'A'],
    ['A', 'T'],
  ];

/**
 * Checks the PRD §10.4 S–A and A–T spacing warning for intervals greater than
 * an octave. Where the PRD is silent on temporal alignment, this follows Tom's
 * prior §10.4 planning recommendation: compare only at shared note onsets,
 * reusing the canonical voice mapping and event timeline resolver.
 */
export function validateSpacing(model: ScoreModel): ValidationResult {
  let mapping: ReturnType<typeof mapScorePartsToVoiceParts>;
  try {
    mapping = mapScorePartsToVoiceParts(model.parts);
  } catch (error) {
    if (!(error instanceof VoiceMappingError)) throw error;
    return { errors: [voiceMappingIssue(model, error)], warnings: [] };
  }

  const partsById = new Map<string, ScorePart>(
    model.parts.map((part) => [part.id, part])
  );
  const warnings: Issue[] = [];

  for (const [upperVoice, lowerVoice] of SPACING_VOICE_PARTS) {
    const upperPartId = mapping.byVoicePart[upperVoice];
    const lowerPartId = mapping.byVoicePart[lowerVoice];
    if (!upperPartId || !lowerPartId) continue;

    const upperPart = partsById.get(upperPartId)!;
    const lowerPart = partsById.get(lowerPartId)!;
    const lowerMeasures = new Map(
      lowerPart.measures.map((measure) => [measure.number, measure])
    );

    for (const upperMeasure of upperPart.measures) {
      const lowerMeasure = lowerMeasures.get(upperMeasure.number);
      if (!lowerMeasure) continue;

      const lowerOnsets = soundingPitchesByOnset(lowerMeasure);
      for (const upperOnset of soundingPitchesByOnset(upperMeasure)) {
        const lowerOnset = lowerOnsets.find(
          (candidate) =>
            Math.abs(candidate.onset - upperOnset.onset) <= ONSET_EPSILON
        );
        if (!lowerOnset) continue;

        const exceedsOctave = upperOnset.pitches.some((upperPitch) =>
          lowerOnset.pitches.some(
            (lowerPitch) => Math.abs(upperPitch.midi - lowerPitch.midi) > 12
          )
        );
        if (!exceedsOctave) continue;

        warnings.push({
          part: upperPart.id,
          measure: upperMeasure.number,
          beat: roundedBeat(upperOnset.onset, model.time.beatType),
          code: 'SPACING',
          message: `${upperVoice}–${lowerVoice} spacing exceeds an octave at a shared onset.`,
        });
      }
    }
  }

  return { errors: [], warnings };
}

/**
 * Flags notes outside the PRD voice profile. Comfortable and hard endpoints
 * are inclusive; a hard-range error is never duplicated as a warning.
 * Ranges use canonical S/A/T/B keys and are mapped to score-part IDs by the
 * existing exact-ID/name mapping. A custom profile may be supplied.
 */
export function validateOutOfRange(
  model: ScoreModel,
  ranges: VoiceRanges = DEFAULT_VOICE_RANGES
): ValidationResult {
  let rangesByPartId: ReturnType<typeof voiceRangesForScoreParts>;
  try {
    rangesByPartId = voiceRangesForScoreParts(model.parts, ranges);
  } catch (error) {
    if (!(error instanceof VoiceMappingError)) throw error;
    return { errors: [voiceMappingIssue(model, error)], warnings: [] };
  }
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  for (const part of model.parts) {
    const range = rangesByPartId[part.id]!;
    const comfortableLow = midiForPitch(range.comfortable.low);
    const comfortableHigh = midiForPitch(range.comfortable.high);
    const hardLow = midiForPitch(range.hard.low);
    const hardHigh = midiForPitch(range.hard.high);

    for (const measure of part.measures) {
      for (const { note, onset } of notePositions(measure)) {
        if (note.pitch === null) continue;

        const pitch = midiForPitch(note.pitch);
        let issue: Issue | undefined;
        if (pitch < hardLow || pitch > hardHigh) {
          issue = {
            part: part.id,
            measure: measure.number,
            beat: roundedBeat(onset, model.time.beatType),
            code: 'OUT_OF_RANGE',
            message: `${note.pitch} is outside the hard range for part ${part.id}.`,
          };
          errors.push(issue);
        } else if (pitch < comfortableLow || pitch > comfortableHigh) {
          issue = {
            part: part.id,
            measure: measure.number,
            beat: roundedBeat(onset, model.time.beatType),
            code: 'OUT_OF_RANGE',
            message: `${note.pitch} is outside the comfortable range for part ${part.id}, but within its hard range.`,
          };
          warnings.push(issue);
        }
      }
    }
  }

  return { errors, warnings };
}
