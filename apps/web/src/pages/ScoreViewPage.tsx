import { useEffect, useRef, useState } from 'react';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { Link, useParams } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import {
  ScoreViewerStatePanel,
  type ScoreViewerState,
} from '../features/viewer/ScoreViewerState';
import {
  exportScoreMusicXml,
  getScoreDetail,
  isScoreRequestAborted,
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

type WorkspaceProps = {
  state: ScoreViewerState;
  onRetry: () => void;
  downloading: boolean;
  downloadError: string;
  onDownload: () => void;
};

export function StaffViewerWorkspace({
  state,
  onRetry,
  downloading,
  downloadError,
  onDownload,
}: WorkspaceProps) {
  const score = state.status === 'ready' ? state.response.score : null;
  return (
    <main className="viewer-main" id="main-content" tabIndex={-1}>
      <Link className="viewer-back-link" to="/library">
        <span aria-hidden="true">←</span>
        Back to library
      </Link>
      <div className="viewer-heading">
        <div>
          <p className="eyebrow">STAFF NOTATION</p>
          <h1>{score?.title ?? 'Score viewer'}</h1>
          <p className="viewer-heading__copy">
            {score
              ? `${score.composer ?? 'Composer not listed'} · ${score.measureCount} ${score.measureCount === 1 ? 'measure' : 'measures'}`
              : 'A clear, responsive page for reading choir scores.'}
          </p>
        </div>
        <span className="viewer-mode-label">Staff view</span>
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
          {downloadError ? (
            <p
              className="score-data-state score-data-state--error"
              role="alert"
            >
              {downloadError}
            </p>
          ) : null}
          <p className="viewer-contract-note">
            Sol-fa, playback, editing, and AI remain outside this M2 UI pass.
          </p>
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

  return (
    <div className="app-page">
      <AppHeader />
      <StaffViewerWorkspace
        state={state}
        onRetry={() => setRevision((current) => current + 1)}
        downloading={downloading}
        downloadError={downloadError}
        onDownload={() => void downloadMusicXml()}
      />
    </div>
  );
}
