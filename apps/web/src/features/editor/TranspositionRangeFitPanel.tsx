import { useId, useMemo, useState } from 'react';
import {
  suggestFit,
  transpose,
  type FitSuggestion,
  type ScoreModel,
  type VoiceRanges,
} from '@choirscore/shared';

export type TranspositionRangeFitPanelProps = {
  model: ScoreModel;
  voiceRanges: VoiceRanges;
  /** Receives a fresh transposed model; the caller decides whether to create a score/version. */
  onApply: (transposedModel: ScoreModel, suggestion: FitSuggestion) => void;
  onCancel?: () => void;
};

/** The exact Apply path used by the panel; previewing never calls this helper. */
export function applyFitSuggestion(
  model: ScoreModel,
  suggestion: FitSuggestion,
  onApply: TranspositionRangeFitPanelProps['onApply']
): void {
  const transposedModel = transpose(model, { semitones: suggestion.semitones });
  onApply(transposedModel, suggestion);
}

function shiftLabel(semitones: number): string {
  if (semitones === 0) return 'Original pitch';
  const direction = semitones > 0 ? 'Up' : 'Down';
  const amount = Math.abs(semitones);
  return `${direction} ${amount} ${amount === 1 ? 'semitone' : 'semitones'}`;
}

function keySignatureLabel(suggestion: FitSuggestion): string {
  if (suggestion.keyAccidentalCount === 0) {
    return `No sharps or flats · ${suggestion.key.mode} mode`;
  }
  const accidental = suggestion.key.fifths > 0 ? 'sharps' : 'flats';
  return `${suggestion.keyAccidentalCount} ${accidental} · ${suggestion.key.mode} mode`;
}

function noteCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'note' : 'notes'}`;
}

function candidateFitLabel(suggestion: FitSuggestion): string {
  if (!suggestion.fitsHard) return 'Hard-range violations';
  if (!suggestion.fitsComfortable) return 'Within hard range';
  return 'Comfortable for all parts';
}

function partLabel(part: ScoreModel['parts'][number], index: number): string {
  return part.name?.trim() || `Part ${index + 1}`;
}

export function TranspositionRangeFitPanel({
  model,
  voiceRanges,
  onApply,
  onCancel,
}: TranspositionRangeFitPanelProps) {
  const panelId = useId();
  const [chosenShift, setChosenShift] = useState<number | null>(null);
  const fit = useMemo(
    () => suggestFit(model, voiceRanges),
    [model, voiceRanges]
  );
  const selectedSuggestion =
    fit.suggestions.find(
      (suggestion) => suggestion.semitones === chosenShift
    ) ?? fit.suggestions[0]!;
  const groupName = `${panelId}-candidate`;
  const instructionId = `${panelId}-candidate-help`;
  const consequencesHeadingId = `${panelId}-consequences`;
  const selectedSummary = candidateFitLabel(selectedSuggestion);

  return (
    <section
      className="transposition-panel"
      aria-labelledby={`${panelId}-title`}
    >
      <header className="transposition-panel__header">
        <div>
          <p className="eyebrow">TRANSPOSE &amp; FIT PREVIEW</p>
          <h2 id={`${panelId}-title`}>Find a comfortable key</h2>
          <p>
            Compare the three best whole-score shifts. Your source score stays
            unchanged until you choose Apply.
          </p>
        </div>
      </header>

      <fieldset className="transposition-panel__fieldset">
        <legend>Top three transposition candidates</legend>
        <p id={instructionId} className="transposition-panel__hint">
          Ranked across all parts. Lower fit scores are better; hard-range notes
          carry extra weight.
        </p>
        <div className="transposition-panel__candidate-options">
          {fit.suggestions.map((suggestion, index) => {
            const isSelected =
              suggestion.semitones === selectedSuggestion.semitones;
            return (
              <label
                className={`transposition-panel__candidate${isSelected ? ' transposition-panel__candidate--selected' : ''}`}
                key={suggestion.semitones}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={suggestion.semitones}
                  checked={isSelected}
                  aria-describedby={instructionId}
                  onChange={() => setChosenShift(suggestion.semitones)}
                />
                <span className="transposition-panel__candidate-rank">
                  Recommendation {index + 1}
                </span>
                <strong>{shiftLabel(suggestion.semitones)}</strong>
                <span>{keySignatureLabel(suggestion)}</span>
                <span>Fit score {suggestion.score}</span>
                <span className="transposition-panel__candidate-fit">
                  {candidateFitLabel(suggestion)}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <section
        className="transposition-panel__consequences"
        aria-labelledby={consequencesHeadingId}
      >
        <div className="transposition-panel__section-heading">
          <div>
            <h3 id={consequencesHeadingId}>Per-part range consequences</h3>
            <p>
              For {shiftLabel(selectedSuggestion.semitones).toLowerCase()};
              rests are ignored and chord notes count individually.
            </p>
          </div>
          <span
            className={`transposition-panel__summary${selectedSuggestion.fitsHard ? '' : ' transposition-panel__summary--warning'}`}
            role="status"
            aria-live="polite"
          >
            {selectedSummary}
          </span>
        </div>
        <div
          className="transposition-panel__table-scroll"
          role="region"
          aria-label={`Range consequences for ${shiftLabel(selectedSuggestion.semitones).toLowerCase()}`}
          tabIndex={0}
        >
          <table className="transposition-panel__table">
            <caption>
              Range effects for{' '}
              {shiftLabel(selectedSuggestion.semitones).toLowerCase()}
            </caption>
            <thead>
              <tr>
                <th scope="col">Part</th>
                <th scope="col">Comfortable range</th>
                <th scope="col">Hard range</th>
                <th scope="col">Outside comfortable</th>
                <th scope="col">Outside hard</th>
              </tr>
            </thead>
            <tbody>
              {model.parts.map((part, index) => {
                const counts = selectedSuggestion.perPart[part.id]!;
                const range = voiceRanges[part.id]!;
                return (
                  <tr key={part.id}>
                    <th scope="row">{partLabel(part, index)}</th>
                    <td>
                      {range.comfortable.low}–{range.comfortable.high}
                    </td>
                    <td>
                      {range.hard.low}–{range.hard.high}
                    </td>
                    <td>
                      {counts.outsideComfortable === 0
                        ? 'None'
                        : noteCountLabel(counts.outsideComfortable)}
                    </td>
                    <td>
                      {counts.outsideHard === 0
                        ? 'None'
                        : noteCountLabel(counts.outsideHard)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="transposition-panel__source-note">
        Preview only: this panel does not write to the server. Apply passes a
        new transposed score model to your callback so it can create a separate
        score or version.
      </p>
      <footer className="transposition-panel__actions">
        {onCancel ? (
          <button
            className="button button--quiet"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        ) : null}
        <button
          className="button button--primary"
          type="button"
          onClick={() => applyFitSuggestion(model, selectedSuggestion, onApply)}
        >
          Apply to a new score/version
        </button>
      </footer>
    </section>
  );
}
