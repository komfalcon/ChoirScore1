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
import { midiForPitch, parsePitch } from '../pitch.js';
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
  | 'MEASURE_IDENTITY'
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

function duplicateMeasureNumbers(part: ScorePart): Set<number> {
  const duplicates = new Set<number>();
  const seenMeasures = new Set<number>();
  for (const measure of part.measures) {
    if (seenMeasures.has(measure.number)) duplicates.add(measure.number);
    seenMeasures.add(measure.number);
  }
  return duplicates;
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

/**
 * Cross-part comparisons join measures by their score number. A repeated
 * number is ambiguous only when a complete configured comparison pair has
 * that same label on the counterpart part, so unrelated labels do not block
 * valid findings elsewhere.
 */
function crossPartMeasureIdentityIssue(
  model: ScoreModel,
  mapping: ReturnType<typeof mapScorePartsToVoiceParts>,
  voicePairs: ReadonlyArray<readonly [VoicePartId, VoicePartId]>
): Issue | null {
  const partsById = new Map(model.parts.map((part) => [part.id, part]));
  const duplicateNumbersByPart = new Map(
    model.parts.map((part) => [part.id, duplicateMeasureNumbers(part)])
  );
  const duplicateMeasuresByPart = new Map<string, Set<number>>();
  for (const [upperVoice, lowerVoice] of voicePairs) {
    const upperPartId = mapping.byVoicePart[upperVoice];
    const lowerPartId = mapping.byVoicePart[lowerVoice];
    if (!upperPartId || !lowerPartId) continue;

    const upperPart = partsById.get(upperPartId);
    const lowerPart = partsById.get(lowerPartId);
    if (!upperPart || !lowerPart) continue;

    const upperNumbers = new Set(
      upperPart.measures.map(({ number }) => number)
    );
    const lowerNumbers = new Set(
      lowerPart.measures.map(({ number }) => number)
    );

    for (const measure of duplicateNumbersByPart.get(upperPart.id) ?? []) {
      if (!lowerNumbers.has(measure)) continue;
      const measures =
        duplicateMeasuresByPart.get(upperPart.id) ?? new Set<number>();
      measures.add(measure);
      duplicateMeasuresByPart.set(upperPart.id, measures);
    }
    for (const measure of duplicateNumbersByPart.get(lowerPart.id) ?? []) {
      if (!upperNumbers.has(measure)) continue;
      const measures =
        duplicateMeasuresByPart.get(lowerPart.id) ?? new Set<number>();
      measures.add(measure);
      duplicateMeasuresByPart.set(lowerPart.id, measures);
    }
  }

  const duplicates: Array<{ part: string; measure: number }> = [];
  for (const [part, measures] of duplicateMeasuresByPart) {
    for (const measure of measures) {
      duplicates.push({ part, measure });
    }
  }

  duplicates.sort(
    (first, second) =>
      comparePartIds(first.part, second.part) || first.measure - second.measure
  );
  const duplicate = duplicates[0];
  if (!duplicate) return null;

  return {
    part: duplicate.part,
    measure: duplicate.measure,
    beat: 1,
    code: 'MEASURE_IDENTITY',
    message:
      'A part contains duplicate measure numbers; cross-part validation was skipped.',
  };
}

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
  const measureIdentityIssue = crossPartMeasureIdentityIssue(
    model,
    mapping,
    ADJACENT_VOICE_PARTS
  );
  if (measureIdentityIssue) {
    return { errors: [measureIdentityIssue], warnings: [] };
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
  const measureIdentityIssue = crossPartMeasureIdentityIssue(
    model,
    mapping,
    SPACING_VOICE_PARTS
  );
  if (measureIdentityIssue) {
    return { errors: [measureIdentityIssue], warnings: [] };
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

const PARALLEL_VOICE_PART_PAIRS: ReadonlyArray<
  readonly [VoicePartId, VoicePartId]
> = [
  ['S', 'A'],
  ['S', 'T'],
  ['S', 'B'],
  ['A', 'T'],
  ['A', 'B'],
  ['T', 'B'],
];

interface ParallelTimelineOnset {
  measure: number;
  measureOrder: number;
  onset: number;
  anchor: ScoreNote | null;
  tieContinuation: boolean;
}

interface ParallelMeasureTimeline {
  measure: number;
  measureOrder: number;
  onsets: ParallelTimelineOnset[];
}

interface ParallelStreamTimeline {
  staff: number;
  voice: string;
  measures: ParallelMeasureTimeline[];
}

function parallelTimelines(part: ScorePart): ParallelStreamTimeline[] {
  const timelines = new Map<string, ParallelStreamTimeline>();
  const measureCounts = new Map<number, number>();
  for (const measure of part.measures) {
    measureCounts.set(
      measure.number,
      (measureCounts.get(measure.number) ?? 0) + 1
    );
  }

  for (const [measureOrder, measure] of part.measures.entries()) {
    const positionsByStream = new Map<
      string,
      Array<{ note: ScoreNote; onset: number; noteOrder: number }>
    >();
    for (const [noteOrder, position] of notePositions(measure).entries()) {
      const key = `${position.note.staff}\u0000${position.note.voice}`;
      const positions = positionsByStream.get(key) ?? [];
      positions.push({ ...position, noteOrder });
      positionsByStream.set(key, positions);
    }

    for (const [key, positions] of positionsByStream) {
      let timeline = timelines.get(key);
      if (!timeline) {
        const first = positions[0]!;
        timeline = {
          staff: first.note.staff,
          voice: first.note.voice,
          measures: [],
        };
        timelines.set(key, timeline);
      }

      positions.sort(
        (first, second) =>
          first.onset - second.onset || first.noteOrder - second.noteOrder
      );
      const onsets: ParallelTimelineOnset[] = [];
      for (let start = 0; start < positions.length;) {
        const first = positions[start]!;
        let end = start + 1;
        while (
          end < positions.length &&
          Math.abs(positions[end]!.onset - first.onset) <= ONSET_EPSILON
        ) {
          end += 1;
        }

        const sameOnset = positions.slice(start, end);
        const pitched = sameOnset.filter(({ note }) => note.pitch !== null);
        const anchor =
          pitched.find(({ note }) => !note.chord)?.note ??
          pitched[0]?.note ??
          null;
        onsets.push({
          measure: measure.number,
          measureOrder,
          onset: first.onset,
          anchor,
          tieContinuation: false,
        });
        start = end;
      }
      timeline.measures.push({
        measure: measure.number,
        measureOrder,
        onsets,
      });
    }
  }

  return [...timelines.values()]
    .map((timeline) => {
      timeline.measures.sort(
        (first, second) =>
          first.measure - second.measure ||
          first.measureOrder - second.measureOrder
      );
      let previous: ParallelTimelineOnset | null = null;
      for (const measure of timeline.measures) {
        for (const event of measure.onsets) {
          const sameMeasure = previous?.measureOrder === event.measureOrder;
          const adjacentMeasures =
            previous !== null &&
            event.measure === previous.measure + 1 &&
            measureCounts.get(previous.measure) === 1 &&
            measureCounts.get(event.measure) === 1;
          event.tieContinuation = Boolean(
            previous?.anchor?.tie &&
            event.anchor?.pitch === previous.anchor.pitch &&
            (sameMeasure || adjacentMeasures)
          );
          previous = event;
        }
      }
      return timeline;
    })
    .sort(
      (first, second) =>
        first.staff - second.staff ||
        (first.voice < second.voice ? -1 : first.voice > second.voice ? 1 : 0)
    );
}

interface ParallelUnionSlot {
  measure: number;
  onset: number;
  measureUnambiguous: boolean;
  first: ParallelTimelineOnset | null;
  second: ParallelTimelineOnset | null;
}

function parallelOnsetsAtMeasure(
  timeline: ParallelStreamTimeline,
  measureOrder: number
): ParallelTimelineOnset[] {
  return (
    timeline.measures.find(
      (candidate) => candidate.measureOrder === measureOrder
    )?.onsets ?? []
  );
}

function appendParallelUnionSlots(
  slots: ParallelUnionSlot[],
  measure: number,
  firstOnsets: ParallelTimelineOnset[],
  secondOnsets: ParallelTimelineOnset[],
  measureUnambiguous: boolean
): void {
  const events = [
    ...firstOnsets.map((event) => ({ event, side: 'first' as const })),
    ...secondOnsets.map((event) => ({ event, side: 'second' as const })),
  ].sort(
    (first, second) =>
      first.event.onset - second.event.onset ||
      (first.side === second.side ? 0 : first.side === 'first' ? -1 : 1)
  );

  for (const { event, side } of events) {
    let slot = slots[slots.length - 1];
    if (
      !slot ||
      slot.measure !== measure ||
      Math.abs(slot.onset - event.onset) > ONSET_EPSILON
    ) {
      slot = {
        measure,
        onset: event.onset,
        measureUnambiguous,
        first: null,
        second: null,
      };
      slots.push(slot);
    }
    slot[side] = event;
  }
}

function parallelUnionTimeline(
  firstPart: ScorePart,
  firstTimeline: ParallelStreamTimeline,
  secondPart: ScorePart,
  secondTimeline: ParallelStreamTimeline
): ParallelUnionSlot[] {
  const measures = [
    ...new Set([
      ...firstPart.measures.map(({ number }) => number),
      ...secondPart.measures.map(({ number }) => number),
    ]),
  ].sort((first, second) => first - second);
  const slots: ParallelUnionSlot[] = [];

  for (const number of measures) {
    const firstMeasures = firstPart.measures
      .map((measure, measureOrder) => ({ measure, measureOrder }))
      .filter(({ measure }) => measure.number === number);
    const secondMeasures = secondPart.measures
      .map((measure, measureOrder) => ({ measure, measureOrder }))
      .filter(({ measure }) => measure.number === number);

    if (firstMeasures.length === 1 && secondMeasures.length === 1) {
      appendParallelUnionSlots(
        slots,
        number,
        parallelOnsetsAtMeasure(firstTimeline, firstMeasures[0]!.measureOrder),
        parallelOnsetsAtMeasure(
          secondTimeline,
          secondMeasures[0]!.measureOrder
        ),
        true
      );
      continue;
    }

    for (const { measureOrder } of firstMeasures) {
      appendParallelUnionSlots(
        slots,
        number,
        parallelOnsetsAtMeasure(firstTimeline, measureOrder),
        [],
        false
      );
    }
    for (const { measureOrder } of secondMeasures) {
      appendParallelUnionSlots(
        slots,
        number,
        [],
        parallelOnsetsAtMeasure(secondTimeline, measureOrder),
        false
      );
    }
  }

  return slots;
}

function perfectIntervalClass(
  firstPitch: string,
  secondPitch: string
): 'fifth' | 'octave' | null {
  const first = parsePitch(firstPitch);
  const second = parsePitch(secondPitch);
  const genericNumber =
    Math.abs(first.diatonicIndex - second.diatonicIndex) + 1;
  const simpleDegree = ((genericNumber - 1) % 7) + 1;
  const compoundOctaves = Math.floor((genericNumber - 1) / 7);
  const semitones = Math.abs(first.midi - second.midi);

  if (simpleDegree === 5 && semitones === 7 + 12 * compoundOctaves) {
    return 'fifth';
  }
  if (
    simpleDegree === 1 &&
    compoundOctaves > 0 &&
    semitones === 12 * compoundOctaves
  ) {
    return 'octave';
  }
  return null;
}

function parallelAttack(
  slot: ParallelUnionSlot,
  side: 'first' | 'second'
): ScoreNote | null {
  const event = slot[side];
  return event && !event.tieContinuation ? event.anchor : null;
}

function parallelSlotsAreConsecutive(
  previous: ParallelUnionSlot,
  current: ParallelUnionSlot
): boolean {
  if (!previous.measureUnambiguous || !current.measureUnambiguous) return false;
  return (
    previous.measure === current.measure ||
    current.measure === previous.measure + 1
  );
}

/**
 * Reports parallel perfect fifths and octaves as errors between every pair of
 * canonical SATB parts. Each distinct (staff, voice) stream is compared on the
 * union of its onset timelines; unmatched attacks, rests, and tied continuations
 * break a transition. Boundary transitions require unique, adjacent measures.
 */
export function validateParallelFifthsOctaves(
  model: ScoreModel
): ValidationResult {
  let mapping: ReturnType<typeof mapScorePartsToVoiceParts>;
  try {
    mapping = mapScorePartsToVoiceParts(model.parts);
  } catch (error) {
    if (!(error instanceof VoiceMappingError)) throw error;
    return { errors: [voiceMappingIssue(model, error)], warnings: [] };
  }
  const measureIdentityIssue = crossPartMeasureIdentityIssue(
    model,
    mapping,
    PARALLEL_VOICE_PART_PAIRS
  );
  if (measureIdentityIssue) {
    return { errors: [measureIdentityIssue], warnings: [] };
  }

  const partsById = new Map(model.parts.map((part) => [part.id, part]));
  const timelinesByPartId = new Map(
    model.parts.map((part) => [part.id, parallelTimelines(part)])
  );
  const errors: Issue[] = [];

  for (const [firstVoice, secondVoice] of PARALLEL_VOICE_PART_PAIRS) {
    const firstPartId = mapping.byVoicePart[firstVoice];
    const secondPartId = mapping.byVoicePart[secondVoice];
    if (!firstPartId || !secondPartId) continue;

    const firstPart = partsById.get(firstPartId);
    const secondPart = partsById.get(secondPartId);
    if (!firstPart || !secondPart) continue;

    const firstTimelines = timelinesByPartId.get(firstPartId) ?? [];
    const secondTimelines = timelinesByPartId.get(secondPartId) ?? [];
    for (const firstTimeline of firstTimelines) {
      for (const secondTimeline of secondTimelines) {
        const slots = parallelUnionTimeline(
          firstPart,
          firstTimeline,
          secondPart,
          secondTimeline
        );
        for (let index = 1; index < slots.length; index += 1) {
          const previous = slots[index - 1]!;
          const current = slots[index]!;
          if (!parallelSlotsAreConsecutive(previous, current)) continue;

          const previousFirst = parallelAttack(previous, 'first');
          const previousSecond = parallelAttack(previous, 'second');
          const currentFirst = parallelAttack(current, 'first');
          const currentSecond = parallelAttack(current, 'second');
          if (
            !previousFirst?.pitch ||
            !previousSecond?.pitch ||
            !currentFirst?.pitch ||
            !currentSecond?.pitch
          ) {
            continue;
          }

          const previousClass = perfectIntervalClass(
            previousFirst.pitch,
            previousSecond.pitch
          );
          if (!previousClass) continue;
          const currentClass = perfectIntervalClass(
            currentFirst.pitch,
            currentSecond.pitch
          );
          if (currentClass !== previousClass) continue;

          const firstMovement =
            midiForPitch(currentFirst.pitch) -
            midiForPitch(previousFirst.pitch);
          const secondMovement =
            midiForPitch(currentSecond.pitch) -
            midiForPitch(previousSecond.pitch);
          if (
            firstMovement === 0 ||
            secondMovement === 0 ||
            Math.sign(firstMovement) !== Math.sign(secondMovement)
          ) {
            continue;
          }

          const direction = firstMovement > 0 ? 'up' : 'down';
          const intervalName = previousClass === 'fifth' ? 'fifths' : 'octaves';
          errors.push({
            part: firstPart.id,
            measure: current.measure,
            beat: roundedBeat(current.first!.onset, model.time.beatType),
            code:
              previousClass === 'fifth'
                ? 'PARALLEL_FIFTHS'
                : 'PARALLEL_OCTAVES',
            message: `${firstVoice}–${secondVoice} parallel ${intervalName} move ${direction} from ${previousFirst.pitch}–${previousSecond.pitch} to ${currentFirst.pitch}–${currentSecond.pitch}.`,
          });
        }
      }
    }
  }

  return { errors, warnings: [] };
}

const LARGE_LEAP_VOICES: ReadonlyArray<readonly [VoicePartId, number]> = [
  ['A', 6],
  ['T', 6],
  ['B', 8],
];

interface LargeLeapOnset {
  measure: number;
  measureOrder: number;
  onset: number;
  anchor: ScoreNote | null;
}

interface LargeLeapPosition extends NotePosition {
  measure: number;
  measureOrder: number;
  noteOrder: number;
}

interface LargeLeapTimeline {
  staff: number;
  voice: string;
  onsets: LargeLeapOnset[];
}

function largeLeapTimelines(part: ScorePart): LargeLeapTimeline[] {
  const timelines = new Map<
    string,
    { staff: number; voice: string; positions: LargeLeapPosition[] }
  >();
  const measures = part.measures
    .map((measure, measureOrder) => ({ measure, measureOrder }))
    .sort(
      (first, second) =>
        first.measure.number - second.measure.number ||
        first.measureOrder - second.measureOrder
    );

  for (const { measure, measureOrder } of measures) {
    for (const [noteOrder, position] of notePositions(measure).entries()) {
      const { note } = position;
      const key = `${note.staff}\u0000${note.voice}`;
      let timeline = timelines.get(key);
      if (!timeline) {
        timeline = { staff: note.staff, voice: note.voice, positions: [] };
        timelines.set(key, timeline);
      }
      timeline.positions.push({
        ...position,
        measure: measure.number,
        measureOrder,
        noteOrder,
      });
    }
  }

  return [...timelines.values()]
    .map(({ staff, voice, positions }) => {
      positions.sort(
        (first, second) =>
          first.measure - second.measure ||
          first.measureOrder - second.measureOrder ||
          first.onset - second.onset ||
          first.noteOrder - second.noteOrder
      );

      const onsets: LargeLeapOnset[] = [];
      for (let start = 0; start < positions.length;) {
        const first = positions[start]!;
        let end = start + 1;
        while (
          end < positions.length &&
          positions[end]!.measureOrder === first.measureOrder &&
          Math.abs(positions[end]!.onset - first.onset) <= ONSET_EPSILON
        ) {
          end += 1;
        }

        const onsetPositions = positions.slice(start, end);
        const pitchedPositions = onsetPositions.filter(
          ({ note }) => note.pitch !== null
        );
        const anchor =
          pitchedPositions.find(({ note }) => !note.chord)?.note ??
          pitchedPositions[0]?.note ??
          null;
        onsets.push({
          measure: first.measure,
          measureOrder: first.measureOrder,
          onset: first.onset,
          anchor,
        });
        start = end;
      }

      return { staff, voice, onsets };
    })
    .sort(
      (first, second) =>
        first.staff - second.staff ||
        (first.voice < second.voice ? -1 : first.voice > second.voice ? 1 : 0)
    );
}

function diatonicIntervalName(intervalNumber: number): string {
  const names: Readonly<Record<number, string>> = {
    1: 'unison',
    2: 'second',
    3: 'third',
    4: 'fourth',
    5: 'fifth',
    6: 'sixth',
    7: 'seventh',
    8: 'octave',
    9: 'ninth',
    10: 'tenth',
    11: 'eleventh',
    12: 'twelfth',
    13: 'thirteenth',
  };
  return names[intervalNumber] ?? `${intervalNumber}th`;
}

/**
 * Warns on melodic leaps larger than a sixth in A/T and larger than an octave
 * in B. Events are grouped by part/staff/voice and ordered by measure number
 * and resolved onset. Same-onset chord tones share one anchor pitch; rests are
 * skipped as endpoints, while directly tied same-pitch continuations remain one
 * sustained event. Intervals are notated diatonic interval numbers.
 */
export function validateLargeLeap(model: ScoreModel): ValidationResult {
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

  for (const [voice, threshold] of LARGE_LEAP_VOICES) {
    const partId = mapping.byVoicePart[voice];
    if (!partId) continue;
    const part = partsById.get(partId);
    if (!part) continue;

    for (const timeline of largeLeapTimelines(part)) {
      let previousOnset: LargeLeapOnset | null = null;
      let previousPitched: { pitch: string } | null = null;

      for (const event of timeline.onsets) {
        const note = event.anchor;
        if (!note || note.pitch === null) {
          previousOnset = event;
          continue;
        }

        const tiedContinuation =
          previousOnset?.anchor?.tie === true &&
          previousOnset.anchor.pitch === note.pitch;
        if (tiedContinuation) {
          previousOnset = event;
          continue;
        }

        if (previousPitched) {
          const intervalNumber =
            Math.abs(
              parsePitch(note.pitch).diatonicIndex -
                parsePitch(previousPitched.pitch).diatonicIndex
            ) + 1;
          if (intervalNumber > threshold) {
            const limit = voice === 'B' ? 'octave' : 'sixth';
            warnings.push({
              part: part.id,
              measure: event.measure,
              beat: roundedBeat(event.onset, model.time.beatType),
              code: 'LARGE_LEAP',
              message: `${voice} leap from ${previousPitched.pitch} to ${note.pitch} spans a diatonic ${diatonicIntervalName(intervalNumber)}, exceeding the ${limit} limit.`,
            });
          }
        }

        previousPitched = { pitch: note.pitch };
        previousOnset = event;
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
