import {
  clampPartVolume,
  clampTempoPercent,
  type PartPlaybackSettings,
  type PlaybackLoopRange,
  type PlaybackSettings,
} from './playbackCore';

export type PlaybackControlStatus =
  'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface PlaybackControlPart extends PartPlaybackSettings {
  id: string;
  name: string;
}

/** Controlled state exposed to the independently owned PlaybackControls UI. */
export interface PlaybackControlsState {
  status: PlaybackControlStatus;
  error?: string;
  /** Ordered exactly as the score parts; IDs match ScoreModel part IDs. */
  parts: PlaybackControlPart[];
  /** Resolved ScoreModel part ID (for example P1), or null when unresolved. */
  voicePart: string | null;
  tempoPercent: number;
  countIn: boolean;
  /** Inclusive, one-based measure range. */
  loopRange: PlaybackLoopRange | null;
}

export type PlaybackPreset = 'all' | 'my-part' | 'only-my-part';
export type PartSettingsPatch = Partial<PartPlaybackSettings>;

/**
 * Contract for the separate accessible PlaybackControls component. The view
 * only reports user intent through these callbacks; the controller owns the
 * behavior and preset rules.
 */
export interface PlaybackControlsCallbacks {
  onPlay: () => void | Promise<void>;
  onPause: () => void;
  onStop: () => void;
  onTempoChange: (tempoPercent: number) => void;
  onCountInChange: (countIn: boolean) => void;
  onLoopChange: (range: PlaybackLoopRange | null) => void;
  onPartSettingsPatch: (partId: string, patch: PartSettingsPatch) => void;
  onPreset: (preset: PlaybackPreset) => void;
}

export type PlaybackControlsContract = PlaybackControlsState &
  PlaybackControlsCallbacks;

/** Projects the ordered controlled state into the scheduler's keyed mix shape. */
export function playbackSettingsFromControls(
  state: Pick<
    PlaybackControlsState,
    'tempoPercent' | 'countIn' | 'loopRange' | 'parts'
  >
): PlaybackSettings {
  return {
    tempoPercent: clampTempoPercent(state.tempoPercent),
    countIn: state.countIn === true,
    loop: state.loopRange,
    parts: Object.fromEntries(
      state.parts.map((part) => [
        part.id,
        {
          muted: part.muted,
          solo: part.solo,
          volume: clampPartVolume(part.volume),
        },
      ])
    ),
  };
}
