import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScoreViewerStatePanel } from './ScoreViewerState';
import {
  opaqueReadOnlyScoreDetailResponse,
  scoreDetailResponse,
} from '../../test/scoreFixtures';

describe('ScoreViewerStatePanel', () => {
  it('renders an accessible loading state', () => {
    const html = renderToStaticMarkup(
      <ScoreViewerStatePanel state={{ status: 'loading' }} />
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Loading score details…');
  });

  it('renders a generic API failure as an alert', () => {
    const html = renderToStaticMarkup(
      <ScoreViewerStatePanel
        state={{
          status: 'error',
          error: { code: 'INTERNAL_ERROR', message: 'Please try again later.' },
        }}
      />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Score could not be loaded');
    expect(html).toContain('Please try again later.');
  });

  it('renders explicit permission denial without showing score metadata', () => {
    const html = renderToStaticMarkup(
      <ScoreViewerStatePanel
        state={{
          status: 'error',
          error: { code: 'FORBIDDEN', message: 'Not permitted.' },
        }}
      />
    );
    expect(html).toContain('Access restricted');
    expect(html).not.toContain('Morning Light');
  });

  it('keeps unknown and inaccessible scores indistinguishable for the 404 contract', () => {
    const html = renderToStaticMarkup(
      <ScoreViewerStatePanel
        state={{
          status: 'error',
          error: { code: 'NOT_FOUND', message: 'Not found.' },
        }}
      />
    );
    expect(html).toContain('Score unavailable');
    expect(html).toContain('This score is not available.');
    expect(html).not.toContain('does not exist');
  });

  it('surfaces preservation-driven read-only state from the shared detail contract', () => {
    const html = renderToStaticMarkup(
      <ScoreViewerStatePanel
        state={{ status: 'ready', response: opaqueReadOnlyScoreDetailResponse }}
      />
    );
    expect(html).toContain('Morning Light');
    expect(html).toContain(
      'Read-only to preserve unsupported MusicXML content'
    );
    expect(html).toContain('role="status"');
  });

  it('distinguishes view-only access from preservation read-only state', () => {
    const response = {
      score: {
        ...scoreDetailResponse.score,
        canEdit: false,
        canEditContent: false,
      },
    };
    const html = renderToStaticMarkup(
      <ScoreViewerStatePanel state={{ status: 'ready', response }} />
    );
    expect(html).toContain(
      'View-only access. Your permissions do not allow score-content changes.'
    );
    expect(html).not.toContain('unsupported MusicXML content');
  });
});
