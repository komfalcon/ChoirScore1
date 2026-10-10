import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ScoreModel } from '@choirscore/shared';
import { PlaybackController } from './PlaybackController';
import type { PlaybackPosition } from './playbackCore';
import {
  type PlaybackControlsState,
  type PartSettingsPatch,
} from './playbackControlsContract';
import { PlaybackControlsAdapter } from './PlaybackControlsAdapter';
import { LazyTonePlaybackEngine } from './LazyTonePlaybackEngine';
import { resolvePlaybackVoicePart } from './resolvePlaybackVoicePart';
import './ScorePlaybackPanel.css';

export interface ScorePlaybackPanelHandle {
  /** Start immediately at a one-based measure, as called from a user gesture. */
  playFromMeasure: (measure: number) => void;
}

type ScorePlaybackPanelProps = {
  score: ScoreModel;
  profileVoicePart: string | null;
  onProgressChange?: (position: PlaybackPosition | null) => void;
};

function initialState(
  score: ScoreModel,
  profileVoicePart: string | null
): PlaybackControlsState {
  return {
    status: 'idle',
    parts: score.parts.map((part) => ({
      id: part.id,
      name: part.name ?? part.id,
      muted: false,
      solo: false,
      volume: 0.8,
    })),
    voicePart: resolvePlaybackVoicePart(score.parts, profileVoicePart),
    tempoPercent: 100,
    countIn: false,
    loopRange: null,
  };
}

export const ScorePlaybackPanel = forwardRef<
  ScorePlaybackPanelHandle,
  ScorePlaybackPanelProps
>(function ScorePlaybackPanel(
  { score, profileVoicePart, onProgressChange },
  ref
) {
  const [state, setState] = useState(() =>
    initialState(score, profileVoicePart)
  );
  const stateRef = useRef(state);
  const scoreRef = useRef(score);
  const mountedRef = useRef(false);
  const progressCallbackRef = useRef(onProgressChange);
  stateRef.current = state;
  scoreRef.current = score;
  progressCallbackRef.current = onProgressChange;

  const engine = useMemo(() => new LazyTonePlaybackEngine(), []);
  const host = useMemo(
    () => ({
      getScore: () => scoreRef.current,
      getState: () => stateRef.current,
      onStatusChange: (
        status: PlaybackControlsState['status'],
        error?: string
      ) => {
        if (!mountedRef.current) return;
        setState((current) => ({
          ...current,
          status,
          error: status === 'error' ? error : undefined,
        }));
      },
      onProgressChange: (position: PlaybackPosition | null) => {
        if (!mountedRef.current) return;
        progressCallbackRef.current?.(position);
      },
      onTempoChange: (tempoPercent: number) => {
        setState((current) => ({ ...current, tempoPercent }));
      },
      onCountInChange: (countIn: boolean) => {
        setState((current) => ({ ...current, countIn }));
      },
      onLoopChange: (loopRange: PlaybackControlsState['loopRange']) => {
        setState((current) => ({ ...current, loopRange }));
      },
      onPartSettingsPatch: (partId: string, patch: PartSettingsPatch) => {
        setState((current) => ({
          ...current,
          parts: current.parts.map((part) =>
            part.id === partId ? { ...part, ...patch } : part
          ),
        }));
      },
    }),
    []
  );
  const controller = useMemo(
    () => new PlaybackController(host, engine),
    [host, engine]
  );
  const resolvedVoicePart = resolvePlaybackVoicePart(
    score.parts,
    profileVoicePart
  );

  useImperativeHandle(
    ref,
    () => ({
      playFromMeasure: (measure) => {
        void controller.playFromMeasure(measure);
      },
    }),
    [controller]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      engine.dispose();
    };
  }, [engine]);

  useEffect(() => {
    setState((current) =>
      current.voicePart === resolvedVoicePart
        ? current
        : { ...current, voicePart: resolvedVoicePart }
    );
  }, [resolvedVoicePart]);

  return (
    <section
      className="score-playback-panel"
      aria-labelledby="score-playback-title"
    >
      <div className="score-playback-panel__heading">
        <h2 id="score-playback-title">Playback</h2>
        <p>Audio and samples load only when you press Play.</p>
      </div>
      <PlaybackControlsAdapter
        score={score}
        contract={controller.getControlsContract()}
      />
    </section>
  );
});
