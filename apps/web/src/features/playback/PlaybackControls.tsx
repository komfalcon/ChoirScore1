import type { ReactElement } from 'react';
import './PlaybackControls.css';

export type PlaybackStatus =
  'idle' | 'loading' | 'playing' | 'paused' | 'error';

export type PlaybackPartSettings = {
  muted: boolean;
  solo: boolean;
  /** Linear gain from 0 (silent) to 1 (full level). */
  volume: number;
};

export type PlaybackPart = PlaybackPartSettings & {
  id: string;
  name: string;
};

export type PlaybackLoopRange = {
  /** Inclusive, one-based measure number. */
  startMeasure: number;
  /** Inclusive, one-based measure number. */
  endMeasure: number;
};

export type PlaybackPreset = 'all' | 'my-part' | 'only-my-part';

export type PlaybackControlsProps = {
  status: PlaybackStatus;
  errorMessage?: string;
  tempoPercent: number;
  countIn?: boolean;
  measureCount: number;
  loop: PlaybackLoopRange | null;
  parts: PlaybackPart[];
  /** Resolved actual part id from the score, or null when unavailable. */
  voicePart: string | null;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onTempoPercentChange: (tempoPercent: number) => void;
  onCountInChange: (enabled: boolean) => void;
  onLoopChange: (range: PlaybackLoopRange | null) => void;
  onPartSettingsChange: (
    partId: string,
    settings: Partial<PlaybackPartSettings>
  ) => void;
  onPreset: (preset: PlaybackPreset) => void;
};

function clampedVolume(volume: number) {
  return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
}

function clampedTempo(tempoPercent: number) {
  return Number.isFinite(tempoPercent)
    ? Math.max(50, Math.min(150, tempoPercent))
    : 100;
}

function loopStartChanged(
  current: PlaybackLoopRange,
  rawValue: string
): PlaybackLoopRange {
  const startMeasure = Number(rawValue);
  return {
    startMeasure,
    endMeasure: Math.max(startMeasure, current.endMeasure),
  };
}

function loopEndChanged(
  current: PlaybackLoopRange,
  rawValue: string
): PlaybackLoopRange {
  const endMeasure = Number(rawValue);
  return {
    startMeasure: Math.min(current.startMeasure, endMeasure),
    endMeasure,
  };
}

export function PlaybackControls({
  status,
  errorMessage,
  tempoPercent,
  countIn = false,
  measureCount,
  loop,
  parts,
  voicePart,
  onPlay,
  onPause,
  onStop,
  onTempoPercentChange,
  onCountInChange,
  onLoopChange,
  onPartSettingsChange,
  onPreset,
}: PlaybackControlsProps): ReactElement {
  const hasMyPart =
    voicePart !== null && parts.some((part) => part.id === voicePart);
  const presetUnavailableMessage =
    voicePart === null
      ? 'My Part presets are unavailable because no voice part is assigned.'
      : !hasMyPart
        ? 'My Part presets are unavailable because the assigned part is not in this score.'
        : '';
  const playLabel =
    status === 'paused'
      ? 'Resume playback'
      : status === 'error'
        ? 'Retry playback'
        : 'Play';
  const isPlaying = status === 'playing';
  const isLoading = status === 'loading';
  const canStop = status !== 'idle' && status !== 'loading';
  const safeMeasureCount = Number.isFinite(measureCount)
    ? Math.max(0, Math.floor(measureCount))
    : 0;
  const safeTempoPercent = clampedTempo(tempoPercent);

  function enableLoop() {
    if (safeMeasureCount === 0) return;
    onLoopChange({ startMeasure: 1, endMeasure: 1 });
  }

  return (
    <section
      className="playback-controls"
      aria-label="Playback controls"
      aria-busy={isLoading}
    >
      <div className="playback-controls__top-row">
        <div
          className="playback-controls__transport"
          role="group"
          aria-label="Transport"
        >
          <button
            className="button button--primary"
            type="button"
            aria-label={playLabel}
            disabled={isPlaying || isLoading}
            onClick={onPlay}
          >
            {playLabel}
          </button>
          <button
            className="button button--quiet"
            type="button"
            aria-label="Pause playback"
            disabled={!isPlaying}
            onClick={onPause}
          >
            Pause
          </button>
          <button
            className="button button--quiet"
            type="button"
            aria-label="Stop playback"
            disabled={!canStop}
            onClick={onStop}
          >
            Stop
          </button>
        </div>

        <div className="playback-controls__tempo">
          <label htmlFor="playback-tempo">
            <span>Tempo</span>
            <output htmlFor="playback-tempo">{safeTempoPercent}%</output>
          </label>
          <input
            id="playback-tempo"
            type="range"
            min={50}
            max={150}
            step={1}
            value={safeTempoPercent}
            aria-valuetext={`${safeTempoPercent}% of score tempo`}
            onChange={(event) =>
              onTempoPercentChange(Number(event.currentTarget.value))
            }
          />
          <div className="playback-controls__range-hints" aria-hidden="true">
            <span>50%</span>
            <span>150%</span>
          </div>
        </div>
      </div>

      <p className="playback-controls__status" role="status" aria-live="polite">
        {status === 'playing'
          ? 'Playing'
          : status === 'paused'
            ? 'Paused'
            : status === 'loading'
              ? 'Preparing playback…'
              : status === 'error'
                ? 'Playback could not start.'
                : 'Ready to play'}
      </p>
      {status === 'error' && errorMessage ? (
        <p className="playback-controls__error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className="playback-controls__options">
        <label className="playback-controls__checkbox">
          <input
            id="playback-count-in"
            type="checkbox"
            checked={countIn}
            onChange={(event) => onCountInChange(event.currentTarget.checked)}
          />
          <span>1-measure count-in</span>
          <span className="playback-controls__hint">Off by default</span>
        </label>

        <div className="playback-controls__loop">
          <label className="playback-controls__checkbox">
            <input
              aria-label="Enable measure loop"
              type="checkbox"
              checked={loop !== null}
              disabled={safeMeasureCount === 0}
              onChange={(event) =>
                event.currentTarget.checked ? enableLoop() : onLoopChange(null)
              }
            />
            <span>Loop measures</span>
          </label>
          <div className="playback-controls__loop-range">
            <label>
              <span>Start measure</span>
              <select
                aria-label="Loop start measure"
                value={loop?.startMeasure ?? ''}
                disabled={loop === null || safeMeasureCount === 0}
                onChange={(event) => {
                  if (loop !== null) {
                    onLoopChange(
                      loopStartChanged(loop, event.currentTarget.value)
                    );
                  }
                }}
              >
                {loop === null ? <option value="">—</option> : null}
                {Array.from(
                  { length: safeMeasureCount },
                  (_, index) => index + 1
                ).map((measure) => (
                  <option key={measure} value={measure}>
                    {measure}
                  </option>
                ))}
              </select>
            </label>
            <span
              className="playback-controls__loop-separator"
              aria-hidden="true"
            >
              to
            </span>
            <label>
              <span>End measure</span>
              <select
                aria-label="Loop end measure"
                value={loop?.endMeasure ?? ''}
                disabled={loop === null || safeMeasureCount === 0}
                onChange={(event) => {
                  if (loop !== null) {
                    onLoopChange(
                      loopEndChanged(loop, event.currentTarget.value)
                    );
                  }
                }}
              >
                {loop === null ? <option value="">—</option> : null}
                {Array.from(
                  { length: safeMeasureCount },
                  (_, index) => index + 1
                ).map((measure) => (
                  <option key={measure} value={measure}>
                    {measure}
                  </option>
                ))}
              </select>
            </label>
            <span className="playback-controls__hint">Inclusive</span>
          </div>
        </div>
      </div>

      <div
        className="playback-controls__presets"
        role="group"
        aria-label="Part presets"
      >
        <button
          className="button button--quiet button--small"
          type="button"
          onClick={() => onPreset('all')}
        >
          All
        </button>
        <button
          className="button button--quiet button--small"
          type="button"
          disabled={!hasMyPart}
          aria-describedby={!hasMyPart ? 'playback-my-part-help' : undefined}
          onClick={() => onPreset('my-part')}
        >
          My Part
        </button>
        <button
          className="button button--quiet button--small"
          type="button"
          disabled={!hasMyPart}
          aria-describedby={!hasMyPart ? 'playback-my-part-help' : undefined}
          onClick={() => onPreset('only-my-part')}
        >
          Only My Part
        </button>
        {!hasMyPart ? (
          <p className="playback-controls__hint" id="playback-my-part-help">
            {presetUnavailableMessage}
          </p>
        ) : null}
      </div>

      <fieldset className="playback-controls__parts">
        <legend>Part controls</legend>
        <div className="playback-controls__part-grid">
          {parts.map((part) => {
            const volumePercent = Math.round(clampedVolume(part.volume) * 100);
            return (
              <fieldset className="playback-controls__part" key={part.id}>
                <legend>{part.name || part.id}</legend>
                <div className="playback-controls__part-toggles">
                  <label className="playback-controls__checkbox">
                    <input
                      type="checkbox"
                      aria-label={`Mute ${part.name || part.id}`}
                      checked={part.muted}
                      onChange={(event) =>
                        onPartSettingsChange(part.id, {
                          muted: event.currentTarget.checked,
                        })
                      }
                    />
                    <span>Mute</span>
                  </label>
                  <label className="playback-controls__checkbox">
                    <input
                      type="checkbox"
                      aria-label={`Solo ${part.name || part.id}`}
                      checked={part.solo}
                      onChange={(event) =>
                        onPartSettingsChange(part.id, {
                          solo: event.currentTarget.checked,
                        })
                      }
                    />
                    <span>Solo</span>
                  </label>
                </div>
                <label className="playback-controls__volume">
                  <span>Volume</span>
                  <output>{volumePercent}%</output>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={volumePercent}
                    aria-label={`Volume ${part.name || part.id}`}
                    aria-valuetext={`${volumePercent}%`}
                    onChange={(event) =>
                      onPartSettingsChange(part.id, {
                        volume: Number(event.currentTarget.value) / 100,
                      })
                    }
                  />
                </label>
              </fieldset>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}
