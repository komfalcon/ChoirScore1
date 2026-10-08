import type {
  ApiErrorResponse,
  ScoreLibraryResponse,
  ScoreSummary,
} from '@choirscore/shared';

export type ScoreLibraryState =
  | { status: 'loading' }
  | { status: 'error'; error: ApiErrorResponse['error'] }
  | { status: 'ready'; response: ScoreLibraryResponse };

type Props = { state: ScoreLibraryState };

function ScoreCard({ score }: { score: ScoreSummary }) {
  return (
    <li className="score-card-list__item">
      <article className="score-card" aria-labelledby={`score-${score.id}`}>
        <div className="score-card__heading">
          <h2 id={`score-${score.id}`}>{score.title}</h2>
          <span className="score-card__visibility">{score.visibility}</span>
        </div>
        <p className="score-card__composer">
          {score.composer ?? 'Composer not listed'}
        </p>
        <p className="score-card__parts">
          {score.parts.map((part) => part.label).join(' · ')}
        </p>
        <p className="score-card__meta">
          {score.measureCount}{' '}
          {score.measureCount === 1 ? 'measure' : 'measures'}
          {' · '}
          {score.partCount} {score.partCount === 1 ? 'part' : 'parts'}
        </p>
      </article>
    </li>
  );
}

function ApiFailure({ error }: { error: ApiErrorResponse['error'] }) {
  if (error.code === 'FORBIDDEN') {
    return (
      <section className="score-data-state" role="alert">
        <h2>Access restricted</h2>
        <p>You do not have permission to view these scores.</p>
      </section>
    );
  }

  if (error.code === 'UNAUTHENTICATED') {
    return (
      <section className="score-data-state" role="alert">
        <h2>Sign in required</h2>
        <p>Your session is not available. Sign in to view the score library.</p>
      </section>
    );
  }

  return (
    <section className="score-data-state" role="alert">
      <h2>Scores could not be loaded</h2>
      <p>{error.message}</p>
    </section>
  );
}

export function ScoreLibraryResults({ state }: Props) {
  if (state.status === 'loading') {
    return (
      <p className="score-data-state" role="status" aria-busy="true">
        Loading scores…
      </p>
    );
  }

  if (state.status === 'error') return <ApiFailure error={state.error} />;

  if (state.response.scores.length === 0) {
    return (
      <section className="library-empty" role="status">
        <h2>No scores yet</h2>
        <p className="library-empty__copy">
          Scores available to your account will appear here.
        </p>
      </section>
    );
  }

  return (
    <ul className="score-card-list" aria-label="Scores">
      {state.response.scores.map((score) => (
        <ScoreCard key={score.id} score={score} />
      ))}
    </ul>
  );
}
