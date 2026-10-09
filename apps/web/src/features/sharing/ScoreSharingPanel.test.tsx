// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { scoreSummary } from '../../test/scoreFixtures';
import { ScoreSharingPanel } from './ScoreSharingPanel';

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeAll(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function renderPanel(
  score = { ...scoreSummary, visibility: 'shared' as const },
  onScoreUpdated = vi.fn()
) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <ScoreSharingPanel score={score} onScoreUpdated={onScoreUpdated} />
    );
  });
  return { page: host, onScoreUpdated };
}

async function clickButton(target: ParentNode, text: string) {
  const button = Array.from(target.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === text
  );
  expect(button, `Expected button “${text}”`).toBeTruthy();
  await act(async () => {
    button!.click();
    await Promise.resolve();
  });
}

async function waitForText(target: ParentNode, text: string) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (target.textContent?.includes(text)) return;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = undefined;
  }
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ScoreSharingPanel', () => {
  it('does not expose management controls when server permissions deny them', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { page } = await renderPanel({
      ...scoreSummary,
      visibility: 'shared',
      canManageAccess: false,
      canChangeVisibility: false,
    });

    expect(page.querySelector('.score-sharing-panel')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation before revoking all grants and explains preserved role access', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ scoreId: 'score-1', visibility: 'shared', users: [] })
      );
    vi.stubGlobal('fetch', fetchMock);
    const { page } = await renderPanel();

    expect(page.textContent).toContain(
      'Recipient listing and individual view/edit changes are not available here.'
    );
    await clickButton(page, 'Remove all shared access');
    expect(page.textContent).toContain(
      'Remove every explicit recipient grant?'
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await clickButton(page, 'Confirm remove all');
    await waitForText(page, 'All explicit shared grants were removed.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/scores/score-1/access');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ users: [] });
    expect(page.textContent).toContain(
      'owner, admin, and director access is unchanged'
    );
  });

  it('confirms leaving shared, then reflects only the server-returned visibility', async () => {
    const updatedScore = { ...scoreSummary, visibility: 'private' as const };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ score: updatedScore }));
    vi.stubGlobal('fetch', fetchMock);
    const onScoreUpdated = vi.fn();
    const { page } = await renderPanel(
      { ...scoreSummary, visibility: 'shared' },
      onScoreUpdated
    );
    const select = page.querySelector<HTMLSelectElement>(
      '#score-sharing-visibility'
    );
    expect(select).toBeTruthy();
    await act(async () => {
      select!.value = 'private';
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await clickButton(page, 'Save visibility');
    expect(page.textContent).toContain('Confirm visibility change');
    expect(fetchMock).not.toHaveBeenCalled();
    await clickButton(page, 'Confirm visibility change');
    await waitForText(page, 'Visibility updated.');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/scores/score-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ visibility: 'private' });
    expect(onScoreUpdated).toHaveBeenCalledWith(updatedScore);
    expect(page.textContent).toContain(
      'All explicit shared grants were removed'
    );
  });

  it('shows denied revocation as an error without reporting success or changing the score', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: { code: 'FORBIDDEN', message: 'You may not manage access.' },
        },
        403
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const onScoreUpdated = vi.fn();
    const { page } = await renderPanel(
      { ...scoreSummary, visibility: 'shared' },
      onScoreUpdated
    );

    await clickButton(page, 'Remove all shared access');
    await clickButton(page, 'Confirm remove all');
    await waitForText(page, 'You may not manage access.');
    expect(page.querySelector('[role="status"]')).toBeNull();
    expect(onScoreUpdated).not.toHaveBeenCalled();
  });
});
