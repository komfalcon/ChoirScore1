import type { ScoreModel, ScoreNote } from '@choirscore/shared';

export const TEMPO_PERCENT_MIN = 50;
export const TEMPO_PERCENT_MAX = 150;
export const PART_VOLUME_MIN = 0;
export const PART_VOLUME_MAX = 1;
export interface PlaybackLoopRange {
  /** Inclusive, one-based measure number, aligned across all parts. */
  startMeasure: number;
  /** Inclusive, one-based measure number. */
  endMeasure: number;
}

export interface PartPlaybackSettings {
  muted: boolean;
  solo: boolean;
  volume: number;
}

export type PartPlaybackMix = Record<string, PartPlaybackSettings>;

export interface PlaybackSettings {
  tempoPercent: number;
  countIn: boolean;
  loop: PlaybackLoopRange | null;
  parts: PartPlaybackMix;
}

export interface TimelineNote {
  partId: string;
  pitch: string;
  startBeat: number;
  durationBeats: number;
  measureIndex: number;
  measureNumber: number;
  voice: string;
  staff: number;
}

export interface PlaybackNote extends TimelineNote {
  startSeconds: number;
  durationSeconds: number;
}

export interface PlaybackClick {
  /** Position from the start of the count-in, measured in quarter-note beats. */
  beat: number;
  timeSeconds: number;
  accented: boolean;
}

export interface PlaybackPlan {
  tempoBpm: number;
  secondsPerBeat: number;
  countInDurationBeats: number;
  countInClicks: PlaybackClick[];
  notes: PlaybackNote[];
  loop: { startSeconds: number; endSeconds: number } | null;
  totalDurationSeconds: number;
  measureStarts: number[];
  measureDurations: number[];
}

interface RawTimelineNote {
  partId: string;
  partOrder: number;
  pitch: string;
  startBeat: number;
  durationBeats: number;
  measureIndex: number;
  measureNumber: number;
  voice: string;
  staff: number;
  tie: boolean;
}

interface Timeline {
  notes: RawTimelineNote[];
  measureStarts: number[];
  measureDurations: number[];
}

interface LaneCursor {
  cursor: number;
  previousOnset: number;
}

const DEFAULT_PART_SETTINGS: PartPlaybackSettings = {
  muted: false,
  solo: false,
  volume: 1,
};

/** Creates one default, full-volume, audible control state for every score part. */
export function createDefaultPartMix(
  partIds: readonly string[]
): PartPlaybackMix {
  return Object.fromEntries(
    partIds.map((partId) => [partId, { ...DEFAULT_PART_SETTINGS }])
  );
}

export function clampTempoPercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(TEMPO_PERCENT_MAX, Math.max(TEMPO_PERCENT_MIN, value));
}

export function clampPartVolume(value: number): number {
  if (!Number.isFinite(value)) return PART_VOLUME_MAX;
  return Math.min(PART_VOLUME_MAX, Math.max(PART_VOLUME_MIN, value));
}

/** Applies part controls without mutating a component's existing mix state. */
export function updatePartPlaybackSettings(
  mix: PartPlaybackMix,
  partId: string,
  patch: Partial<PartPlaybackSettings>
): PartPlaybackMix {
  const current = mix[partId] ?? { ...DEFAULT_PART_SETTINGS };
  return {
    ...mix,
    [partId]: {
      muted: patch.muted ?? current.muted,
      solo: patch.solo ?? current.solo,
      volume: clampPartVolume(patch.volume ?? current.volume),
    },
  };
}

/** Isolates one selected part, preserving its stored volume and other mute states. */
export function selectOnlyMyPart(
  mix: PartPlaybackMix,
  partIds: readonly string[],
  myPartId: string
): PartPlaybackMix {
  if (!partIds.includes(myPartId)) return mix;
  return Object.fromEntries(
    partIds.map((partId) => {
      const current = mix[partId] ?? { ...DEFAULT_PART_SETTINGS };
      return [
        partId,
        {
          ...current,
          muted: partId === myPartId ? false : current.muted,
          solo: partId === myPartId,
        },
      ];
    })
  );
}

/** Returns the effective linear gain (0–1), honoring solo before mute/volume. */
export function getEffectivePartGain(
  partId: string,
  mix: PartPlaybackMix
): number {
  const entries = Object.values(mix);
  const hasSolo = entries.some((settings) => settings.solo);
  const settings = mix[partId] ?? DEFAULT_PART_SETTINGS;
  if (settings.muted || (hasSolo && !settings.solo)) return 0;
  return clampPartVolume(settings.volume);
}

function onsetForNote(note: ScoreNote, lane: LaneCursor): number {
  if (note.onset !== undefined) return note.onset;
  return note.chord ? lane.previousOnset : lane.cursor;
}

function noteLaneKey(note: ScoreNote): string {
  return `${note.staff}:${note.voice}`;
}

function mergeTiedNotes(notes: RawTimelineNote[]): RawTimelineNote[] {
  const lanes = new Map<string, RawTimelineNote[]>();
  for (const note of notes) {
    const key = `${note.partId}\u0000${note.staff}\u0000${note.voice}`;
    const lane = lanes.get(key) ?? [];
    lane.push(note);
    lanes.set(key, lane);
  }

  const merged: RawTimelineNote[] = [];
  for (const lane of lanes.values()) {
    lane.sort((left, right) => left.startBeat - right.startBeat);
    for (const note of lane) {
      const previous = merged[merged.length - 1];
      if (
        previous &&
        previous.partId === note.partId &&
        previous.staff === note.staff &&
        previous.voice === note.voice &&
        previous.pitch === note.pitch &&
        previous.tie &&
        Math.abs(previous.startBeat + previous.durationBeats - note.startBeat) <
          0.000001
      ) {
        previous.durationBeats += note.durationBeats;
        previous.tie = note.tie;
      } else {
        merged.push({ ...note });
      }
    }
  }
  return merged;
}

function compileTimeline(model: ScoreModel): Timeline {
  const measureCount = Math.max(
    ...model.parts.map((part) => part.measures.length)
  );
  const notatedMeasureBeats = (model.time.beats * 4) / model.time.beatType;
  const measureDurations = Array.from(
    { length: measureCount },
    () => notatedMeasureBeats
  );
  const rawNotes: RawTimelineNote[] = [];

  model.parts.forEach((part, partOrder) => {
    part.measures.forEach((measure, measureIndex) => {
      const lanes = new Map<string, LaneCursor>();
      let observedEnd = 0;
      for (const note of measure.notes) {
        const key = noteLaneKey(note);
        const lane = lanes.get(key) ?? { cursor: 0, previousOnset: 0 };
        const onset = onsetForNote(note, lane);
        lane.previousOnset = onset;
        lane.cursor = Math.max(lane.cursor, onset + note.dur);
        lanes.set(key, lane);
        observedEnd = Math.max(observedEnd, onset + note.dur);
        if (note.pitch !== null) {
          rawNotes.push({
            partId: part.id,
            partOrder,
            pitch: note.pitch,
            startBeat: onset,
            durationBeats: note.dur,
            measureIndex,
            measureNumber: measure.number,
            voice: note.voice,
            staff: note.staff,
            tie: note.tie,
          });
        }
      }
      measureDurations[measureIndex] = Math.max(
        measureDurations[measureIndex] ?? notatedMeasureBeats,
        observedEnd
      );
    });
  });

  const measureStarts: number[] = [];
  let scoreCursor = 0;
  for (const duration of measureDurations) {
    measureStarts.push(scoreCursor);
    scoreCursor += duration;
  }

  const absoluteNotes = rawNotes.map((note) => ({
    ...note,
    startBeat: (measureStarts[note.measureIndex] ?? 0) + note.startBeat,
  }));
  const mergedNotes = mergeTiedNotes(absoluteNotes);
  mergedNotes.sort(
    (left, right) =>
      left.startBeat - right.startBeat ||
      left.partOrder - right.partOrder ||
      left.pitch.localeCompare(right.pitch) ||
      left.staff - right.staff ||
      left.voice.localeCompare(right.voice)
  );

  return { notes: mergedNotes, measureStarts, measureDurations };
}

function normalizeLoop(
  loop: PlaybackLoopRange | null,
  measureCount: number
): PlaybackLoopRange | null {
  if (!loop || measureCount === 0) return null;
  const { startMeasure, endMeasure } = loop;
  if (
    !Number.isInteger(startMeasure) ||
    !Number.isInteger(endMeasure) ||
    startMeasure < 1 ||
    endMeasure < startMeasure ||
    endMeasure > measureCount
  ) {
    return null;
  }
  return loop;
}

/**
 * Compiles the shared score model into an immutable, audio-clock-independent plan.
 * The result can be scheduled by Tone, a test clock, or another audio backend.
 */
export function createPlaybackPlan(
  model: ScoreModel,
  settings: Pick<PlaybackSettings, 'tempoPercent' | 'countIn' | 'loop'>
): PlaybackPlan {
  const timeline = compileTimeline(model);
  const tempoBpm =
    (model.tempo * clampTempoPercent(settings.tempoPercent)) / 100;
  const secondsPerBeat = 60 / tempoBpm;
  const quarterNotesPerNotatedBeat = 4 / model.time.beatType;
  const countInDurationBeats = settings.countIn
    ? model.time.beats * quarterNotesPerNotatedBeat
    : 0;
  const countInClicks: PlaybackClick[] = Array.from(
    { length: settings.countIn ? model.time.beats : 0 },
    (_, beat) => ({
      beat: beat * quarterNotesPerNotatedBeat,
      timeSeconds: beat * quarterNotesPerNotatedBeat * secondsPerBeat,
      accented: beat === 0,
    })
  );
  const countInOffsetBeats = countInDurationBeats;
  const notes: PlaybackNote[] = timeline.notes.map((note) => ({
    partId: note.partId,
    pitch: note.pitch,
    startBeat: note.startBeat + countInOffsetBeats,
    durationBeats: note.durationBeats,
    measureIndex: note.measureIndex,
    measureNumber: note.measureNumber,
    voice: note.voice,
    staff: note.staff,
    startSeconds: (note.startBeat + countInOffsetBeats) * secondsPerBeat,
    durationSeconds: note.durationBeats * secondsPerBeat,
  }));

  const loopRange = normalizeLoop(
    settings.loop,
    timeline.measureDurations.length
  );
  const loop = loopRange
    ? {
        startSeconds:
          (countInOffsetBeats +
            (timeline.measureStarts[loopRange.startMeasure - 1] ?? 0)) *
          secondsPerBeat,
        endSeconds:
          (countInOffsetBeats +
            (timeline.measureStarts[loopRange.endMeasure - 1] ?? 0) +
            (timeline.measureDurations[loopRange.endMeasure - 1] ?? 0)) *
          secondsPerBeat,
      }
    : null;
  const scoreDurationBeats = timeline.measureDurations.reduce(
    (total, duration) => total + duration,
    0
  );

  return {
    tempoBpm,
    secondsPerBeat,
    countInDurationBeats,
    countInClicks,
    notes,
    loop,
    totalDurationSeconds:
      (countInOffsetBeats + scoreDurationBeats) * secondsPerBeat,
    measureStarts: timeline.measureStarts,
    measureDurations: timeline.measureDurations,
  };
}
