import { useId, useMemo, useState } from 'react';
import {
  evaluateFitShift,
  keyAfterSemitoneShift,
  mapScorePartsToVoiceParts,
  midiForPitch,
  scoreKeyTonicName,
  suggestFit,
  transpose,
  voiceRangesForScoreParts,
  type FitSuggestion,
  type ScoreKey,
  type ScoreModel,
  type VoicePart,
  type VoiceRanges,
} from '@choirscore/shared';

export type FitScope = { partId: string | null };

export type TranspositionRangeFitPanelProps = {
  model: ScoreModel;
  /** Canonical persisted SATB settings keys; never keyed by MusicXML IDs. */
  voiceRanges: VoiceRanges;
  /** Persisted profile voicePart; resolved to the actual score-part ID here. */
  profileVoicePart?: VoicePart | null;
  /** Receives a fresh transposed model and actual score-part scope. */
  onApply: (
    transposedModel: ScoreModel,
    suggestion: FitSuggestion,
    scope: FitScope
  ) => void | Promise<void>;
  onCancel?: () => void;
  applying?: boolean;
  applyError?: string;
};

type TargetKeyOption = {
  id: string;
  key: ScoreKey;
  semitones: number;
};

/** The exact Apply path used by the panel; previewing never calls this helper. */
export function isNoOpFitSuggestion(
  model: ScoreModel,
  suggestion: FitSuggestion
): boolean {
  if (suggestion.manualTargetKey) {
    return (
      suggestion.manualTargetKey.fifths === model.key.fifths &&
      suggestion.manualTargetKey.mode === model.key.mode
    );
  }
  return suggestion.semitones === 0;
}

export function applyFitSuggestion(
  model: ScoreModel,
  suggestion: FitSuggestion,
  scope: FitScope,
  onApply: TranspositionRangeFitPanelProps['onApply']
): boolean {
  if (isNoOpFitSuggestion(model, suggestion)) return false;
  const transposedModel = suggestion.manualTargetKey
    ? transpose(model, { toKey: suggestion.manualTargetKey })
    : transpose(model, { semitones: suggestion.semitones });
  onApply(transposedModel, suggestion, scope);
  return true;
}

function shiftLabel(semitones: number): string {
  if (semitones === 0) return 'Original pitch';
  const direction = semitones > 0 ? 'Up' : 'Down';
  const amount = Math.abs(semitones);
  return `${direction} ${amount} ${amount === 1 ? 'semitone' : 'semitones'}`;
}

function keyId(key: ScoreKey): string {
  return `${key.fifths}:${key.mode}`;
}

function targetKeyLabel(key: ScoreKey): string {
  return `${scoreKeyTonicName(key)} ${key.mode}`;
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

function voicePartName(voicePart: Exclude<VoicePart, 'none'>): string {
  return { S: 'Soprano', A: 'Alto', T: 'Tenor', B: 'Bass' }[voicePart];
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Range data could not be validated.';
}

function targetKeyOptions(model: ScoreModel): TargetKeyOption[] {
  const shifts = Array.from({ length: 25 }, (_, index) => index - 12).sort(
    (left, right) => Math.abs(left) - Math.abs(right) || left - right
  );
  const options = new Map<string, TargetKeyOption>();
  for (const semitones of shifts) {
    const key = keyAfterSemitoneShift(model.key, semitones);
    const id = keyId(key);
    if (!options.has(id)) options.set(id, { id, key, semitones });
  }
  return [...options.values()].sort(
    (left, right) =>
      scoreKeyTonicName(left.key).localeCompare(scoreKeyTonicName(right.key)) ||
      left.key.mode.localeCompare(right.key.mode)
  );
}

export function TranspositionRangeFitPanel({
  model,
  voiceRanges,
  profileVoicePart,
  onApply,
  onCancel,
  applying = false,
  applyError = '',
}: TranspositionRangeFitPanelProps) {
  const panelId = useId();
  const [chosenShift, setChosenShift] = useState<number | null>(null);
  const [chosenPartId, setChosenPartId] = useState<string | null | undefined>(
    undefined
  );
  const [manualTargetKeyId, setManualTargetKeyId] = useState<string | null>(
    null
  );
  const rangeResolution = useMemo(() => {
    try {
      const mapping = mapScorePartsToVoiceParts(model.parts);
      const scoreVoiceRanges = voiceRangesForScoreParts(
        model.parts,
        voiceRanges
      );
      const requestedVoicePart =
        profileVoicePart && profileVoicePart !== 'none'
          ? profileVoicePart
          : null;
      const profilePartId = requestedVoicePart
        ? (mapping.byVoicePart[requestedVoicePart] ?? null)
        : null;
      if (requestedVoicePart && !profilePartId) {
        throw new TypeError(
          `No score part uniquely maps to profile voice part ${voicePartName(requestedVoicePart)} (${requestedVoicePart}).`
        );
      }
      return {
        scoreVoiceRanges,
        profilePartId,
        error: null,
      };
    } catch (error) {
      return {
        scoreVoiceRanges: null,
        profilePartId: null,
        error: errorMessage(error),
      };
    }
  }, [model.parts, profileVoicePart, voiceRanges]);
  const partId =
    chosenPartId === undefined ? rangeResolution.profilePartId : chosenPartId;
  const scopeError =
    partId && !model.parts.some((part) => part.id === partId)
      ? `Selected score part ${partId} is not present in the score.`
      : null;
  const fitResult = useMemo(() => {
    if (rangeResolution.error) {
      return { fit: null, error: rangeResolution.error };
    }
    if (scopeError) return { fit: null, error: scopeError };
    try {
      return {
        fit: suggestFit(
          model,
          rangeResolution.scoreVoiceRanges!,
          partId ? { partId } : {}
        ),
        error: null,
      };
    } catch (error) {
      return { fit: null, error: errorMessage(error) };
    }
  }, [model, partId, rangeResolution, scopeError]);
  const fit = fitResult.fit;
  const targetKeys = useMemo(() => targetKeyOptions(model), [model]);
  const selectedSuggestion = useMemo(() => {
    if (!fit || !rangeResolution.scoreVoiceRanges) return null;
    if (manualTargetKeyId) {
      const target = targetKeys.find(
        (option) => option.id === manualTargetKeyId
      );
      if (!target) return null;
      const evaluated = evaluateFitShift(
        model,
        rangeResolution.scoreVoiceRanges,
        target.semitones,
        partId ? { partId } : {}
      );
      return {
        ...evaluated,
        key: target.key,
        manualTargetKey: target.key,
        keyAccidentalCount: Math.abs(target.key.fifths),
      };
    }
    return (
      fit.suggestions.find(
        (suggestion) => suggestion.semitones === chosenShift
      ) ?? fit.suggestions[0]!
    );
  }, [
    chosenShift,
    fit,
    manualTargetKeyId,
    model,
    partId,
    rangeResolution.scoreVoiceRanges,
    targetKeys,
  ]);
  const selectedPart = model.parts.find((part) => part.id === partId);
  const selectedPartIndex = selectedPart
    ? model.parts.indexOf(selectedPart)
    : -1;
  const groupName = `${panelId}-candidate`;
  const instructionId = `${panelId}-candidate-help`;
  const scopeHelpId = `${panelId}-scope-help`;
  const targetKeyHelpId = `${panelId}-target-key-help`;
  const consequencesHeadingId = `${panelId}-consequences`;
  const notePreviewHeadingId = `${panelId}-note-preview`;
  const selectedSummary = selectedSuggestion
    ? candidateFitLabel(selectedSuggestion, partId !== null)
    : '';
  const previewModel = useMemo(
    () =>
      selectedSuggestion
        ? selectedSuggestion.manualTargetKey
          ? transpose(model, { toKey: selectedSuggestion.manualTargetKey })
          : transpose(model, { semitones: selectedSuggestion.semitones })
        : null,
    [model, selectedSuggestion]
  );
  const selectedTargetKeyId = selectedSuggestion
    ? keyId(selectedSuggestion.key)
    : '';
  const selectedSuggestionIsNoOp =
    selectedSuggestion !== null &&
    isNoOpFitSuggestion(model, selectedSuggestion);

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
          <div className="transposition-panel__target-key">
            <label htmlFor={`${panelId}-target-key`}>Manual target key</label>
            <select
              id={`${panelId}-target-key`}
              value={selectedTargetKeyId}
              aria-describedby={targetKeyHelpId}
              onChange={(event) =>
                setManualTargetKeyId(event.currentTarget.value || null)
              }
            >
              {targetKeys.map((option) => (
                <option key={option.id} value={option.id}>
                  {targetKeyLabel(option.key)}
                  {option.semitones === 0 ? ' · original key' : ''}
                </option>
              ))}
            </select>
            <p id={targetKeyHelpId}>
              Choose any supported target key. Its preview and range counts use
              the same ranking scope as the recommendations.
            </p>
          </div>

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
                  !manualTargetKeyId &&
                  suggestion.semitones === selectedSuggestion.semitones &&
                  keyId(suggestion.key) === keyId(selectedSuggestion.key);
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
                      onChange={() => {
                        setManualTargetKeyId(null);
                        setChosenShift(suggestion.semitones);
                      }}
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
              aria-label={`Range consequences for ${targetKeyLabel(selectedSuggestion.key)}`}
              tabIndex={0}
            >
              <table className="transposition-panel__table">
                <caption>
                  Range effects for {targetKeyLabel(selectedSuggestion.key)}
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
                    const range = rangeResolution.scoreVoiceRanges![part.id]!;
                    return (
                      <tr key={part.id}>
                        <th scope="row">
                          {partLabel(part, index)} ({part.id})
                        </th>
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

          <section
            className="transposition-panel__note-preview"
            aria-labelledby={notePreviewHeadingId}
          >
            <div className="transposition-panel__section-heading">
              <div>
                <h3 id={notePreviewHeadingId}>Note-level preview</h3>
                <p>
                  Preview in {targetKeyLabel(selectedSuggestion.key)}. Any note
                  outside its voice range is marked in red and labelled.
                </p>
              </div>
            </div>
            <div
              className="transposition-panel__note-preview-list"
              role="region"
              aria-label={`Transposed note preview for ${targetKeyLabel(selectedSuggestion.key)}`}
            >
              {previewModel!.parts.map((part, partIndex) => {
                const range = rangeResolution.scoreVoiceRanges![part.id]!;
                return (
                  <section
                    className="transposition-panel__preview-part"
                    key={part.id}
                    aria-label={`${partLabel(part, partIndex)} (${part.id}) preview`}
                  >
                    <h4>
                      {partLabel(part, partIndex)} ({part.id})
                    </h4>
                    {part.measures.map((measure) => (
                      <div
                        className="transposition-panel__preview-measure"
                        key={`${part.id}-${measure.number}`}
                      >
                        <span className="transposition-panel__preview-measure-label">
                          Measure {measure.number}
                        </span>
                        <ol aria-label={`Measure ${measure.number} notes`}>
                          {measure.notes.map((note, noteIndex) => {
                            if (note.pitch === null) return null;
                            const midi = midiForPitch(note.pitch);
                            const outsideHard =
                              midi < midiForPitch(range.hard.low) ||
                              midi > midiForPitch(range.hard.high);
                            const outsideComfortable =
                              midi < midiForPitch(range.comfortable.low) ||
                              midi > midiForPitch(range.comfortable.high);
                            const outOfRange =
                              outsideHard || outsideComfortable;
                            const status = outsideHard
                              ? 'outside hard range'
                              : outsideComfortable
                                ? 'outside comfortable range'
                                : 'within comfortable range';
                            return (
                              <li
                                className={`transposition-panel__preview-note${outOfRange ? ' transposition-panel__preview-note--out-of-range' : ''}`}
                                key={`${measure.number}-${noteIndex}`}
                                aria-label={`${partLabel(part, partIndex)}, measure ${measure.number}, note ${noteIndex + 1}: ${note.pitch}, ${status}`}
                              >
                                <span>{note.pitch}</span>
                                <span className="transposition-panel__preview-note-status">
                                  {outsideHard
                                    ? 'Outside hard range'
                                    : outsideComfortable
                                      ? 'Outside comfortable range'
                                      : 'Within comfortable range'}
                                </span>
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    ))}
                  </section>
                );
              })}
            </div>
          </section>

          <p className="transposition-panel__source-note">
            Preview only: this panel does not write to the server. Apply passes
            a new transposed score model and the current ranking scope, using
            actual score-part IDs, to your callback so it can create a separate
            score or version. The source model is never mutated.
          </p>
          {selectedSuggestionIsNoOp ? (
            <p className="transposition-panel__source-note" role="status">
              This is already the current key; choose a different shift or
              target key to create a version.
            </p>
          ) : null}
          <footer className="transposition-panel__actions">
            {onCancel ? (
              <button
                className="button button--quiet"
                type="button"
                disabled={applying}
                onClick={onCancel}
              >
                Cancel
              </button>
            ) : null}
            <button
              className="button button--primary"
              type="button"
              disabled={applying || selectedSuggestionIsNoOp}
              onClick={() =>
                void applyFitSuggestion(
                  model,
                  selectedSuggestion,
                  { partId },
                  onApply
                )
              }
            >
              {applying
                ? 'Creating new version…'
                : 'Apply to a new score/version'}
            </button>
          </footer>
          {applyError ? (
            <p
              className="score-data-state score-data-state--error"
              role="alert"
            >
              {applyError}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <div className="transposition-panel__unavailable" role="alert">
            <h3>Range fit unavailable</h3>
            <p>
              Fit requires a unique canonical SATB mapping and complete, valid
              comfortable and hard ranges for every score part.{' '}
              {fitResult.error ??
                'The selected target key is not available for this score.'}
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
