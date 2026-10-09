import { midiForPitch } from './pitch.js';
import { type ScoreKey, type ScoreModel } from './scoreModel.js';
import { keyAfterSemitoneShift } from './transpose.js';
import type { PartVoiceRange, PitchRange, VoiceRanges } from './voiceRanges.js';
export type { PartVoiceRange, PitchRange, VoiceRanges } from './voiceRanges.js';

export interface SuggestFitOptions {
  /** When omitted, all score parts must fit. */
  partId?: string;
}

export interface IntegerShiftInterval {
  min: number;
  max: number;
}

export interface PartFitCounts {
  outsideComfortable: number;
  outsideHard: number;
}

export interface FitSuggestion {
  semitones: number;
  score: number;
  key: ScoreKey;
  keyAccidentalCount: number;
  fitsComfortable: boolean;
  fitsHard: boolean;
  /** Counts are returned for every part, including when ranking one selected part. */
  perPart: Record<string, PartFitCounts>;
}

export interface SuggestFitResult {
  suggestions: FitSuggestion[];
  evaluatedShifts: number[];
  scope: { partId: string | null };
  feasibleShifts: {
    comfortable: IntegerShiftInterval | null;
    hard: IntegerShiftInterval | null;
    allPartsComfortable: IntegerShiftInterval | null;
    allPartsHard: IntegerShiftInterval | null;
  };
  fitAvailability: {
    comfortable: boolean;
    hard: boolean;
    allPartsHard: boolean;
  };
}

interface ParsedPitchRange {
  low: number;
  high: number;
}

interface ParsedPartRange {
  comfortable: ParsedPitchRange;
  hard: ParsedPitchRange;
}

interface PartData {
  id: string;
  notes: number[];
  range: ParsedPartRange;
}

const MIN_SHIFT = -12;
const MAX_SHIFT = 12;
/** A hard violation is already counted outside comfortable; add only four points so its total weight is five. */
const HARD_VIOLATION_WEIGHT = 5;
const SUGGESTION_LIMIT = 3;

function parseRange(range: PitchRange, label: string): ParsedPitchRange {
  if (!range || typeof range !== 'object') {
    throw new TypeError(
      `${label} must be a pitch range with low and high endpoints.`
    );
  }
  const low = midiForPitch(range.low);
  const high = midiForPitch(range.high);
  if (low > high) {
    throw new RangeError(
      `${label} lower endpoint must not be above its upper endpoint.`
    );
  }
  return { low, high };
}

function parseVoiceRange(
  range: PartVoiceRange,
  partId: string
): ParsedPartRange {
  if (!range || typeof range !== 'object') {
    throw new TypeError(
      `A comfortable and hard range is required for part ${partId}.`
    );
  }
  const comfortable = parseRange(
    range.comfortable,
    `Part ${partId} comfortable range`
  );
  const hard = parseRange(range.hard, `Part ${partId} hard range`);
  if (comfortable.low < hard.low || comfortable.high > hard.high) {
    throw new RangeError(
      `Part ${partId} comfortable range must be contained within its hard range.`
    );
  }
  return { comfortable, hard };
}

function collectParts(model: ScoreModel, ranges: VoiceRanges): PartData[] {
  if (!ranges || typeof ranges !== 'object') {
    throw new TypeError(
      'Voice ranges must be an object keyed by score part id.'
    );
  }
  const ids = model.parts.map((part) => part.id);
  if (new Set(ids).size !== ids.length) {
    throw new TypeError('Score part ids must be unique for range fitting.');
  }
  for (const rangePartId of Object.keys(ranges)) {
    if (!ids.includes(rangePartId)) {
      throw new TypeError(
        `Voice range supplied for unknown score part ${rangePartId}.`
      );
    }
  }

  return model.parts.map((part) => {
    if (!Object.hasOwn(ranges, part.id)) {
      throw new TypeError(
        `A comfortable and hard range is required for part ${part.id}.`
      );
    }
    const notes = part.measures.flatMap((measure) =>
      measure.notes.flatMap((note) =>
        note.pitch === null ? [] : [midiForPitch(note.pitch)]
      )
    );
    return {
      id: part.id,
      notes,
      range: parseVoiceRange(ranges[part.id]!, part.id),
    };
  });
}

function intervalForParts(
  parts: PartData[],
  rangeName: 'comfortable' | 'hard'
): IntegerShiftInterval | null {
  let minShift = MIN_SHIFT;
  let maxShift = MAX_SHIFT;

  for (const part of parts) {
    if (part.notes.length === 0) continue;
    const lowestNote = Math.min(...part.notes);
    const highestNote = Math.max(...part.notes);
    const allowedRange = part.range[rangeName];
    minShift = Math.max(minShift, Math.ceil(allowedRange.low - lowestNote));
    maxShift = Math.min(maxShift, Math.floor(allowedRange.high - highestNote));
    if (minShift > maxShift) return null;
  }

  return minShift <= maxShift ? { min: minShift, max: maxShift } : null;
}

function intervalContains(
  interval: IntegerShiftInterval | null,
  shift: number
): boolean {
  return interval !== null && shift >= interval.min && shift <= interval.max;
}

function countViolations(
  notes: number[],
  range: ParsedPitchRange,
  shift: number
): number {
  return notes.reduce((count, note) => {
    const pitch = note + shift;
    return count + (pitch < range.low || pitch > range.high ? 1 : 0);
  }, 0);
}

function isInterval(interval: IntegerShiftInterval | null): boolean {
  return interval !== null;
}

/**
 * Evaluates every integer shift from -12 through +12. Endpoints are inclusive;
 * rests are ignored and chord members count as separate pitched events.
 */
export function suggestFit(
  model: ScoreModel,
  ranges: VoiceRanges,
  options: SuggestFitOptions = {}
): SuggestFitResult {
  const parts = collectParts(model, ranges);
  const selectedPartId = options.partId;
  if (
    selectedPartId !== undefined &&
    !parts.some((part) => part.id === selectedPartId)
  ) {
    throw new TypeError(
      `Selected fit part ${selectedPartId} is not present in the score.`
    );
  }
  const scopedParts = selectedPartId
    ? parts.filter((part) => part.id === selectedPartId)
    : parts;

  const allPartsComfortable = intervalForParts(parts, 'comfortable');
  const allPartsHard = intervalForParts(parts, 'hard');
  const comfortable = intervalForParts(scopedParts, 'comfortable');
  const hard = intervalForParts(scopedParts, 'hard');

  const candidates: FitSuggestion[] = [];
  for (let semitones = MIN_SHIFT; semitones <= MAX_SHIFT; semitones += 1) {
    const perPart = Object.create(null) as Record<string, PartFitCounts>;
    for (const part of parts) {
      perPart[part.id] = {
        outsideComfortable: countViolations(
          part.notes,
          part.range.comfortable,
          semitones
        ),
        outsideHard: countViolations(part.notes, part.range.hard, semitones),
      };
    }

    const score = scopedParts.reduce((total, part) => {
      const counts = perPart[part.id]!;
      return (
        total +
        counts.outsideComfortable -
        counts.outsideHard +
        HARD_VIOLATION_WEIGHT * counts.outsideHard
      );
    }, 0);
    const key = keyAfterSemitoneShift(model.key, semitones);
    candidates.push({
      semitones,
      score,
      key,
      keyAccidentalCount: Math.abs(key.fifths),
      fitsComfortable: intervalContains(comfortable, semitones),
      fitsHard: intervalContains(hard, semitones),
      perPart,
    });
  }

  candidates.sort(
    (left, right) =>
      left.score - right.score ||
      Math.abs(left.semitones) - Math.abs(right.semitones) ||
      left.keyAccidentalCount - right.keyAccidentalCount ||
      left.semitones - right.semitones
  );

  return {
    suggestions: candidates.slice(0, SUGGESTION_LIMIT),
    evaluatedShifts: Array.from(
      { length: MAX_SHIFT - MIN_SHIFT + 1 },
      (_, index) => index + MIN_SHIFT
    ),
    scope: { partId: selectedPartId ?? null },
    feasibleShifts: {
      comfortable,
      hard,
      allPartsComfortable,
      allPartsHard,
    },
    fitAvailability: {
      comfortable: isInterval(comfortable),
      hard: isInterval(hard),
      allPartsHard: isInterval(allPartsHard),
    },
  };
}
