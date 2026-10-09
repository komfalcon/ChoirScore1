import type { ScoreModel } from '@choirscore/shared';

/** Shared controlled edit seam for Sol-fa editor modes. */
export type SolfaEditorProps = {
  /** The live shared score model; editors do not own a second score model. */
  model: ScoreModel;
  /** Score-detail permission; false keeps content controls read-only. */
  canEditContent: boolean;
  /** Publish one accepted immutable model to the shared editor host. */
  onChange: (model: ScoreModel) => void;
  className?: string;
};
