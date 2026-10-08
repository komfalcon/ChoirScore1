import { AppHeader } from '../components/AppHeader';

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="10.8" cy="10.8" r="6.2" />
      <path d="m15.4 15.4 4.1 4.1" />
    </svg>
  );
}

function MusicPageIcon() {
  return (
    <svg viewBox="0 0 96 72" aria-hidden="true" focusable="false">
      <path d="M12 14h72M12 25h72M12 36h72M12 47h72M12 58h72" />
      <ellipse cx="37" cy="42" rx="7" ry="4.5" transform="rotate(-22 37 42)" />
      <path d="M43 40V17m0 0c9 1 13 6 13 13" />
      <ellipse cx="64" cy="31" rx="7" ry="4.5" transform="rotate(-22 64 31)" />
      <path d="M70 29V8m0 0c8 1 12 5 12 12" />
    </svg>
  );
}

export function LibraryWorkspace() {
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
        <button
          className="button button--quiet library-import"
          type="button"
          disabled
          aria-describedby="library-contract-note"
        >
          <span aria-hidden="true">＋</span>
          Import score
        </button>
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
            disabled
            aria-describedby="library-contract-note"
          />
        </label>
        <label className="library-filter">
          <span className="sr-only">Filter by visibility</span>
          <select
            disabled
            aria-describedby="library-contract-note"
            defaultValue="all"
          >
            <option value="all">All visibility</option>
          </select>
        </label>
      </section>

      <section className="library-empty" aria-labelledby="library-empty-title">
        <div className="library-empty__illustration">
          <MusicPageIcon />
        </div>
        <p className="eyebrow">YOUR REPERTOIRE</p>
        <h2 id="library-empty-title">Your scores will find their place here</h2>
        <p className="library-empty__copy">
          The responsive library layout is ready. Score cards, search,
          visibility filters, and imports will be connected after the shared
          score summary and API contract are agreed.
        </p>
        <p className="library-contract-note" id="library-contract-note">
          Score data is not connected yet; these controls are intentionally
          inactive until the M2 contract is finalized.
        </p>
      </section>
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
