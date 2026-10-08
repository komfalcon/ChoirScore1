import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { Link, useParams } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import {
  ScoreViewerStatePanel,
  type ScoreViewerState,
} from '../features/viewer/ScoreViewerState';
import { SolfaScore } from '../features/solfa/SolfaScore';
import {
  exportScoreMusicXml,
  getScoreDetail,
  isScoreRequestAborted,
  patchScoreMetadata,
  toScoreUiError,
} from '../lib/scoreApi';

function ScoreNotation({
  musicXml,
  title,
}: {
  musicXml: string;
  title: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [renderStatus, setRenderStatus] = useState<
    'loading' | 'ready' | 'error'
  >('loading');

  useEffect(() => {
    const target = element.current;
    if (!target) return;
    let cancelled = false;
    let renderer: OpenSheetMusicDisplay | undefined;
    setRenderStatus('loading');
    void import('opensheetmusicdisplay')
      .then(async ({ OpenSheetMusicDisplay: Renderer }) => {
        if (cancelled) return;
        renderer = new Renderer(target, {
          autoResize: true,
          backend: 'svg',
          drawingParameters: 'compacttight',
          pageFormat: 'Endless',
          drawTitle: false,
          drawSubtitle: false,
          drawComposer: false,
          disableCursor: true,
        });
        await renderer.load(musicXml, title);
        if (cancelled) return;
        renderer.render();
        setRenderStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setRenderStatus('error');
      });
    return () => {
      cancelled = true;
      try {
        renderer?.clear();
      } catch {
        // The component may unmount before OSMD finishes parsing the score.
      }
      target.replaceChildren();
    };
  }, [musicXml, title]);

  return (
    <div className="score-notation-shell">
      <div
        ref={element}
        className="score-notation"
        role="img"
        aria-label={`Staff notation for ${title}`}
        aria-busy={renderStatus === 'loading'}
      />
      {renderStatus === 'loading' ? (
        <p className="score-notation-message" role="status">
          Preparing staff notation…
        </p>
      ) : null}
      {renderStatus === 'error' ? (
        <p
          className="score-notation-message score-data-state--error"
          role="alert"
        >
          The original score is available, but its notation could not be
          rendered. Download the MusicXML file to open it in another notation
          app.
        </p>
      ) : null}
    </div>
  );
}

type ScoreMetadataDraft = { title: string; composer: string | null };

function ScoreMetadataEditor({
  title: initialTitle,
  composer: initialComposer,
  saving,
  error,
  onSave,
  onCancel,
}: {
  title: string;
  composer: string | null;
  saving: boolean;
  error: string;
  onSave: (metadata: ScoreMetadataDraft) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [composer, setComposer] = useState(initialComposer ?? '');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await onSave({
      title: title.trim(),
      composer: composer.trim() || null,
    });
    if (saved) onCancel();
  }

  return (
    <form
      className="score-metadata-editor"
      aria-labelledby="score-metadata-editor-title"
      onSubmit={(event) => void submit(event)}
    >
      <h2 id="score-metadata-editor-title">Edit score details</h2>
      <label>
        <span>Title</span>
        <input
          autoFocus
          name="title"
          value={title}
          maxLength={512}
          required
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
      </label>
      <label>
        <span>Composer</span>
        <input
          name="composer"
          value={composer}
          maxLength={512}
          onChange={(event) => setComposer(event.currentTarget.value)}
        />
      </label>
      <p className="score-metadata-editor__help">
        Leave composer blank if it is not known.
      </p>
      {error ? (
        <p className="score-data-state score-data-state--error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="score-metadata-editor__actions">
        <button
          className="button button--primary"
          type="submit"
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save details'}
        </button>
        <button
          className="button button--quiet"
          type="button"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

type WorkspaceProps = {
  state: ScoreViewerState;
  onRetry: () => void;
  downloading: boolean;
  downloadError: string;
  onDownload: () => void;
  metadataSaving: boolean;
  metadataError: string;
  metadataNotice: string;
  onSaveMetadata: (metadata: ScoreMetadataDraft) => Promise<boolean>;
  onClearMetadataMessage: () => void;
};

export function StaffViewerWorkspace({
  state,
  onRetry,
  downloading,
  downloadError,
  onDownload,
  metadataSaving,
  metadataError,
  metadataNotice,
  onSaveMetadata,
  onClearMetadataMessage,
}: WorkspaceProps) {
  const [metadataEditorOpen, setMetadataEditorOpen] = useState(false);
  const [notationMode, setNotationMode] = useState<'solfa' | 'staff'>('solfa');
  const score = state.status === 'ready' ? state.response.score : null;
  return (
    <main className="viewer-main" id="main-content" tabIndex={-1}>
      <Link className="viewer-back-link" to="/library">
        <span aria-hidden="true">←</span>
        Back to library
      </Link>
      <div className="viewer-heading">
        <div>
          <p className="eyebrow">CHOIR SCORE</p>
          <h1>{score?.title ?? 'Score viewer'}</h1>
          <p className="viewer-heading__copy">
            {score
              ? `${score.composer ?? 'Composer not listed'} · ${score.measureCount} ${score.measureCount === 1 ? 'measure' : 'measures'}`
              : 'A clear, responsive page for reading choir scores.'}
          </p>
        </div>
        <div className="viewer-heading__actions">
          {score?.canEdit && !metadataEditorOpen ? (
            <button
              className="button button--quiet button--small"
              type="button"
              onClick={() => {
                onClearMetadataMessage();
                setMetadataEditorOpen(true);
              }}
            >
              Edit title &amp; composer
            </button>
          ) : null}
          <div
            className="viewer-mode-switch"
            role="group"
            aria-label="Notation view"
          >
            <button
              className="button button--quiet button--small"
              type="button"
              aria-pressed={notationMode === 'solfa'}
              onClick={() => setNotationMode('solfa')}
            >
              Tonic Sol-fa
            </button>
            <button
              className="button button--quiet button--small"
              type="button"
              aria-pressed={notationMode === 'staff'}
              onClick={() => setNotationMode('staff')}
            >
              Staff view
            </button>
          </div>
        </div>
      </div>

      {state.status === 'loading' ? (
        <p className="score-data-state" role="status" aria-busy="true">
          Loading score details…
        </p>
      ) : null}
      {state.status === 'error' ? (
        <>
          <ScoreViewerStatePanel state={state} />
          <button
            className="button button--quiet viewer-retry"
            type="button"
            onClick={onRetry}
          >
            Retry
          </button>
        </>
      ) : null}
      {score ? (
        <>
          <ScoreViewerStatePanel state={state} />
          {metadataNotice ? (
            <p className="score-metadata-notice" role="status">
              {metadataNotice}
            </p>
          ) : null}
          {score.canEdit && metadataEditorOpen ? (
            <ScoreMetadataEditor
              key={score.id}
              title={score.title}
              composer={score.composer}
              saving={metadataSaving}
              error={metadataError}
              onSave={onSaveMetadata}
              onCancel={() => setMetadataEditorOpen(false)}
            />
          ) : null}
          {notationMode === 'solfa' ? (
            <SolfaScore
              model={score.model}
              title={score.title}
              preservedConstructs={score.preservation.preservedConstructs}
              onShowStaff={() => setNotationMode('staff')}
              onPrint={() => window.print()}
            />
          ) : (
            <section
              className="staff-viewport"
              aria-labelledby="staff-viewport-title"
            >
              <div className="staff-viewport__bar">
                <div>
                  <span className="staff-viewport__dot" aria-hidden="true" />
                  <h2 id="staff-viewport-title">Notation</h2>
                </div>
                <div className="staff-viewport__actions">
                  <span className="staff-viewport__status">Staff view</span>
                  <button
                    className="button button--quiet button--small"
                    type="button"
                    onClick={onDownload}
                    disabled={downloading}
                  >
                    {downloading ? 'Preparing…' : 'Download MusicXML'}
                  </button>
                </div>
              </div>
              <div className="staff-viewport__canvas">
                <ScoreNotation musicXml={score.musicXml} title={score.title} />
              </div>
            </section>
          )}
          {downloadError ? (
            <p
              className="score-data-state score-data-state--error"
              role="alert"
            >
              {downloadError}
            </p>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

export function ScoreViewPage() {
  const { id } = useParams();
  const [state, setState] = useState<ScoreViewerState>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataError, setMetadataError] = useState('');
  const [metadataNotice, setMetadataNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    setMetadataError('');
    setMetadataNotice('');
    if (!id) {
      setState({
        status: 'error',
        error: { code: 'NOT_FOUND', message: 'This score is not available.' },
      });
      return () => controller.abort();
    }
    void getScoreDetail(id, controller.signal)
      .then((response) => setState({ status: 'ready', response }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !isScoreRequestAborted(error)) {
          setState({ status: 'error', error: toScoreUiError(error) });
        }
      });
    return () => controller.abort();
  }, [id, revision]);

  async function downloadMusicXml() {
    if (!id || downloading) return;
    setDownloading(true);
    setDownloadError('');
    try {
      const result = await exportScoreMusicXml(id);
      const url = URL.createObjectURL(
        new Blob([result.body], {
          type: 'application/vnd.recordare.musicxml+xml;charset=utf-8',
        })
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setDownloadError(toScoreUiError(error).message);
    } finally {
      setDownloading(false);
    }
  }

  async function saveMetadata(metadata: ScoreMetadataDraft) {
    if (!id || state.status !== 'ready') return false;
    setMetadataSaving(true);
    setMetadataError('');
    setMetadataNotice('');
    try {
      const result = await patchScoreMetadata(id, metadata);
      setState((current) => {
        if (current.status !== 'ready' || current.response.score.id !== id) {
          return current;
        }
        const currentScore = current.response.score;
        return {
          status: 'ready',
          response: {
            score: {
              ...currentScore,
              ...result.score,
              model: {
                ...currentScore.model,
                title: result.score.title,
                composer: result.score.composer,
              },
            },
          },
        };
      });
      setMetadataNotice('Score title and composer updated.');
      return true;
    } catch (error) {
      setMetadataError(toScoreUiError(error).message);
      return false;
    } finally {
      setMetadataSaving(false);
    }
  }

  return (
    <div className="app-page">
      <AppHeader />
      <StaffViewerWorkspace
        state={state}
        onRetry={() => setRevision((current) => current + 1)}
        downloading={downloading}
        downloadError={downloadError}
        onDownload={() => void downloadMusicXml()}
        metadataSaving={metadataSaving}
        metadataError={metadataError}
        metadataNotice={metadataNotice}
        onSaveMetadata={saveMetadata}
        onClearMetadataMessage={() => {
          setMetadataError('');
          setMetadataNotice('');
        }}
      />
    </div>
  );
}
