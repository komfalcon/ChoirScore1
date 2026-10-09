// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import {
  modelToSolfaText,
  parseSolfaText,
  scoreDetailResponseSchema,
  type ScoreDetail,
  type ScoreModel,
} from '@choirscore/shared';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  opaqueReadOnlyScoreDetailResponse,
  scoreDetailResponse,
} from '../test/scoreFixtures';
import { LazyTonePlaybackEngine } from '../features/playback/LazyTonePlaybackEngine';
import { ScoreEditPage } from './ScoreEditPage';

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'member-1', voicePart: 'S' } }),
}));
vi.mock('../components/AppHeader', () => ({ AppHeader: () => null }));

const BASE_TEXT = `Doh is C
Time 4/4
Tempo 96
S: | d : r : m : f |
A: | d : r : m : f |
T: | d : r : m : f |
B: | d : r : m : f |
L1: one two three four`;
const baseModel = parseSolfaText(BASE_TEXT, { title: 'Morning Light' });

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

beforeAll(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

type DetailOptions = {
  id?: string;
  currentVersionId?: string;
  model?: ScoreModel;
  canEdit?: boolean;
  canEditContent?: boolean;
  preservation?: ScoreDetail['preservation'];
};

function makeDetail(options: DetailOptions = {}): ScoreDetail {
  const model = options.model ?? baseModel;
  const preservation =
    options.preservation ?? scoreDetailResponse.score.preservation;
  const canEdit = options.canEdit ?? true;
  const canEditContent =
    options.canEditContent ?? (canEdit && preservation.state === 'clean');
  return scoreDetailResponseSchema.parse({
    score: {
      ...scoreDetailResponse.score,
      id: options.id ?? 'score-1',
      title: model.title,
      composer: model.composer ?? null,
      key: model.key,
      time: model.time,
      partIds: model.parts.map((part) => part.id),
      parts: model.parts.map((part, index) => ({
        id: part.id,
        label: part.name ?? `Part ${index + 1}`,
      })),
      partCount: model.parts.length,
      measureCount: model.parts[0]?.measures.length ?? 1,
      canEdit,
      canEditContent,
      preservation,
      currentVersionId: options.currentVersionId ?? 'version-1',
      version: {
        ...scoreDetailResponse.score.version,
        id: options.currentVersionId ?? 'version-1',
      },
      model,
    },
  }).score;
}

function summaryOf(score: ScoreDetail) {
  const {
    currentVersionId: _currentVersionId,
    version: _version,
    model: _model,
    musicXml: _musicXml,
    ...summary
  } = score;
  return summary;
}

function replaceDetail(
  score: ScoreDetail,
  options: { model?: ScoreModel; currentVersionId?: string }
): ScoreDetail {
  return makeDetail({
    id: score.id,
    model: options.model ?? score.model,
    currentVersionId: options.currentVersionId ?? score.currentVersionId,
    canEdit: score.canEdit,
    canEditContent: score.canEditContent,
    preservation: score.preservation,
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type ApiRequest = { url: string; method: string; body?: string };

type ApiOptions = {
  conflictOnFirstAutosave?: boolean;
  holdFirstAutosaveUntilAbort?: boolean;
  transientFailureOnFirstAutosave?: boolean;
};

function mockScoreApi(options: ApiOptions = {}) {
  const initial = makeDetail();
  const scoreTwo = makeDetail({
    id: 'score-2',
    currentVersionId: 'version-two',
  });
  const latest = new Map<string, ScoreDetail>([
    [initial.id, initial],
    [scoreTwo.id, scoreTwo],
  ]);
  const requests: ApiRequest[] = [];
  const autosaveSignals: AbortSignal[] = [];
  let immutableSaveCount = 0;
  let autosaveCount = 0;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : undefined;
      requests.push({ url, method, ...(body ? { body } : {}) });
      const detailMatch = /^\/api\/scores\/([^/]+)$/.exec(url);
      const writeMatch = /^\/api\/scores\/([^/]+)\/(versions|autosaves)$/.exec(
        url
      );

      if (method === 'GET' && detailMatch) {
        const scoreId = decodeURIComponent(detailMatch[1]!);
        const score = latest.get(scoreId);
        if (!score) {
          return jsonResponse(
            { error: { code: 'NOT_FOUND', message: 'Score unavailable.' } },
            404
          );
        }
        return jsonResponse({ score });
      }

      if (method === 'POST' && writeMatch) {
        const scoreId = decodeURIComponent(writeMatch[1]!);
        const route = writeMatch[2];
        const current = latest.get(scoreId);
        if (!current) throw new Error(`Unknown test score ${scoreId}.`);
        const payload = JSON.parse(body ?? '{}') as {
          model: ScoreModel;
          note?: string;
          baseVersionId?: string;
          requestId?: string;
        };

        if (route === 'versions') {
          immutableSaveCount += 1;
          const versionId = `immutable-version-${immutableSaveCount}`;
          const updated = replaceDetail(current, {
            model: payload.model,
            currentVersionId: versionId,
          });
          latest.set(scoreId, updated);
          return jsonResponse({ score: summaryOf(updated), versionId }, 201);
        }

        autosaveCount += 1;
        const signal = init?.signal ?? undefined;
        if (signal) autosaveSignals.push(signal);
        if (options.holdFirstAutosaveUntilAbort && autosaveCount === 1) {
          return await new Promise<Response>((_resolve, reject) => {
            const abort = () =>
              reject(new DOMException('Request aborted.', 'AbortError'));
            if (signal?.aborted) abort();
            else signal?.addEventListener('abort', abort, { once: true });
          });
        }
        if (options.transientFailureOnFirstAutosave && autosaveCount === 1) {
          throw new TypeError('Temporary network failure.');
        }
        if (options.conflictOnFirstAutosave && autosaveCount === 1) {
          const remote = replaceDetail(current, {
            currentVersionId: 'version-remote',
          });
          latest.set(scoreId, remote);
          return jsonResponse(
            {
              error: {
                code: 'VERSION_CONFLICT',
                message: 'The score has a newer version.',
              },
            },
            409
          );
        }
        const currentVersionId = `autosave-version-${autosaveCount}`;
        const updated = replaceDetail(current, {
          model: payload.model,
          currentVersionId,
        });
        latest.set(scoreId, updated);
        return jsonResponse({
          score: summaryOf(updated),
          versionId: currentVersionId,
          currentVersionId,
          outcome: 'saved',
        });
      }

      throw new Error(`Unexpected test request: ${method} ${url}`);
    }
  );
  vi.stubGlobal('fetch', fetchMock);
  return { requests, latest, fetchMock, autosaveSignals };
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function NavigationActions() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/score/score-2/edit')}>
      Replace score route
    </button>
  );
}

async function renderPage({ navigation = false } = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={['/score/score-1/edit']}>
        {navigation ? <NavigationActions /> : null}
        <Routes>
          <Route path="/score/:id/edit" element={<ScoreEditPage />} />
        </Routes>
      </MemoryRouter>
    );
    await Promise.resolve();
  });
  return host;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function clickButton(target: ParentNode, text: string) {
  const button = Array.from(target.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === text
  );
  expect(button, `Expected button “${text}”`).toBeTruthy();
  await act(async () => button!.click());
}

async function editFirstGridNote(target: ParentNode, syllable = 'r') {
  const select = target.querySelector<HTMLSelectElement>(
    'select[aria-label="Sol-fa syllable"]'
  );
  expect(select).toBeTruthy();
  await act(async () => {
    select!.value = syllable;
    select!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const setPitch = Array.from(target.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === 'Set pitch'
  );
  expect(setPitch, 'Expected the Set pitch control').toBeTruthy();
  await act(async () => setPitch!.click());
}

async function advanceAutosaveCadence() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  await settle();
}

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = undefined;
  }
  host?.remove();
  host = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ScoreEditPage host integration', () => {
  it('keeps content read-only when permissions deny edits and sends no writes', async () => {
    const detail = makeDetail({ canEdit: false, canEditContent: false });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url === '/api/scores/score-1') {
          return jsonResponse({ score: detail });
        }
        throw new Error(`Unexpected permission test request: ${method} ${url}`);
      })
    );
    const page = await renderPage();
    expect(page.textContent).toContain(
      'This score is view-only for your account'
    );
    expect(
      page.querySelector<HTMLButtonElement>('button[aria-label="Undo edit"]')
        ?.disabled
    ).toBe(true);
    expect(
      page.querySelector<HTMLButtonElement>('button[aria-label="Redo edit"]')
        ?.disabled
    ).toBe(true);
    expect(
      Array.from(page.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Save immutable version'
      )?.disabled
    ).toBe(true);
    expect(
      page.querySelector<HTMLSelectElement>(
        'select[aria-label="Sol-fa syllable"]'
      )?.disabled
    ).toBe(true);
  });

  it('routes opaque preserved scores to a read-only fallback without mounting editors or playback', async () => {
    const detail = makeDetail({
      canEditContent: false,
      preservation: opaqueReadOnlyScoreDetailResponse.score.preservation,
    });
    const requests: ApiRequest[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        requests.push({ url, method });
        if (method === 'GET' && url === '/api/scores/score-1') {
          return jsonResponse({ score: detail });
        }
        throw new Error(`Unexpected opaque-score request: ${method} ${url}`);
      })
    );
    const page = await renderPage();
    expect(page.textContent).toContain(
      'Editing is disabled to preserve unsupported score content'
    );
    expect(page.querySelector('.solfa-grid-editor')).toBeNull();
    expect(page.querySelector('.solfa-text-editor')).toBeNull();
    expect(page.querySelector('.score-playback-panel')).toBeNull();
    expect(page.querySelector('a[href="/score/score-1"]')).not.toBeNull();
    expect(requests.filter((request) => request.method === 'POST')).toEqual([]);
  });

  it('shares edit history between Grid and Text and resets it with the draft', async () => {
    mockScoreApi();
    const page = await renderPage();
    const originalText = modelToSolfaText(baseModel);
    await editFirstGridNote(page);
    await clickButton(page, 'Text');
    const textarea = page.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Sol-fa text"]'
    );
    expect(textarea?.value).not.toBe(originalText);
    expect(
      page.querySelector<HTMLButtonElement>('button[aria-label="Undo edit"]')
        ?.disabled
    ).toBe(false);
    await clickButton(page, 'Undo');
    expect(
      page.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Sol-fa text"]'
      )?.value
    ).toBe(originalText);
    await clickButton(page, 'Redo');
    expect(
      page.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Sol-fa text"]'
      )?.value
    ).not.toBe(originalText);
    await clickButton(page, 'Reset draft');
    expect(
      page.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Sol-fa text"]'
      )?.value
    ).toBe(originalText);
    expect(
      page.querySelector<HTMLButtonElement>('button[aria-label="Undo edit"]')
        ?.disabled
    ).toBe(true);
  });

  it('keeps explicit immutable Save separate and advances autosave from its currentVersionId', async () => {
    vi.useFakeTimers();
    const api = mockScoreApi();
    const page = await renderPage();
    await editFirstGridNote(page);
    expect(api.requests.filter((request) => request.method === 'POST')).toEqual(
      []
    );

    await clickButton(page, 'Save immutable version');
    const versionWrites = api.requests.filter((request) =>
      request.url.endsWith('/versions')
    );
    expect(versionWrites).toHaveLength(1);
    expect(
      api.requests.filter((request) => request.url.endsWith('/autosaves'))
    ).toHaveLength(0);
    expect(JSON.parse(versionWrites[0]!.body ?? '{}')).toMatchObject({
      note: 'Sol-fa editor save',
    });
    expect(page.textContent).toContain(
      'A new immutable score version was saved'
    );

    await editFirstGridNote(page, 'm');
    await advanceAutosaveCadence();
    const autosaveWrites = api.requests.filter((request) =>
      request.url.endsWith('/autosaves')
    );
    expect(autosaveWrites).toHaveLength(1);
    const autosaveBody = JSON.parse(autosaveWrites[0]!.body ?? '{}') as {
      baseVersionId: string;
      requestId: string;
      model: ScoreModel;
    };
    expect(autosaveBody.baseVersionId).toBe('immutable-version-1');
    expect(autosaveBody.requestId).toMatch(/^[A-Za-z0-9._:-]+$/);
    expect(autosaveBody.model).not.toEqual(baseModel);
  });

  it('preserves a conflicting draft until explicit rebase, then saves against the latest currentVersionId', async () => {
    vi.useFakeTimers();
    const api = mockScoreApi({ conflictOnFirstAutosave: true });
    const page = await renderPage();
    await editFirstGridNote(page);
    await advanceAutosaveCadence();
    expect(page.textContent).toContain('Resolve score version conflict');
    expect(page.textContent).toContain('Your local draft is preserved');
    await clickButton(page, 'Text');
    const localDraftText = page.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Sol-fa text"]'
    )?.value;
    expect(localDraftText).not.toBe(modelToSolfaText(baseModel));
    expect(
      api.requests.filter((request) => request.url.endsWith('/autosaves'))
    ).toHaveLength(1);

    await clickButton(page, 'Rebase my preserved draft onto latest version');
    expect(
      api.requests.filter((request) => request.url.endsWith('/autosaves'))
    ).toHaveLength(1);
    expect(
      page.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Sol-fa text"]'
      )?.value
    ).toBe(localDraftText);
    await advanceAutosaveCadence();

    const autosaveBodies = api.requests
      .filter((request) => request.url.endsWith('/autosaves'))
      .map(
        (request) =>
          JSON.parse(request.body ?? '{}') as {
            baseVersionId: string;
            requestId: string;
          }
      );
    expect(autosaveBodies).toHaveLength(2);
    expect(autosaveBodies[0]?.baseVersionId).toBe('version-1');
    expect(autosaveBodies[1]?.baseVersionId).toBe('version-remote');
    expect(autosaveBodies[1]?.requestId).not.toBe(autosaveBodies[0]?.requestId);
  });

  it.each([
    [
      'in-flight',
      { holdFirstAutosaveUntilAbort: true },
      true,
      'Saving a working draft',
    ],
    [
      'retrying',
      { transientFailureOnFirstAutosave: true },
      false,
      'will retry',
    ],
  ] as const)(
    'invalidates a %s autosave when the user resets the draft',
    async (_phase, options, expectedAborted, statusText) => {
      vi.useFakeTimers();
      const api = mockScoreApi(options);
      const page = await renderPage();
      await editFirstGridNote(page);
      await advanceAutosaveCadence();
      expect(page.querySelector('.score-edit-status')?.textContent).toContain(
        statusText
      );
      expect(
        api.requests.filter((request) => request.url.endsWith('/autosaves'))
      ).toHaveLength(1);

      await clickButton(page, 'Reset draft');
      await settle();
      expect(api.autosaveSignals[0]?.aborted).toBe(expectedAborted);
      expect(page.textContent).toContain('Resolve score version conflict');
      await advanceAutosaveCadence();
      expect(
        api.requests.filter((request) => request.url.endsWith('/autosaves'))
      ).toHaveLength(1);

      await clickButton(page, 'Rebase my preserved draft onto latest version');
      await advanceAutosaveCadence();
      expect(
        api.requests.filter((request) => request.url.endsWith('/autosaves'))
      ).toHaveLength(1);
    }
  );

  it('disposes playback on score edits, reset/replacement, and route unmount', async () => {
    const dispose = vi.spyOn(LazyTonePlaybackEngine.prototype, 'dispose');
    mockScoreApi();
    const page = await renderPage({ navigation: true });
    const play = vi
      .spyOn(LazyTonePlaybackEngine.prototype, 'play')
      .mockResolvedValue(undefined);
    await clickButton(page, 'Play');
    await settle();
    expect(play).toHaveBeenCalledTimes(1);
    expect(
      page.querySelector('.playback-controls__status')?.textContent
    ).toContain('Playing');

    await editFirstGridNote(page);
    expect(dispose).toHaveBeenCalledTimes(1);

    await clickButton(page, 'Save immutable version');
    await settle();
    expect(page.textContent).toContain(
      'A new immutable score version was saved'
    );
    expect(dispose).toHaveBeenCalledTimes(2);

    await editFirstGridNote(page, 'm');
    expect(dispose).toHaveBeenCalledTimes(3);
    await clickButton(page, 'Reset draft');
    expect(dispose).toHaveBeenCalledTimes(4);

    await clickButton(page, 'Replace score route');
    await settle();
    expect(page.textContent).toContain('version-two');
    expect(dispose).toHaveBeenCalledTimes(5);

    await act(async () => root!.unmount());
    root = undefined;
    expect(dispose).toHaveBeenCalledTimes(6);
  });
});
