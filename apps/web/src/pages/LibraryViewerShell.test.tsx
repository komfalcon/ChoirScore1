import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppHeader } from '../components/AppHeader';
import { AuthProvider } from '../lib/auth';
import {
  opaqueReadOnlyScoreDetailResponse,
  scoreDetailResponse,
} from '../test/scoreFixtures';
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
const viewerWorkspaceProps = {
  onRetry: () => undefined,
  downloading: false,
  downloadError: '',
  onDownload: () => undefined,
  metadataSaving: false,
  metadataError: '',
  metadataNotice: '',
  onSaveMetadata: async () => true,
  onClearMetadataMessage: () => undefined,
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
  it('renders the Mine facet and accessible private-import controls', () => {
    const html = renderToStaticMarkup(<LibraryWorkspace />);

    expect(html).toContain('<h1>Library</h1>');
    expect(html).toContain('Search by title or composer');
    expect(html).toContain('Filter by visibility');
    expect(html).toContain('aria-label="Mine"');
    expect(html).toContain('Choose a MusicXML, XML, or MXL score file');
    const fileInput = html.match(/<input\b[^>]*type="file"[^>]*>/)?.[0];
    expect(fileInput).toContain('tabindex="-1"');
    const buttonFocusRule = appStyles.match(
      /button:focus-visible,\s*a:focus-visible\s*\{([^}]*)\}/s
    )?.[1];
    expect(buttonFocusRule).toMatch(/outline:\s*3px solid var\(--focus\)/);
    expect(html).toContain('Imports create private scores.');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('Loading scores…');
  });

  it('renders connected score details, notation, playback, and title/composer editing', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <StaffViewerWorkspace
          {...viewerWorkspaceProps}
          state={readyViewerState}
        />
      </MemoryRouter>
    );

    expect(html).toContain('<h1>Morning Light</h1>');
    expect(html).toContain('Notation');
    expect(html).toContain('Download MusicXML');
    expect(html).toContain('Edit title &amp; composer');
    expect(html).toContain('Staff notation for Morning Light');
    expect(html).toContain('<h2 id="score-playback-title">Playback</h2>');
    expect(html).toContain('1-measure count-in');
    expect(html).toContain('Off by default');
    expect(html).not.toContain('Tonic Sol-fa');
    expect(html).not.toContain('Edit score');
    expect(html).not.toContain('AI tools');
  });

  it('allows metadata edits for an owner even when preserved score content is read-only', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <StaffViewerWorkspace
          {...viewerWorkspaceProps}
          state={{
            status: 'ready',
            response: opaqueReadOnlyScoreDetailResponse,
          }}
        />
      </MemoryRouter>
    );

    expect(html).toContain('Edit title &amp; composer');
    expect(html).toContain(
      'Read-only to preserve unsupported MusicXML content'
    );
  });

  it('does not offer metadata editing to a score viewer without edit permission', () => {
    const viewOnlyState = {
      status: 'ready' as const,
      response: {
        score: {
          ...scoreDetailResponse.score,
          canEdit: false,
          canEditContent: false,
        },
      },
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <StaffViewerWorkspace {...viewerWorkspaceProps} state={viewOnlyState} />
      </MemoryRouter>
    );

    expect(html).not.toContain('Edit title &amp; composer');
    expect(html).toContain('Morning Light');
  });

  it('keeps the skip link keyboard focus visible on the library main landmark', () => {
    expectVisibleSkipLinkFocus(<LibraryWorkspace />, 'library-main');
  });

  it('keeps the skip link keyboard focus visible on the viewer main landmark', () => {
    expectVisibleSkipLinkFocus(
      <StaffViewerWorkspace
        {...viewerWorkspaceProps}
        state={readyViewerState}
      />,
      'viewer-main'
    );
  });
});
