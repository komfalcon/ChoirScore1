import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import { checkApiHealth } from '../lib/apiHealth';

type HealthState = 'checking' | 'available' | 'unavailable';

export function HealthPage() {
  const [health, setHealth] = useState<HealthState>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setHealth('checking');

    void checkApiHealth((path) =>
      apiFetch(path, { signal: controller.signal })
    ).then(
      () => {
        if (current) setHealth('available');
      },
      () => {
        if (current && !controller.signal.aborted) setHealth('unavailable');
      }
    );

    return () => {
      current = false;
      controller.abort();
    };
  }, [attempt]);

  const isChecking = health === 'checking';
  const isAvailable = health === 'available';
  const stateLabel = isChecking
    ? 'Checking'
    : isAvailable
      ? 'Available'
      : 'Unavailable';
  const stateMessage = isChecking
    ? 'Connecting to the ChoirScore service…'
    : isAvailable
      ? 'The app can reach the ChoirScore API.'
      : 'The service could not be reached just now. Check your connection and try again.';

  return (
    <div className="health-page">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="site-header">
        <a className="brand" href="/" aria-label="ChoirScore home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" focusable="false">
              <path d="M19 5v17.2a4.8 4.8 0 1 1-2-3.9V9.2l10-2.1v12.1a4.8 4.8 0 1 1-2-3.9V4.8L19 5Z" />
            </svg>
          </span>
          <span className="brand-name">ChoirScore</span>
        </a>
        <span className="private-label">
          <span className="private-label__dot" aria-hidden="true" />
          Private choir workspace
        </span>
      </header>

      <main className="page-main" id="main-content">
        <div className="landing-grid">
          <section className="intro" aria-labelledby="page-title">
            <p className="eyebrow">KINGS &amp; QUEENS CHOIR</p>
            <h1 id="page-title">Every part, in tune.</h1>
            <p className="intro-copy">
              A private home for the choir’s music, made for reading scores and
              rehearsing together.
            </p>
            <p className="intro-note">
              Member accounts are created by the choir administrator. There is
              no public sign-up.
            </p>
          </section>

          <section className="health-card" aria-labelledby="health-title">
            <div className="health-card__heading">
              <div>
                <p className="eyebrow">MILESTONE 0 · CONNECTION CHECK</p>
                <h2 id="health-title">ChoirScore service</h2>
              </div>
              <span
                className={`health-icon health-icon--${health}`}
                aria-hidden="true"
              >
                {isChecking ? '…' : isAvailable ? '✓' : '!'}
              </span>
            </div>

            <div
              className={`health-status health-status--${health}`}
              role={health === 'unavailable' ? 'alert' : 'status'}
              aria-live={health === 'unavailable' ? 'assertive' : 'polite'}
              aria-busy={isChecking}
            >
              <span className="health-status__indicator" aria-hidden="true" />
              <span className="health-status__content">
                <strong>{stateLabel}</strong>
                <span>{stateMessage}</span>
              </span>
            </div>

            {health === 'unavailable' ? (
              <button
                className="retry-button"
                type="button"
                onClick={() => setAttempt((previous) => previous + 1)}
              >
                Retry connection check
              </button>
            ) : null}

            <div className="health-card__footer">
              <span className="footer-mark" aria-hidden="true">
                ♫
              </span>
              <p>This check confirms the web app can reach its API.</p>
            </div>
          </section>
        </div>
      </main>

      <footer className="site-footer">
        <span>ChoirScore · Kings &amp; Queens Choir</span>
        <span>Private by design</span>
      </footer>
    </div>
  );
}
