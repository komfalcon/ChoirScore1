import type { ScoreModel } from '@choirscore/shared';
import {
  PlaybackControls,
  type PlaybackControlsProps,
} from './PlaybackControls';
import type { PlaybackControlsContract } from './playbackControlsContract';

export type PlaybackControlsAdapterProps = {
  score: ScoreModel;
  contract: PlaybackControlsContract;
};

/**
 * Thin boundary adapter between the scheduler's controlled contract and the
 * standalone UI. The parent owns both the score/controller and user gestures.
 */
export function PlaybackControlsAdapter({
  score,
  contract,
}: PlaybackControlsAdapterProps) {
  const measureCount = score.parts.reduce(
    (maximum, part) => Math.max(maximum, part.measures.length),
    0
  );

  const props: PlaybackControlsProps = {
    status: contract.status,
    errorMessage: contract.error,
    tempoPercent: contract.tempoPercent,
    countIn: contract.countIn,
    measureCount,
    loop: contract.loopRange,
    parts: contract.parts,
    voicePart: contract.voicePart,
    onPlay: () => {
      void contract.onPlay();
    },
    onPause: contract.onPause,
    onStop: contract.onStop,
    onTempoPercentChange: contract.onTempoChange,
    onCountInChange: contract.onCountInChange,
    onLoopChange: contract.onLoopChange,
    onPartSettingsChange: contract.onPartSettingsPatch,
    onPreset: contract.onPreset,
  };

  return <PlaybackControls {...props} />;
}
