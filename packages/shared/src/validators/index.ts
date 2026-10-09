import {
  DEFAULT_VOICE_RANGES,
  voiceRangesForScoreParts,
  type VoiceRanges,
} from '../voiceRanges.js';
import { midiForPitch } from '../pitch.js';
import type { ScoreModel, ScoreMeasure, ScoreNote } from '../scoreModel.js';

/** Stable codes shared by current and planned score validators. */
export type ValidationIssueCode =
  | 'MEASURE_DURATION'
  | 'OUT_OF_RANGE'
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
 * Derives note onsets for range findings when the model omits them. Each voice
 * and staff advances independently; chord members share the preceding onset.
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
  const rangesByPartId = voiceRangesForScoreParts(model.parts, ranges);
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
