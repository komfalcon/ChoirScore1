import { Link } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';

function StaffIcon() {
  return (
    <svg viewBox="0 0 72 64" aria-hidden="true" focusable="false">
      <path d="M5 12h62M5 22h62M5 32h62M5 42h62M5 52h62" />
      <path d="M16 8v49m40-49v49" />
      <ellipse cx="33" cy="37" rx="6" ry="4" transform="rotate(-20 33 37)" />
      <path d="M38 35V17" />
      <ellipse cx="48" cy="27" rx="6" ry="4" transform="rotate(-20 48 27)" />
      <path d="M53 25V9" />
    </svg>
  );
}

export function StaffViewerWorkspace() {
  return (
    <main className="viewer-main" id="main-content" tabIndex={-1}>
      <Link className="viewer-back-link" to="/library">
        <span aria-hidden="true">←</span>
        Back to library
      </Link>

      <div className="viewer-heading">
        <div>
          <p className="eyebrow">STAFF NOTATION</p>
          <h1>Score viewer</h1>
          <p className="viewer-heading__copy">
            A clear, responsive page for reading choir scores.
          </p>
        </div>
        <span className="viewer-mode-label">Staff view</span>
      </div>

      <section
        className="staff-viewport"
        aria-labelledby="staff-viewport-title"
      >
        <div className="staff-viewport__bar">
          <div>
            <span className="staff-viewport__dot" aria-hidden="true" />
            <h2 id="staff-viewport-title">Notation</h2>
          </div>
          <span className="staff-viewport__status">Waiting for score data</span>
        </div>
        <div className="staff-viewport__canvas" role="status">
          <div className="staff-viewport__empty">
            <div className="staff-viewport__icon">
              <StaffIcon />
            </div>
            <h3>Score details will appear here</h3>
            <p>
              MusicXML loading and score metadata are waiting for the M2 score
              API handlers. No placeholder score is shown in place of real
              repertoire.
            </p>
          </div>
        </div>
      </section>

      <p className="viewer-contract-note">
        This view is prepared against the shared score contract. Sol-fa,
        playback, editing, and AI remain outside this M2 UI pass.
      </p>
    </main>
  );
}

export function ScoreViewPage() {
  return (
    <div className="app-page">
      <AppHeader />
      <StaffViewerWorkspace />
    </div>
  );
}
