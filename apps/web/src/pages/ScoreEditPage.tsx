import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScoreDetail } from '@choirscore/shared';
import { Link, useParams } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { SolfaGridEditor } from '../features/editor/SolfaGridEditor';
import { SolfaTextEditor } from '../features/editor/SolfaTextEditor';
import { SolfaEditorSession } from '../features/editor/solfaEditorSession';
import { useScoreAutosave } from '../features/editor/useScoreAutosave';
import { ScorePlaybackPanel } from '../features/playback/ScorePlaybackPanel';
import { ScoreViewerStatePanel } from '../features/viewer/ScoreViewerState';
import { useAuth } from '../lib/auth';
import {
  createScoreVersion,
  getScoreDetail,
  isScoreRequestAborted,
  toScoreUiError,
  type ScoreUiError,
} from '../lib/scoreApi';
import { modelToSolfaText, type ScoreModel } from '@choirscore/shared';
import './ScoreEditPage.css';

type PageState =
  | { status: 'loading' }
  | { status: 'error'; error: ScoreUiError }
  | { status: 'ready'; score: ScoreDetail };

type EditorMode = 'grid' | 'text';

function supportedBySolfaEditor(model: ScoreModel): boolean {
  try {
    modelToSolfaText(model);
    return true;
  } catch {
    return false;
  }
}

function autosaveMessage(status: string): string {
  switch (status) {
    case 'scheduled':
      return 'Draft autosave is scheduled on the normal 30-second cadence.';
    case 'saving':
      return 'Saving a working draft…';
    case 'retrying':
      return 'The working draft will retry with the same request.';
    case 'conflict':
      return 'The server has a newer version. Your local draft is preserved.';
    case 'invalid':
      return 'This draft is not valid for the score API and was not sent.';
    case 'read-only':
      return 'This score is read-only. No more content writes will be sent.';
    case 'error':
      return 'The working draft could not be saved. Your local edits remain here.';
    default:
      return 'No unsaved working draft.';
  }
}

function EditWorkspace({
  score,
  profileVoicePart,
}: {
  score: ScoreDetail;
  profileVoicePart: string | null;
}) {
  const [draft, setDraft] = useState(score.model);
  const [persistedModel, setPersistedModel] = useState(score.model);
  const [immutableVersionId, setImmutableVersionId] = useState(
    score.currentVersionId
  );
  const [session] = useState(() => new SolfaEditorSession());
  const [mode, setMode] = useState<EditorMode>('grid');
  const [draftRevision, setDraftRevision] = useState(0);
  const [savingVersion, setSavingVersion] = useState(false);
  const [serverReadOnly, setServerReadOnly] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const saveInProgress = useRef(false);

  const editorSupported = useMemo(() => supportedBySolfaEditor(draft), [draft]);
  const opaqueUnsupported =
    score.preservation.state === 'opaque_constructs_preserved';
  const fallbackOnly = opaqueUnsupported || !editorSupported;
  const permissionAllowsEdits =
    score.canEdit &&
    score.canEditContent &&
    !opaqueUnsupported &&
    editorSupported;
  const autosave = useScoreAutosave({
    scoreId: score.id,
    canEditContent: permissionAllowsEdits && !serverReadOnly && !savingVersion,
    currentVersionId: immutableVersionId,
    model: draft,
    persistedModel,
    onDraftChange: setDraft,
  });
  const blockedByAutosaveReadOnly =
    permissionAllowsEdits && !savingVersion && autosave.status === 'read-only';
  const canEditContent =
    permissionAllowsEdits &&
    !serverReadOnly &&
    !savingVersion &&
    !blockedByAutosaveReadOnly;
  const dirty = JSON.stringify(draft) !== JSON.stringify(persistedModel);
  const saveBlockedByAutosave = ['saving', 'retrying', 'conflict'].includes(
    autosave.status
  );
  const canSaveVersion =
    canEditContent && dirty && !savingVersion && !saveBlockedByAutosave;
  const canResetDraft =
    canEditContent && !savingVersion && autosave.status !== 'conflict';
  const currentBaseVersionId = autosave.currentVersionId ?? immutableVersionId;

  function changeDraft(next: ScoreModel) {
    if (JSON.stringify(next) === JSON.stringify(draft)) return;
    setDraft(next);
    setDraftRevision((revision) => revision + 1);
    setSaveError('');
    setNotice('');
  }

  function resetDraft() {
    if (!canResetDraft) return;
    if (!autosave.resetDraft(persistedModel)) return;
    setDraftRevision((revision) => revision + 1);
    session.reset();
    setSaveError('');
    setNotice('Draft reset to the last explicitly saved immutable version.');
  }

  async function saveImmutableVersion() {
    if (!canSaveVersion || saveInProgress.current) return;
    saveInProgress.current = true;
    setSavingVersion(true);
    setSaveError('');
    setNotice('');
    const modelToSave = draft;
    try {
      const result = await createScoreVersion(
        score.id,
        modelToSave,
        'Sol-fa editor save'
      );
      setImmutableVersionId(result.versionId);
      setPersistedModel(modelToSave);
      setNotice(
        `A new immutable score version was saved (${result.versionId}).`
      );
    } catch (error) {
      const uiError = toScoreUiError(error);
      setSaveError(uiError.message);
      if (uiError.code === 'SCORE_CONTENT_READ_ONLY') {
        setServerReadOnly(true);
        session.reset();
      }
    } finally {
      saveInProgress.current = false;
      setSavingVersion(false);
    }
  }

  function rebaseLocalDraft() {
    if (autosave.resolveConflict(draft)) {
      setNotice(
        'Your local draft was explicitly rebased onto the latest server version; it remains unchanged and will resume normal autosaving.'
      );
      setSaveError('');
    }
  }

  const readOnlyFromApi =
    serverReadOnly || (blockedByAutosaveReadOnly && autosave.error !== null);

  return (
    <>
      <ScoreViewerStatePanel state={{ status: 'ready', response: { score } }} />

      {fallbackOnly ? (
        <section
          className="score-edit-fallback"
          aria-labelledby="score-edit-fallback-title"
        >
          <h2 id="score-edit-fallback-title">
            {opaqueUnsupported
              ? 'Editing is disabled to preserve unsupported score content'
              : 'This score is not supported by the Sol-fa editor'}
          </h2>
          <p>
            {opaqueUnsupported
              ? 'The original score contains opaque MusicXML content. It remains unchanged and no editor save or autosave request will be sent.'
              : 'The score can be viewed and exported, but this editor cannot safely represent all of its notation.'}
          </p>
          <Link
            className="button button--quiet"
            to={`/score/${encodeURIComponent(score.id)}`}
          >
            Open the read-only score viewer
          </Link>
        </section>
      ) : (
        <>
          {readOnlyFromApi ? (
            <p
              className="score-edit-banner score-edit-banner--warning"
              role="alert"
            >
              The score service marked this content read-only. Editing and
              further content writes are disabled for this session.
            </p>
          ) : null}
          {!score.canEditContent && !opaqueUnsupported ? (
            <p className="score-edit-banner" role="status">
              This score is view-only for your account. The editor is available
              only for inspection.
            </p>
          ) : null}
          <ScorePlaybackPanel
            key={`${score.id}:${immutableVersionId}:${draftRevision}`}
            score={draft}
            profileVoicePart={profileVoicePart}
          />
          <section className="score-edit-workspace" aria-label="Score editor">
            <div className="score-edit-toolbar">
              <div>
                <p className="eyebrow">M5 EDITOR</p>
                <h2>Score content</h2>
                <p className="score-edit-toolbar__version">
                  Autosave base: <code>{currentBaseVersionId}</code>
                </p>
              </div>
              <div className="score-edit-toolbar__actions">
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => void saveImmutableVersion()}
                  disabled={!canSaveVersion}
                >
                  {savingVersion ? 'Saving version…' : 'Save immutable version'}
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={resetDraft}
                  disabled={!canResetDraft}
                >
                  Reset draft
                </button>
              </div>
            </div>

            <div className="score-edit-status" aria-live="polite">
              <p role={readOnlyFromApi ? 'alert' : 'status'}>
                {readOnlyFromApi
                  ? 'Read-only: no further autosave attempts will run.'
                  : autosaveMessage(autosave.status)}
              </p>
              {dirty ? (
                <span>Draft differs from the last immutable Save.</span>
              ) : null}
            </div>

            {saveError ? (
              <p
                className="score-edit-banner score-edit-banner--error"
                role="alert"
              >
                {saveError}
              </p>
            ) : null}
            {notice ? (
              <p className="score-edit-banner" role="status">
                {notice}
              </p>
            ) : null}

            {autosave.status === 'error' && autosave.error ? (
              <div
                className="score-edit-banner score-edit-banner--error"
                role="alert"
              >
                <p>{toScoreUiError(autosave.error).message}</p>
                <button
                  className="button button--quiet button--small"
                  type="button"
                  onClick={autosave.retryNow}
                >
                  Retry draft save
                </button>
              </div>
            ) : null}

            {autosave.status === 'conflict' && autosave.conflict ? (
              <section
                className="score-edit-conflict"
                aria-labelledby="score-edit-conflict-title"
              >
                <h3 id="score-edit-conflict-title">
                  Resolve score version conflict
                </h3>
                <p>
                  Your local draft is preserved. Nothing will be submitted again
                  until you explicitly rebase it.
                </p>
                {autosave.conflict.latestVersionId ? (
                  <p>
                    Latest server version:{' '}
                    <code>{autosave.conflict.latestVersionId}</code>
                  </p>
                ) : autosave.error ? (
                  <p role="alert">{toScoreUiError(autosave.error).message}</p>
                ) : (
                  <p role="status">Loading the latest server version…</p>
                )}
                {autosave.conflict.latestModel ? (
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={rebaseLocalDraft}
                    disabled={!canEditContent}
                  >
                    Rebase my preserved draft onto latest version
                  </button>
                ) : (
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={autosave.retryNow}
                    disabled={!autosave.error}
                  >
                    Retry loading latest version
                  </button>
                )}
              </section>
            ) : null}

            <div
              className="score-edit-mode-switch"
              role="group"
              aria-label="Editor mode"
            >
              <button
                className="button button--quiet button--small"
                type="button"
                aria-pressed={mode === 'grid'}
                onClick={() => setMode('grid')}
              >
                Grid
              </button>
              <button
                className="button button--quiet button--small"
                type="button"
                aria-pressed={mode === 'text'}
                onClick={() => setMode('text')}
              >
                Text
              </button>
            </div>
            {mode === 'grid' ? (
              <SolfaGridEditor
                model={draft}
                canEditContent={canEditContent}
                onChange={changeDraft}
                session={session}
              />
            ) : (
              <SolfaTextEditor
                model={draft}
                canEditContent={canEditContent}
                onChange={changeDraft}
                session={session}
              />
            )}
          </section>
        </>
      )}
    </>
  );
}

export function ScoreEditPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<PageState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    if (!id) {
      setState({
        status: 'error',
        error: { code: 'NOT_FOUND', message: 'This score is not available.' },
      });
      return () => controller.abort();
    }
    void getScoreDetail(id, controller.signal)
      .then(({ score }) => {
        if (!controller.signal.aborted) setState({ status: 'ready', score });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !isScoreRequestAborted(error)) {
          setState({ status: 'error', error: toScoreUiError(error) });
        }
      });
    return () => controller.abort();
  }, [id, revision]);

  const visibleState: PageState =
    state.status === 'ready' && state.score.id !== id
      ? { status: 'loading' }
      : state;

  return (
    <div className="app-page">
      <AppHeader />
      <main
        className="viewer-main score-edit-main"
        id="main-content"
        tabIndex={-1}
      >
        <Link
          className="viewer-back-link"
          to={
            visibleState.status === 'ready'
              ? `/score/${encodeURIComponent(visibleState.score.id)}`
              : '/library'
          }
        >
          <span aria-hidden="true">←</span>
          {visibleState.status === 'ready'
            ? 'Back to score'
            : 'Back to library'}
        </Link>
        <div className="viewer-heading">
          <div>
            <p className="eyebrow">CHOIR SCORE</p>
            <h1>
              {visibleState.status === 'ready'
                ? visibleState.score.title
                : 'Edit score'}
            </h1>
            <p className="viewer-heading__copy">
              Make controlled Sol-fa edits, keep a working draft, and save
              immutable versions explicitly.
            </p>
          </div>
        </div>
        {visibleState.status === 'loading' ? (
          <p className="score-data-state" role="status" aria-busy="true">
            Loading score details…
          </p>
        ) : visibleState.status === 'error' ? (
          <section className="score-data-state" role="alert">
            <h2>Score could not be loaded</h2>
            <p>{visibleState.error.message}</p>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => setRevision((current) => current + 1)}
            >
              Retry
            </button>
          </section>
        ) : (
          <EditWorkspace
            key={`${visibleState.score.id}:${visibleState.score.currentVersionId}:${revision}`}
            score={visibleState.score}
            profileVoicePart={user?.voicePart ?? null}
          />
        )}
      </main>
    </div>
  );
}
