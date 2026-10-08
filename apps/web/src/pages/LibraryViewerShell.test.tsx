import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppHeader } from '../components/AppHeader';
import { AuthProvider } from '../lib/auth';
import { LibraryWorkspace } from './LibraryPage';
import { StaffViewerWorkspace } from './ScoreViewPage';

const appStyles = readFileSync(
  new URL('../index.css', import.meta.url),
  'utf8'
);

function expectVisibleSkipLinkFocus(workspace: ReactNode, mainClass: string) {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <AuthProvider>
        <AppHeader />
      </AuthProvider>
      {workspace}
    </MemoryRouter>
  );
  const focusRule = appStyles.match(
    /\.library-main:focus-visible,\s*\.viewer-main:focus-visible\s*\{([^}]*)\}/s
  )?.[1];

  expect(html).toContain('href="#main-content"');
  expect(html).toContain('Skip to main content');
  expect(html).toContain(
    `<main class="${mainClass}" id="main-content" tabindex="-1">`
  );
  expect(focusRule).toMatch(/outline:\s*3px solid var\(--focus\)/);
  expect(focusRule).toMatch(/outline-offset:\s*4px/);
}

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

  it('keeps the skip link keyboard focus visible on the library main landmark', () => {
    expectVisibleSkipLinkFocus(<LibraryWorkspace />, 'library-main');
  });

  it('keeps the skip link keyboard focus visible on the viewer main landmark', () => {
    expectVisibleSkipLinkFocus(<StaffViewerWorkspace />, 'viewer-main');
  });
});
