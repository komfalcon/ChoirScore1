import { useEffect, useState } from 'react';
import type { ScoreSummary, ScoreVisibility } from '@choirscore/shared';
import {
  clearScoreAccess,
  patchScoreVisibility,
  toScoreUiError,
} from '../../lib/scoreApi';
import './ScoreSharingPanel.css';

type ScoreSharingPanelProps = {
  score: ScoreSummary;
  onScoreUpdated: (score: ScoreSummary) => void;
};

export function ScoreSharingPanel({
  score,
  onScoreUpdated,
}: ScoreSharingPanelProps) {
  const [selectedVisibility, setSelectedVisibility] = useState<ScoreVisibility>(
    score.visibility
  );
  const [confirmVisibilityChange, setConfirmVisibilityChange] = useState(false);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [revokingAccess, setRevokingAccess] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setSelectedVisibility(score.visibility);
    setConfirmVisibilityChange(false);
    setConfirmRevokeAll(false);
  }, [score.id, score.visibility]);

  if (!score.canManageAccess && !score.canChangeVisibility) return null;

  async function saveVisibility() {
    if (
      !score.canChangeVisibility ||
      selectedVisibility === score.visibility ||
      savingVisibility ||
      revokingAccess
    ) {
      return;
    }
    const leavesShared =
      score.visibility === 'shared' && selectedVisibility !== 'shared';
    if (leavesShared && !confirmVisibilityChange) {
      setError('');
      setNotice('');
      setConfirmVisibilityChange(true);
      return;
    }

    setSavingVisibility(true);
    setConfirmVisibilityChange(false);
    setError('');
    setNotice('');
    try {
      const result = await patchScoreVisibility(score.id, selectedVisibility);
      onScoreUpdated(result.score);
      setNotice(
        leavesShared
          ? 'Visibility updated. All explicit shared grants were removed; owner, admin, and director access is unchanged.'
          : 'Score visibility updated.'
      );
    } catch (requestError) {
      setError(toScoreUiError(requestError).message);
    } finally {
      setSavingVisibility(false);
    }
  }

  async function revokeAllAccess() {
    if (
      !score.canManageAccess ||
      score.visibility !== 'shared' ||
      !confirmRevokeAll ||
      revokingAccess ||
      savingVisibility
    ) {
      return;
    }
    setRevokingAccess(true);
    setError('');
    setNotice('');
    try {
      await clearScoreAccess(score.id);
      setConfirmRevokeAll(false);
      setNotice(
        'All explicit shared grants were removed. The score remains shared; owner, admin, and director access is unchanged.'
      );
    } catch (requestError) {
      setError(toScoreUiError(requestError).message);
    } finally {
      setRevokingAccess(false);
    }
  }

  function cancelVisibilityChange() {
    setSelectedVisibility(score.visibility);
    setConfirmVisibilityChange(false);
    setError('');
  }

  return (
    <section
      className="score-sharing-panel"
      aria-labelledby="score-sharing-title"
    >
      <div className="score-sharing-panel__heading">
        <div>
          <p className="eyebrow">ACCESS</p>
          <h2 id="score-sharing-title">Sharing and visibility</h2>
        </div>
      </div>

      {score.canChangeVisibility ? (
        <div className="score-sharing-panel__visibility">
          <label htmlFor="score-sharing-visibility">Score visibility</label>
          <div className="score-sharing-panel__visibility-actions">
            <select
              id="score-sharing-visibility"
              value={selectedVisibility}
              disabled={savingVisibility || revokingAccess}
              onChange={(event) => {
                setSelectedVisibility(
                  event.currentTarget.value as ScoreVisibility
                );
                setConfirmVisibilityChange(false);
                setError('');
                setNotice('');
              }}
            >
              <option value="private">Private</option>
              <option value="shared">Shared</option>
              {score.canSetChoirVisibility || score.visibility === 'choir' ? (
                <option value="choir">Choir</option>
              ) : null}
            </select>
            <button
              className="button button--quiet button--small"
              type="button"
              onClick={() => void saveVisibility()}
              disabled={
                savingVisibility ||
                revokingAccess ||
                selectedVisibility === score.visibility
              }
            >
              {savingVisibility ? 'Saving visibility…' : 'Save visibility'}
            </button>
          </div>
          {score.visibility === 'shared' ? (
            <p className="score-sharing-panel__help">
              Leaving Shared removes all explicit recipient grants.
            </p>
          ) : null}
          {confirmVisibilityChange ? (
            <div
              className="score-sharing-panel__confirmation"
              role="group"
              aria-label="Confirm visibility change"
            >
              <p>
                This change removes every explicit shared grant. This screen
                cannot restore individual recipients afterward.
              </p>
              <button
                className="button button--danger-quiet button--small"
                type="button"
                onClick={() => void saveVisibility()}
                disabled={savingVisibility}
              >
                Confirm visibility change
              </button>
              <button
                className="button button--quiet button--small"
                type="button"
                onClick={cancelVisibilityChange}
                disabled={savingVisibility}
              >
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {score.visibility === 'shared' && score.canManageAccess ? (
        <div className="score-sharing-panel__grants">
          <h3>Explicit shared access</h3>
          <p>
            Recipient listing and individual view/edit changes are not available
            here. You can remove all explicit grants; owner, admin, and director
            access remains unchanged.
          </p>
          {confirmRevokeAll ? (
            <div
              className="score-sharing-panel__confirmation"
              role="group"
              aria-label="Confirm removing all explicit shared access"
            >
              <p>
                Remove every explicit recipient grant? The score will remain
                marked Shared, but this screen cannot restore individual
                recipients afterward.
              </p>
              <button
                className="button button--danger-quiet button--small"
                type="button"
                onClick={() => void revokeAllAccess()}
                disabled={revokingAccess || savingVisibility}
              >
                {revokingAccess ? 'Removing access…' : 'Confirm remove all'}
              </button>
              <button
                className="button button--quiet button--small"
                type="button"
                onClick={() => setConfirmRevokeAll(false)}
                disabled={revokingAccess}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="button button--danger-quiet button--small"
              type="button"
              onClick={() => {
                setError('');
                setNotice('');
                setConfirmRevokeAll(true);
              }}
              disabled={savingVisibility || revokingAccess}
            >
              Remove all shared access
            </button>
          )}
        </div>
      ) : null}

      {error ? (
        <p className="score-sharing-panel__error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="score-sharing-panel__notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
