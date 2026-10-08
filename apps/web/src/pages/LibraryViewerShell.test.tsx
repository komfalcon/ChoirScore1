import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppHeader } from '../components/AppHeader';
import { AuthProvider } from '../lib/auth';
import { scoreDetailResponse } from '../test/scoreFixtures';
import { LibraryWorkspace } from './LibraryPage';
import { StaffViewerWorkspace } from './ScoreViewPage';

const appStyles = readFileSync(
  new URL('../index.css', import.meta.url),
  'utf8'
);
const readyViewerState = {
  status: 'ready' as const,
  response: scoreDetailResponse,
};

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

describe('M2 library and staff viewer integration shell', () => {
  it('renders live library controls and private-import guidance', () => {
    const html = renderToStaticMarkup(<LibraryWorkspace />);

    expect(html).toContain('<h1>Library</h1>');
    expect(html).toContain('Search by title or composer');
    expect(html).toContain('Filter by visibility');
    expect(html).toContain('Choose a MusicXML, XML, or MXL score file');
    expect(html).toContain('Imports create private scores.');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('Loading scores…');
  });

  it('renders connected score details without adding deferred features', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <StaffViewerWorkspace
          state={readyViewerState}
          onRetry={() => undefined}
          downloading={false}
          downloadError=""
          onDownload={() => undefined}
        />
      </MemoryRouter>
    );

    expect(html).toContain('<h1>Morning Light</h1>');
    expect(html).toContain('Notation');
    expect(html).toContain('Download MusicXML');
    expect(html).toContain('Staff notation for Morning Light');
    expect(html).not.toContain('Tonic Sol-fa');
    expect(html).not.toContain('Playback');
    expect(html).not.toContain('Edit score');
    expect(html).not.toContain('AI tools');
  });

  it('keeps the skip link keyboard focus visible on the library main landmark', () => {
    expectVisibleSkipLinkFocus(<LibraryWorkspace />, 'library-main');
  });

  it('keeps the skip link keyboard focus visible on the viewer main landmark', () => {
    expectVisibleSkipLinkFocus(
      <StaffViewerWorkspace
        state={readyViewerState}
        onRetry={() => undefined}
        downloading={false}
        downloadError=""
        onDownload={() => undefined}
      />,
      'viewer-main'
    );
  });
});
