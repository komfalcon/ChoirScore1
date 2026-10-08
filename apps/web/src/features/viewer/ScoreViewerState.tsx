import type {
  ApiErrorResponse,
  ScoreDetail,
  ScoreDetailResponse,
} from '@choirscore/shared';

export type ScoreViewerState =
  | { status: 'loading' }
  | { status: 'error'; error: ApiErrorResponse['error'] }
  | { status: 'ready'; response: ScoreDetailResponse };

type Props = { state: ScoreViewerState };

function ApiFailure({ error }: { error: ApiErrorResponse['error'] }) {
  if (error.code === 'FORBIDDEN') {
    return (
      <section className="score-data-state" role="alert">
        <h2>Access restricted</h2>
        <p>You do not have permission to view this score.</p>
      </section>
    );
  }

  if (error.code === 'NOT_FOUND') {
    return (
      <section className="score-data-state" role="alert">
        <h2>Score unavailable</h2>
        <p>This score is not available.</p>
      </section>
    );
  }

  if (error.code === 'UNAUTHENTICATED') {
    return (
      <section className="score-data-state" role="alert">
        <h2>Sign in required</h2>
        <p>Your session is not available. Sign in to view this score.</p>
      </section>
    );
  }

  return (
    <section className="score-data-state" role="alert">
      <h2>Score could not be loaded</h2>
      <p>{error.message}</p>
    </section>
  );
}

function ReadOnlyNotice({ score }: { score: ScoreDetail }) {
  if (score.preservation.state === 'opaque_constructs_preserved') {
    return (
      <p className="score-read-only-note" role="status">
        Read-only to preserve unsupported MusicXML content for safe export.
      </p>
    );
  }

  if (!score.canEditContent) {
    return (
      <p className="score-read-only-note" role="status">
        View-only access. Your permissions do not allow score-content changes.
      </p>
    );
  }

  return null;
}

export function ScoreViewerStatePanel({ state }: Props) {
  if (state.status === 'loading') {
    return (
      <p className="score-data-state" role="status" aria-busy="true">
        Loading score details…
      </p>
    );
  }

  if (state.status === 'error') return <ApiFailure error={state.error} />;

  const { score } = state.response;
  return (
    <section
      className="score-detail-summary"
      aria-labelledby="score-detail-title"
    >
      <div className="score-detail-summary__heading">
        <div>
          <p className="eyebrow">{score.visibility} score</p>
          <h2 id="score-detail-title">{score.title}</h2>
          <p>{score.composer ?? 'Composer not listed'}</p>
        </div>
        <span className="score-detail-summary__version">
          {score.measureCount}{' '}
          {score.measureCount === 1 ? 'measure' : 'measures'}
        </span>
      </div>
      <ul className="score-detail-summary__parts" aria-label="Score parts">
        {score.parts.map((part) => (
          <li key={part.id}>{part.label}</li>
        ))}
      </ul>
      <ReadOnlyNotice score={score} />
    </section>
  );
}
