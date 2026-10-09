import { useId, useMemo, useState } from 'react';
import {
  suggestFit,
  transpose,
  voiceRangesForScoreParts,
  type FitSuggestion,
  type ScoreModel,
  type VoiceRanges,
} from '@choirscore/shared';

export type FitScope = { partId: string | null };

export type TranspositionRangeFitPanelProps = {
  model: ScoreModel;
  voiceRanges: VoiceRanges;
  /** Resolved profile voice part; used as the initial scope only when in this score. */
  resolvedUserPartId?: string | null;
  /** Receives a fresh transposed model; the caller decides whether to create a score/version. */
  onApply: (
    transposedModel: ScoreModel,
    suggestion: FitSuggestion,
    scope: FitScope
  ) => void;
  onCancel?: () => void;
};

/** The exact Apply path used by the panel; previewing never calls this helper. */
export function applyFitSuggestion(
  model: ScoreModel,
  suggestion: FitSuggestion,
  scope: FitScope,
  onApply: TranspositionRangeFitPanelProps['onApply']
): void {
  const transposedModel = transpose(model, { semitones: suggestion.semitones });
  onApply(transposedModel, suggestion, scope);
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

function candidateFitLabel(
  suggestion: FitSuggestion,
  selectedPartOnly: boolean
): string {
  if (!suggestion.fitsHard) {
    return selectedPartOnly
      ? 'Selected part has hard-range violations'
      : 'Hard-range violations';
  }
  if (!suggestion.fitsComfortable) {
    return selectedPartOnly
      ? 'Within selected part hard range'
      : 'Within hard range';
  }
  return selectedPartOnly
    ? 'Comfortable for selected part'
    : 'Comfortable for all parts';
}

function partLabel(part: ScoreModel['parts'][number], index: number): string {
  return part.name?.trim() || `Part ${index + 1}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Range data could not be validated.';
}

export function TranspositionRangeFitPanel({
  model,
  voiceRanges,
  resolvedUserPartId,
  onApply,
  onCancel,
}: TranspositionRangeFitPanelProps) {
  const panelId = useId();
  const [chosenShift, setChosenShift] = useState<number | null>(null);
  const [chosenPartId, setChosenPartId] = useState<string | null>(() =>
    resolvedUserPartId &&
    model.parts.some((part) => part.id === resolvedUserPartId)
      ? resolvedUserPartId
      : null
  );
  const partId =
    chosenPartId && model.parts.some((part) => part.id === chosenPartId)
      ? chosenPartId
      : null;
  const scoreVoiceRanges = useMemo(
    () => voiceRangesForScoreParts(model.parts, voiceRanges),
    [model.parts, voiceRanges]
  );
  const fitResult = useMemo(() => {
    try {
      return {
        fit: suggestFit(model, scoreVoiceRanges, partId ? { partId } : {}),
        error: null,
      };
    } catch (error) {
      return { fit: null, error: errorMessage(error) };
    }
  }, [model, scoreVoiceRanges, partId]);
  const fit = fitResult.fit;
  const selectedSuggestion = fit
    ? (fit.suggestions.find(
        (suggestion) => suggestion.semitones === chosenShift
      ) ?? fit.suggestions[0]!)
    : null;
  const selectedPart = model.parts.find((part) => part.id === partId);
  const selectedPartIndex = selectedPart
    ? model.parts.indexOf(selectedPart)
    : -1;
  const groupName = `${panelId}-candidate`;
  const instructionId = `${panelId}-candidate-help`;
  const scopeHelpId = `${panelId}-scope-help`;
  const consequencesHeadingId = `${panelId}-consequences`;
  const selectedSummary = selectedSuggestion
    ? candidateFitLabel(selectedSuggestion, partId !== null)
    : '';

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
            Compare the three best shifts for the selected ranking scope. Your
            source score stays unchanged until you choose Apply.
          </p>
        </div>
      </header>

      <div className="transposition-panel__scope">
        <label htmlFor={`${panelId}-scope`}>Rank suggestions for</label>
        <select
          id={`${panelId}-scope`}
          value={partId ?? ''}
          aria-describedby={scopeHelpId}
          onChange={(event) =>
            setChosenPartId(event.currentTarget.value || null)
          }
        >
          <option value="">All parts</option>
          {model.parts.map((part, index) => (
            <option key={part.id} value={part.id}>
              {partLabel(part, index)} ({part.id})
            </option>
          ))}
        </select>
        <p id={scopeHelpId}>
          This changes which parts determine the ranking. Range consequences,
          when available, always include every score part.
        </p>
      </div>

      {fit && selectedSuggestion ? (
        <>
          <fieldset className="transposition-panel__fieldset">
            <legend>Top three transposition candidates</legend>
            <p id={instructionId} className="transposition-panel__hint">
              {partId
                ? `Ranked for ${partLabel(selectedPart!, selectedPartIndex)} (${partId}) only; other parts do not affect these recommendations. Per-part consequences still include all score parts.`
                : 'Ranked across all score parts.'}{' '}
              Lower fit scores are better; hard-range notes carry extra weight.
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
                    <span>
                      {partId ? 'Selected-part fit score' : 'Fit score'}{' '}
                      {suggestion.score}
                    </span>
                    <span className="transposition-panel__candidate-fit">
                      {candidateFitLabel(suggestion, partId !== null)}
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
                  {partId
                    ? 'All score parts are shown, although rankings use only the selected part.'
                    : 'For all parts;'}{' '}
                  For {shiftLabel(selectedSuggestion.semitones).toLowerCase()},
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
            Preview only: this panel does not write to the server. Apply passes
            a new transposed score model and the current ranking scope to your
            callback so it can create a separate score or version.
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
              onClick={() =>
                applyFitSuggestion(
                  model,
                  selectedSuggestion,
                  { partId },
                  onApply
                )
              }
            >
              Apply to a new score/version
            </button>
          </footer>
        </>
      ) : (
        <>
          <div className="transposition-panel__unavailable" role="alert">
            <h3>Range fit unavailable</h3>
            <p>
              Fit requires complete, valid comfortable and hard ranges for every
              score part. {fitResult.error}
            </p>
          </div>
          {onCancel ? (
            <footer className="transposition-panel__actions">
              <button
                className="button button--quiet"
                type="button"
                onClick={onCancel}
              >
                Cancel
              </button>
            </footer>
          ) : null}
        </>
      )}
    </section>
  );
}
