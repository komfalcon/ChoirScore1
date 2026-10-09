import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScoreModel } from '@choirscore/shared';
import { PlaybackController } from './PlaybackController';
import {
  type PlaybackControlsState,
  type PartSettingsPatch,
} from './playbackControlsContract';
import { PlaybackControlsAdapter } from './PlaybackControlsAdapter';
import { LazyTonePlaybackEngine } from './LazyTonePlaybackEngine';
import { resolvePlaybackVoicePart } from './resolvePlaybackVoicePart';
import './ScorePlaybackPanel.css';

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

export function ScorePlaybackPanel({
  score,
  profileVoicePart,
}: {
  score: ScoreModel;
  profileVoicePart: string | null;
}) {
  const [state, setState] = useState(() =>
    initialState(score, profileVoicePart)
  );
  const stateRef = useRef(state);
  const scoreRef = useRef(score);
  const mountedRef = useRef(false);
  stateRef.current = state;
  scoreRef.current = score;

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
}
