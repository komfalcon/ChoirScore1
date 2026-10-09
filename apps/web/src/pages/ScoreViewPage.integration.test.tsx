// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  DEFAULT_VOICE_RANGES,
  scoreDetailResponseSchema,
} from '@choirscore/shared';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  scoreDetailResponse,
  scoreLibraryResponse,
} from '../test/scoreFixtures';
import { ScoreViewPage } from './ScoreViewPage';

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'member-1', voicePart: 'S' } }),
}));
vi.mock('../components/AppHeader', () => ({ AppHeader: () => null }));
vi.mock('opensheetmusicdisplay', () => ({
  OpenSheetMusicDisplay: class {
    private readonly target: HTMLElement;

    constructor(target: HTMLElement) {
      this.target = target;
    }

    async load() {}

    render() {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.target.append(svg);
    }

    clear() {
      this.target.replaceChildren();
    }
  },
}));

beforeAll(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

type ApiRequest = { url: string; method: string; body?: string };
type MockApiOptions = { delayProfile?: boolean; failApply?: boolean };

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockScoreApi(options: MockApiOptions = {}) {
  const requests: ApiRequest[] = [];
  const sourceModel = scoreDetailResponse.score.model;
  const originalModel = structuredClone(sourceModel);
  let savedModel: typeof sourceModel | undefined;
  let resolveProfile: ((response: Response) => void) | undefined;
  const pendingProfile = options.delayProfile
    ? new Promise<Response>((resolve) => {
        resolveProfile = resolve;
      })
    : null;
  let detailReads = 0;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : undefined;
      requests.push({ url, method, ...(body ? { body } : {}) });

      if (url === '/api/settings/voice-ranges') {
        return pendingProfile ?? jsonResponse(DEFAULT_VOICE_RANGES);
      }
      if (url === '/api/scores/score-1/versions' && method === 'POST') {
        const payload = JSON.parse(body ?? '{}') as {
          model: typeof sourceModel;
          note: string;
        };
        savedModel = payload.model;
        if (options.failApply) {
          return jsonResponse(
            {
              error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Version write failed; the original is unchanged.',
              },
            },
            500
          );
        }
        return jsonResponse(
          {
            score: scoreLibraryResponse.scores[0],
            versionId: 'version-2',
          },
          201
        );
      }
      if (url === '/api/scores/score-1' && method === 'GET') {
        detailReads += 1;
        if (!savedModel || options.failApply) {
          return jsonResponse(scoreDetailResponse);
        }
        return jsonResponse(
          scoreDetailResponseSchema.parse({
            score: {
              ...scoreDetailResponse.score,
              key: savedModel.key,
              currentVersionId: 'version-2',
              version: {
                ...scoreDetailResponse.score.version,
                id: 'version-2',
                note: 'Range-fit transposition',
              },
              model: savedModel,
            },
          })
        );
      }
      throw new Error(`Unexpected test request: ${method} ${url}`);
    }
  );
  vi.stubGlobal('fetch', fetchMock);

  return {
    requests,
    fetchMock,
    originalModel,
    get detailReads() {
      return detailReads;
    },
    get savedModel() {
      return savedModel;
    },
    releaseProfile(response: Response) {
      if (!resolveProfile)
        throw new Error('No delayed profile request exists.');
      resolveProfile(response);
    },
  };
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function renderPage() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={['/scores/score-1']}>
        <Routes>
          <Route path="/scores/:id" element={<ScoreViewPage />} />
        </Routes>
      </MemoryRouter>
    );
  });
  return host;
}

async function waitForElement(target: ParentNode, selector: string) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const element = target.querySelector(selector);
    if (element) return element;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function waitForText(target: ParentNode, text: string) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (target.textContent?.includes(text)) return;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }
  throw new Error(
    `Timed out waiting for text: ${text}. Current page text: ${target.textContent}`
  );
}

async function clickButton(target: ParentNode, label: string) {
  const button = Array.from(target.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label
  );
  expect(button, `Expected button “${label}”`).toBeTruthy();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function doubleClickButton(target: ParentNode, label: string) {
  const button = Array.from(target.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label
  );
  expect(button, `Expected button “${label}”`).toBeTruthy();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function chooseTargetKey(target: ParentNode) {
  const select = target.querySelector<HTMLSelectElement>(
    '.transposition-panel__target-key select'
  );
  expect(select).toBeTruthy();
  expect(
    Array.from(select!.options).some((option) => option.value === '2:major')
  ).toBe(true);
  await act(async () => {
    select!.value = '2:major';
    select!.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function openPanel(target: ParentNode) {
  await waitForElement(target, 'h1');
  await clickButton(target, 'Find a comfortable key');
  await waitForElement(target, '.transposition-panel');
}

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = undefined;
  }
  host?.remove();
  host = undefined;
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('score-route range-fit integration', () => {
  it('loads the member-safe voice ranges before making the panel available', async () => {
    const api = mockScoreApi({ delayProfile: true });
    const page = await renderPage();
    await waitForElement(page, 'h1');

    const settingsRequest = api.requests.find(
      (request) => request.url === '/api/settings/voice-ranges'
    );
    expect(settingsRequest).toEqual({
      url: '/api/settings/voice-ranges',
      method: 'GET',
    });
    await clickButton(page, 'Find a comfortable key');
    expect(page.textContent).toContain('Loading your saved voice ranges…');

    await act(async () =>
      api.releaseProfile(jsonResponse(DEFAULT_VOICE_RANGES))
    );
    await waitForElement(page, '.transposition-panel');
    expect(
      page.querySelector<HTMLSelectElement>(
        '.transposition-panel__scope select'
      )?.value
    ).toBe('voice-one');
    expect(JSON.stringify(DEFAULT_VOICE_RANGES)).not.toContain('adminOnly');
    expect(
      api.requests.filter((request) => request.method === 'POST')
    ).toHaveLength(0);
  });

  it('keeps preview and Cancel local with no version write or source mutation', async () => {
    const api = mockScoreApi();
    const page = await renderPage();
    await openPanel(page);
    await chooseTargetKey(page);
    expect(page.textContent).toContain('D5');
    expect(
      api.requests.filter((request) => request.method === 'POST')
    ).toHaveLength(0);

    await clickButton(page, 'Cancel');
    expect(page.querySelector('.transposition-panel')).toBeNull();
    expect(page.querySelector('h1')?.textContent).toBe('Morning Light');
    expect(api.detailReads).toBe(1);
    expect(scoreDetailResponse.score.model).toEqual(api.originalModel);
  });

  it('applies once through the version endpoint and displays the new score version', async () => {
    const api = mockScoreApi();
    const page = await renderPage();
    await openPanel(page);
    await chooseTargetKey(page);
    await doubleClickButton(page, 'Apply to a new score/version');
    await waitForText(page, 'A new transposed score version was saved.');

    const writes = api.requests.filter(
      (request) =>
        request.url === '/api/scores/score-1/versions' &&
        request.method === 'POST'
    );
    expect(writes).toHaveLength(1);
    const headers = new Headers(
      (
        api.fetchMock.mock.calls.find(
          ([url, init]) =>
            String(url) === '/api/scores/score-1/versions' &&
            init?.method === 'POST'
        )?.[1] as RequestInit
      ).headers
    );
    expect(headers.get('X-Requested-With')).toBe('choirscore');
    const saved = JSON.parse(writes[0]!.body ?? '{}') as {
      model: typeof api.originalModel;
      note: string;
    };
    expect(saved.model.parts[0]?.measures[0]?.notes[0]?.pitch).not.toBe('C5');
    expect(saved.note).toContain('Range-fit transposition to');
    expect(api.savedModel).toEqual(saved.model);
    expect(api.detailReads).toBe(2);
    expect(scoreDetailResponse.score.model).toEqual(api.originalModel);
    expect(page.querySelector('.transposition-panel')).toBeNull();
  });

  it('preserves the original viewer and source model when version creation fails', async () => {
    const api = mockScoreApi({ failApply: true });
    const page = await renderPage();
    await openPanel(page);
    await chooseTargetKey(page);
    await clickButton(page, 'Apply to a new score/version');
    await waitForText(page, 'Version write failed; the original is unchanged.');

    expect(
      api.requests.filter(
        (request) =>
          request.url === '/api/scores/score-1/versions' &&
          request.method === 'POST'
      )
    ).toHaveLength(1);
    expect(api.detailReads).toBe(1);
    expect(page.querySelector('h1')?.textContent).toBe('Morning Light');
    expect(page.querySelector('.transposition-panel')).toBeTruthy();
    expect(scoreDetailResponse.score.model).toEqual(api.originalModel);
  });
});
