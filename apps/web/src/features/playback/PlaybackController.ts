import type { ScoreModel } from '@choirscore/shared';
import {
  clampPartVolume,
  clampTempoPercent,
  type PlaybackSettings,
} from './playbackCore';
import {
  playbackSettingsFromControls,
  type PartSettingsPatch,
  type PlaybackControlsCallbacks,
  type PlaybackControlsContract,
  type PlaybackControlsState,
  type PlaybackPreset,
} from './playbackControlsContract';

export interface PlaybackEnginePort {
  play(
    score: ScoreModel,
    settings: PlaybackSettings,
    callbacks?: { onEnded?: () => void }
  ): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface PlaybackControllerHost {
  getScore: () => ScoreModel;
  getState: () => PlaybackControlsState;
  onStatusChange: (
    status: PlaybackControlsState['status'],
    error?: string
  ) => void;
  onTempoChange: (tempoPercent: number) => void;
  onCountInChange: PlaybackControlsCallbacks['onCountInChange'];
  onLoopChange: PlaybackControlsCallbacks['onLoopChange'];
  onPartSettingsPatch: PlaybackControlsCallbacks['onPartSettingsPatch'];
}

/**
 * Bridges a controlled PlaybackControls contract to the pure scheduler and an
 * injected audio engine. It has no DOM or React dependency and starts audio
 * only when its explicit `onPlay` callback is invoked.
 */
export class PlaybackController {
  readonly callbacks: PlaybackControlsCallbacks;
  private playRequestId = 0;
  private pendingPlay?: Promise<void>;

  constructor(
    private readonly host: PlaybackControllerHost,
    private readonly engine: PlaybackEnginePort
  ) {
    this.callbacks = {
      onPlay: () => this.play(),
      onPause: () => this.pause(),
      onStop: () => this.stop(),
      onTempoChange: (tempoPercent) =>
        this.host.onTempoChange(clampTempoPercent(tempoPercent)),
      onCountInChange: (countIn) => this.host.onCountInChange(countIn === true),
      onLoopChange: (range) => this.host.onLoopChange(range),
      onPartSettingsPatch: (partId, patch) =>
        this.patchPartSettings(partId, patch),
      onPreset: (preset) => this.applyPreset(preset),
    };
  }

  /** Return the exact controlled contract for the separately owned UI. */
  getControlsContract(): PlaybackControlsContract {
    return { ...this.host.getState(), ...this.callbacks };
  }

  async play(): Promise<void> {
    if (this.host.getState().status === 'paused') {
      const playRequestId = ++this.playRequestId;
      try {
        this.engine.resume();
      } catch (error) {
        this.reportPlayError(error);
        return;
      }
      const pendingPlay = this.pendingPlay;
      if (!pendingPlay) {
        this.host.onStatusChange('playing');
        return;
      }

      this.host.onStatusChange('loading');
      try {
        await pendingPlay;
        if (playRequestId === this.playRequestId) {
          this.host.onStatusChange('playing');
        }
      } catch (error) {
        if (playRequestId === this.playRequestId) {
          this.reportPlayError(error);
        }
      }
      return;
    }

    const playRequestId = ++this.playRequestId;
    this.host.onStatusChange('loading');
    let pendingPlay: Promise<void> | undefined;
    try {
      pendingPlay = this.engine.play(
        this.host.getScore(),
        playbackSettingsFromControls(this.host.getState()),
        { onEnded: () => this.host.onStatusChange('idle') }
      );
      this.pendingPlay = pendingPlay;
      await pendingPlay;
      if (playRequestId !== this.playRequestId) return;
      this.host.onStatusChange('playing');
    } catch (error) {
      if (playRequestId !== this.playRequestId) return;
      this.reportPlayError(error);
    } finally {
      if (pendingPlay && this.pendingPlay === pendingPlay) {
        this.pendingPlay = undefined;
      }
    }
  }

  private reportPlayError(error: unknown): void {
    this.host.onStatusChange(
      'error',
      error instanceof Error
        ? error.message
        : 'Playback could not be started. Please try again.'
    );
  }

  pause(): void {
    this.playRequestId += 1;
    this.engine.pause();
    this.host.onStatusChange('paused');
  }

  stop(): void {
    this.playRequestId += 1;
    this.engine.stop();
    this.host.onStatusChange('idle');
  }

  private patchPartSettings(partId: string, patch: PartSettingsPatch): void {
    this.host.onPartSettingsPatch(partId, {
      ...patch,
      ...(patch.volume === undefined
        ? {}
        : { volume: clampPartVolume(patch.volume) }),
    });
  }

  private applyPreset(preset: PlaybackPreset): void {
    const { parts, voicePart } = this.host.getState();
    if (
      preset !== 'all' &&
      (!voicePart || !parts.some((part) => part.id === voicePart))
    ) {
      return;
    }

    for (const part of parts) {
      if (preset === 'all') {
        this.patchPartSettings(part.id, { muted: false, solo: false });
      } else if (preset === 'my-part') {
        this.patchPartSettings(part.id, {
          muted: false,
          solo: false,
          volume:
            part.id === voicePart
              ? 1
              : Math.max(clampPartVolume(part.volume), 0.2),
        });
      } else if (part.id === voicePart) {
        this.patchPartSettings(part.id, {
          muted: false,
          solo: true,
          volume: 1,
        });
      } else {
        this.patchPartSettings(part.id, { muted: false, solo: false });
      }
    }
  }
}
