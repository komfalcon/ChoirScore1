import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { MAX_MUSICXML_BYTES, type ScoreVisibility } from '@choirscore/shared';
import { AppHeader } from '../components/AppHeader';
import {
  ScoreLibraryResults,
  type ScoreLibraryState,
} from '../features/library/ScoreLibraryResults';
import {
  importScoreFile,
  isScoreRequestAborted,
  listScores,
  toScoreUiError,
} from '../lib/scoreApi';

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="10.8" cy="10.8" r="6.2" />
      <path d="m15.4 15.4 4.1 4.1" />
    </svg>
  );
}

export function LibraryWorkspace() {
  const fileInput = useRef<HTMLInputElement>(null);
  const loadMoreController = useRef<AbortController | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [mine, setMine] = useState(false);
  const [visibility, setVisibility] = useState<'all' | ScoreVisibility>('all');
  const [state, setState] = useState<ScoreLibraryState>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importNotice, setImportNotice] = useState<{
    id: string;
    title: string;
    warningCount: number;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    loadMoreController.current?.abort();
    loadMoreController.current = null;
    setLoadingMore(false);
    setState({ status: 'loading' });
    setLoadMoreError('');
    void listScores({
      query: debouncedQuery,
      mine,
      visibility: visibility === 'all' ? undefined : visibility,
      signal: controller.signal,
    })
      .then((response) => setState({ status: 'ready', response }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !isScoreRequestAborted(error)) {
          setState({ status: 'error', error: toScoreUiError(error) });
        }
      });
    return () => controller.abort();
  }, [debouncedQuery, mine, visibility, revision]);

  async function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['musicxml', 'xml', 'mxl'].includes(extension ?? '')) {
      setImportNotice(null);
      setImportError('Choose a .musicxml, .xml, or .mxl score file.');
      return;
    }
    if (file.size > MAX_MUSICXML_BYTES) {
      setImportNotice(null);
      setImportError('This file exceeds the 6 MiB upload limit.');
      return;
    }

    setImporting(true);
    setImportError('');
    setImportNotice(null);
    try {
      const result = await importScoreFile(file);
      setImportNotice({
        id: result.score.id,
        title: result.score.title,
        warningCount: result.warnings.length,
      });
      setRevision((current) => current + 1);
    } catch (error) {
      setImportError(toScoreUiError(error).message);
    } finally {
      setImporting(false);
    }
  }

  async function loadMore() {
    if (
      state.status !== 'ready' ||
      !state.response.nextCursor ||
      loadingMore ||
      query.trim() !== debouncedQuery
    ) {
      return;
    }
    const controller = new AbortController();
    loadMoreController.current?.abort();
    loadMoreController.current = controller;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const nextPage = await listScores({
        query: debouncedQuery,
        mine,
        visibility: visibility === 'all' ? undefined : visibility,
        cursor: state.response.nextCursor,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setState((current) =>
          current.status === 'ready'
            ? {
                status: 'ready',
                response: {
                  scores: [...current.response.scores, ...nextPage.scores],
                  nextCursor: nextPage.nextCursor,
                },
              }
            : current
        );
      }
    } catch (error) {
      if (!controller.signal.aborted && !isScoreRequestAborted(error)) {
        setLoadMoreError(toScoreUiError(error).message);
      }
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        setLoadingMore(false);
      }
    }
  }

  return (
    <main className="library-main" id="main-content" tabIndex={-1}>
      <div className="library-heading">
        <div>
          <p className="eyebrow">KINGS AND QUEENS CHOIR</p>
          <h1>Library</h1>
          <p className="library-heading__copy">
            A calm home for the music we sing together.
          </p>
        </div>
        <div>
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept=".musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,text/xml,application/zip"
            aria-label="Choose a MusicXML, XML, or MXL score file"
            tabIndex={-1}
            onChange={(event) => void handleImportChange(event)}
          />
          <button
            className="button button--quiet library-import"
            type="button"
            disabled={importing}
            aria-describedby="library-import-help"
            onClick={() => fileInput.current?.click()}
          >
            <span aria-hidden="true">＋</span>
            {importing ? 'Importing…' : 'Import score'}
          </button>
        </div>
      </div>
      <section className="library-tools" aria-label="Find scores">
        <label className="library-search">
          <span className="library-search__icon">
            <SearchIcon />
          </span>
          <span className="sr-only">Search by title or composer</span>
          <input
            type="search"
            placeholder="Search by title or composer"
            value={query}
            maxLength={120}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label className="library-filter">
          <span className="sr-only">Filter by visibility</span>
          <select
            aria-label="Filter by visibility"
            value={visibility}
            onChange={(event) =>
              setVisibility(
                event.currentTarget.value as 'all' | ScoreVisibility
              )
            }
          >
            <option value="all">All visibility</option>
            <option value="private">Private</option>
            <option value="choir">Choir</option>
            <option value="shared">Shared</option>
          </select>
        </label>
        <label className="library-mine-filter">
          <input
            type="checkbox"
            aria-label="Mine"
            checked={mine}
            onChange={(event) => setMine(event.currentTarget.checked)}
          />
          <span>Mine</span>
        </label>
      </section>
      <p className="library-contract-note" id="library-import-help">
        Imports create private scores. Supported files: MusicXML (.musicxml or
        .xml) and compressed MXL (.mxl), up to 6 MiB.
      </p>
      {importError ? (
        <p className="score-data-state score-data-state--error" role="alert">
          {importError}
        </p>
      ) : null}
      {importNotice ? (
        <p className="score-import-notice" role="status">
          <span>
            <strong>{importNotice.title}</strong> imported privately.
            {importNotice.warningCount > 0
              ? ` ${importNotice.warningCount} preservation warning${importNotice.warningCount === 1 ? '' : 's'} will keep this score read-only.`
              : ''}
          </span>{' '}
          <Link to={`/score/${encodeURIComponent(importNotice.id)}`}>
            View score
          </Link>
        </p>
      ) : null}
      <ScoreLibraryResults state={state} />
      {state.status === 'ready' && state.response.nextCursor ? (
        <div className="score-library-pagination">
          {loadMoreError ? (
            <p
              className="score-data-state score-data-state--error"
              role="alert"
            >
              {loadMoreError}
            </p>
          ) : null}
          <button
            className="button button--quiet"
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? 'Loading more…' : 'Load more scores'}
          </button>
        </div>
      ) : null}
    </main>
  );
}

export function LibraryPage() {
  return (
    <div className="app-page">
      <AppHeader />
      <LibraryWorkspace />
    </div>
  );
}
