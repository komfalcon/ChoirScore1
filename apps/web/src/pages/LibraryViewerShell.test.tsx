import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LibraryWorkspace } from './LibraryPage';
import { StaffViewerWorkspace } from './ScoreViewPage';

describe('M2 library and staff viewer shells', () => {
  it('renders the library structure without claiming to have score data', () => {
    const html = renderToStaticMarkup(<LibraryWorkspace />);

    expect(html).toContain('<h1>Library</h1>');
    expect(html).toContain('Search by title or composer');
    expect(html).toContain('Filter by visibility');
    expect(html).toContain('Score data is not connected yet');
    expect(html).toContain('disabled=""');
  });

  it('renders the staff-viewer frame without adding deferred features', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <StaffViewerWorkspace />
      </MemoryRouter>
    );

    expect(html).toContain('<h1>Score viewer</h1>');
    expect(html).toContain('Waiting for score data');
    expect(html).toContain('MusicXML loading');
    expect(html).not.toContain('Tonic Sol-fa');
    expect(html).not.toContain('Playback');
    expect(html).not.toContain('Edit score');
    expect(html).not.toContain('AI tools');
  });
});
