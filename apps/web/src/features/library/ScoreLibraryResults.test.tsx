import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScoreLibraryResults } from './ScoreLibraryResults';
import {
  emptyScoreLibraryResponse,
  scoreLibraryResponse,
} from '../../test/scoreFixtures';

describe('ScoreLibraryResults', () => {
  it('renders an accessible loading state', () => {
    const html = renderToStaticMarkup(
      <ScoreLibraryResults state={{ status: 'loading' }} />
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Loading scores…');
  });

  it('renders an empty state from the shared list envelope', () => {
    const html = renderToStaticMarkup(
      <ScoreLibraryResults
        state={{ status: 'ready', response: emptyScoreLibraryResponse }}
      />
    );
    expect(html).toContain('No scores yet');
    expect(html).toContain(
      'Scores available to your account will appear here.'
    );
  });

  it('renders API failures as an alert without losing the API message', () => {
    const html = renderToStaticMarkup(
      <ScoreLibraryResults
        state={{
          status: 'error',
          error: { code: 'INTERNAL_ERROR', message: 'Please try again later.' },
        }}
      />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Scores could not be loaded');
    expect(html).toContain('Please try again later.');
  });

  it('renders permission denial distinctly from an empty library', () => {
    const html = renderToStaticMarkup(
      <ScoreLibraryResults
        state={{
          status: 'error',
          error: { code: 'FORBIDDEN', message: 'Not permitted.' },
        }}
      />
    );
    expect(html).toContain('Access restricted');
    expect(html).toContain('You do not have permission to view these scores.');
    expect(html).not.toContain('No scores yet');
  });

  it('renders only score-summary data from the contract when ready', () => {
    const html = renderToStaticMarkup(
      <ScoreLibraryResults
        state={{ status: 'ready', response: scoreLibraryResponse }}
      />
    );
    expect(html).toContain('Morning Light');
    expect(html).toContain('Traditional');
    expect(html).toContain('Soprano');
    expect(html).toContain('1 measure · 1 part');
  });
});
