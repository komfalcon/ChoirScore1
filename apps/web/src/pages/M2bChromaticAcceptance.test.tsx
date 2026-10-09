// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import {
  musicXmlToModel,
  scoreDetailResponseSchema,
  scoreModelSchema,
} from '@choirscore/shared';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { scoreDetailResponse } from '../test/scoreFixtures';
import { StaffViewerWorkspace } from './ScoreViewPage';
import xml from '../test/fixtures/m2b-chromatic-hymn.musicxml?raw';

beforeAll(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

vi.mock('opensheetmusicdisplay', () => ({
  OpenSheetMusicDisplay: class {
    private readonly target: HTMLElement;

    constructor(target: HTMLElement) {
      this.target = target;
    }

    async load() {}

    render() {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('data-testid', 'osmd-output');
      this.target.append(svg);
    }

    clear() {
      this.target.replaceChildren();
    }
  },
}));

const imported = musicXmlToModel(xml);
const { preservation: _preservation, ...modelWithoutPreservation } =
  imported.model;
const importedModel = scoreModelSchema.parse(modelWithoutPreservation);
const importedScoreResponse = scoreDetailResponseSchema.parse({
  score: {
    ...scoreDetailResponse.score,
    title: importedModel.title,
    composer: importedModel.composer ?? null,
    key: importedModel.key,
    time: importedModel.time,
    partIds: importedModel.parts.map((part) => part.id),
    parts: importedModel.parts.map((part) => ({
      id: part.id,
      label: part.name ?? part.id,
    })),
    partCount: importedModel.parts.length,
    measureCount: importedModel.parts[0]!.measures.length,
    canEditContent: imported.preservation.state === 'clean',
    preservation: imported.preservation,
    model: importedModel,
    musicXml: xml,
  },
});

const viewerProps = {
  state: { status: 'ready' as const, response: importedScoreResponse },
  userId: 'm2b-acceptance-member',
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

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function renderViewer() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter>
        <StaffViewerWorkspace {...viewerProps} />
      </MemoryRouter>
    );
  });
  return container;
}

async function clickButton(target: HTMLElement, label: string) {
  const button = Array.from(target.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label
  );
  expect(button, `Expected button “${label}”`).toBeTruthy();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function waitForElement(
  target: ParentNode,
  selector: string,
  timeoutMs = 1500
): Promise<Element> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const element = target.querySelector(selector);
    if (element) return element;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = undefined;
  }
  container?.remove();
  container = undefined;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('integrated M2b chromatic hymn acceptance', () => {
  it('imports independent MusicXML, renders aligned four-part Sol-fa, and falls back to staff view', async () => {
    const host = await renderViewer();

    expect(imported.warnings).toContainEqual(
      expect.objectContaining({
        code: 'UNSUPPORTED_CONSTRUCT_PRESERVED',
        message: expect.stringContaining(
          'Tie-stop notation is not represented'
        ),
      })
    );
    expect(imported.preservation.state).toBe('opaque_constructs_preserved');
    expect(importedModel.title).toBe('Hallelujah chromatic acceptance excerpt');
    expect(importedModel.parts).toHaveLength(4);
    expect(importedModel.parts[0]!.measures[1]!.key).toEqual({
      fifths: -2,
      mode: 'major',
    });
    expect(
      importedModel.parts[0]!.measures[0]!.notes.map((note) => note.pitch)
    ).toEqual(['C5', 'C5', 'C#5', 'Db5', 'D5']);

    expect(host.querySelector('h2#solfa-view-title')?.textContent).toBe(
      importedModel.title
    );
    expect(host.querySelector('.solfa-view__key')?.textContent).toContain(
      'Doh is C'
    );
    expect(
      Array.from(host.querySelectorAll('.solfa-view__metadata > div')).map(
        (item) => [
          item.querySelector('dt')?.textContent,
          item.querySelector('dd')?.textContent,
        ]
      )
    ).toEqual([
      ['Time', '4/4'],
      ['Tempo', '84 BPM'],
    ]);
    expect(
      host.querySelector('[aria-label="Key change: Doh is Bb"]')
    ).toBeTruthy();

    const partRows = ['Soprano', 'Alto', 'Tenor', 'Bass'].map((label) => {
      const part = host.querySelector(`[aria-label="${label} part"]`);
      expect(part, `${label} row is rendered`).toBeTruthy();
      return part!;
    });
    const rowLabels = partRows.map((part) =>
      Array.from(part.querySelectorAll('.solfa-token')).map((token) =>
        token.getAttribute('aria-label')
      )
    );
    expect(rowLabels).toEqual([
      [
        'do, octave above',
        'Held note',
        'di, octave above',
        'ra, octave above',
        're, octave above',
        'do, octave above',
        'Held note',
        'ti',
        'Unsupported note D#4; use staff view',
      ],
      ['mi', 'Held note', 'so', 'Held note', 'so', 'Held note', 'mi', 'so'],
      [
        'so, octave below',
        'Held note',
        're, octave below',
        'Held note',
        'mi, octave below',
        'Held note',
        'so, octave below',
        'mi, octave below',
      ],
      [
        'do, octave below',
        'Held note',
        'so, octave below, octave below',
        'Held note',
        'do, octave below',
        'Held note',
        'so, octave below, octave below',
        'Held note',
      ],
    ]);

    // Every part has the same two measures and four beat columns in each measure.
    const measureGridStyle = host
      .querySelector('.solfa-system__measure-headings')
      ?.getAttribute('style');
    expect(measureGridStyle).toContain('--solfa-measure-count: 2');
    expect(
      partRows.map((part) =>
        part.querySelector('.solfa-part-measures')?.getAttribute('style')
      )
    ).toEqual(Array(4).fill(measureGridStyle));
    expect(
      partRows.map((part) =>
        Array.from(part.querySelectorAll('.solfa-measure-cell')).map(
          (measure) => measure.querySelectorAll('.solfa-beat-group').length
        )
      )
    ).toEqual([
      [4, 4],
      [4, 4],
      [4, 4],
      [4, 4],
    ]);
    expect(
      partRows.map((part) =>
        Array.from(part.querySelectorAll('.solfa-beat-strip')).map((strip) =>
          (strip as HTMLElement).style.getPropertyValue('--solfa-beat-count')
        )
      )
    ).toEqual(Array.from({ length: 4 }, () => ['4', '4']));

    // Assert actual octave markup, not just the rendered text/accessibility label.
    const sopranoSuperscripts = Array.from(
      host.querySelectorAll(
        '[aria-label="Soprano part"] .solfa-token__syllable'
      )
    ).map((token) => token.querySelectorAll('sup').length);
    expect(sopranoSuperscripts).toEqual([1, 1, 1, 1, 1, 0]);
    const bassOctaveMarkup = Array.from(
      host.querySelectorAll('[aria-label="Bass part"] .solfa-token__syllable')
    ).map((token) => ({
      syllable: token.firstChild?.textContent,
      subscripts: Array.from(token.querySelectorAll('sub')).map(
        (subscript) => subscript.textContent
      ),
    }));
    expect(bassOctaveMarkup).toEqual([
      { syllable: 'd', subscripts: ['1'] },
      { syllable: 's', subscripts: ['11'] },
      { syllable: 'd', subscripts: ['1'] },
      { syllable: 's', subscripts: ['11'] },
    ]);

    const lyricRow = host.querySelector('[aria-label="Soprano, verse 1"]');
    expect(
      Array.from(lyricRow!.querySelectorAll('.solfa-token')).map(
        (token) => token.querySelector('.solfa-lyric__text')?.textContent ?? ''
      )
    ).toEqual(['Hal-', '', 'le-', 'lu-', 'jah', 'A-', '', 'men', '']);

    const warning = host.querySelector('[aria-label="Sol-fa limitations"]');
    expect(warning?.textContent).toContain(
      'chromatic pitch D#4 has no entry in the approved spelled-degree movable-Do table'
    );
    expect(
      host.querySelector(
        '[aria-label="Soprano part"] .solfa-token--unsupported'
      )?.textContent
    ).toBe('?');

    // Both the unsupported-feature fallback and the explicit mode toggle enter staff mode.
    await clickButton(host, 'View staff notation');
    expect(host.querySelector('.staff-viewport')).toBeTruthy();
    expect(
      host.querySelector('button[aria-pressed="true"]')?.textContent?.trim()
    ).toBe('Staff view');
    await waitForElement(host, 'svg[data-testid="osmd-output"]');

    await clickButton(host, 'Tonic Sol-fa');
    expect(host.querySelector('#solfa-view-title')).toBeTruthy();
    await clickButton(host, 'Staff view');
    expect(host.querySelector('.staff-viewport')).toBeTruthy();
    await waitForElement(host, 'svg[data-testid="osmd-output"]');
  });
});
