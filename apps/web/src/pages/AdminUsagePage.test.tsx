// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_RANGES } from '@choirscore/shared';
import { AdminUsagePage, UsageChart } from './AdminUsagePage';

vi.mock('../components/AppHeader', () => ({
  AppHeader: () => <header>Admin navigation</header>,
}));

function makeUsageResponse() {
  const daily = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 8, 11 + index))
      .toISOString()
      .slice(0, 10);
    return {
      date,
      requests: 0,
      succeededRequests: 0,
      failedRequests: 0,
      pendingRequests: 0,
      tokensIn: 0,
      tokensOut: 0,
      totalTokens: 0,
    };
  });
  return {
    asOf: '2026-10-10T23:59:59.999Z',
    windowStart: '2026-09-11T00:00:00.000Z',
    windowEndExclusive: '2026-10-11T00:00:00.000Z',
    days: 30 as const,
    users: [
      {
        userId: 'admin-1',
        username: 'admin',
        displayName: 'Choir Admin',
        requestsToday: 0,
        requestsInWindow: 0,
        succeededRequests: 0,
        failedRequests: 0,
        pendingRequests: 0,
        tokensIn: 0,
        tokensOut: 0,
        totalTokens: 0,
      },
    ],
    daily,
  };
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

async function flushReact() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('AdminUsagePage', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

  it('renders an accessible 30-day chart with a tabular alternative', () => {
    const markup = renderToStaticMarkup(
      <UsageChart daily={makeUsageResponse().daily} />
    );
    expect(markup).toContain('role="img"');
    expect(markup).toContain(
      'AI requests by outcome over the last 30 UTC days'
    );
    expect(markup).toContain('Daily AI usage for the last 30 UTC days');
    expect(markup).toContain('2026-10-10');
  });

  it('renders the empty state and requires confirmation before disabling AI', async () => {
    let aiGlobalEnabled = true;
    const patchValues: boolean[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/admin/usage')) {
          return new Response(JSON.stringify(makeUsageResponse()), {
            status: 200,
          });
        }
        if (url.endsWith('/admin/settings') && init?.method === 'PATCH') {
          aiGlobalEnabled = Boolean(
            (JSON.parse(String(init.body)) as { aiGlobalEnabled: boolean })
              .aiGlobalEnabled
          );
          patchValues.push(aiGlobalEnabled);
        }
        const settings = {
          requirePasswordChangeAtFirstLogin: true,
          voiceRanges: DEFAULT_VOICE_RANGES,
          aiGlobalEnabled,
          aiDefaultDailyLimit: 20,
        };
        return new Response(JSON.stringify(settings), { status: 200 });
      }
    );
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(<AdminUsagePage />));
    await flushReact();

    expect(container.textContent).toContain(
      'No accepted AI requests in the last 30 days'
    );
    expect(
      container.querySelector('[role="switch"]')?.getAttribute('aria-checked')
    ).toBe('true');

    await act(async () => click(container!.querySelector('[role="switch"]')!));
    expect(container.textContent).toContain('Disable AI for everyone?');
    expect(patchValues).toEqual([]);

    const cancel = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cancel'
    );
    await act(async () => click(cancel!));
    expect(container.textContent).not.toContain('Disable AI for everyone?');
    expect(patchValues).toEqual([]);

    await act(async () => click(container!.querySelector('[role="switch"]')!));
    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Disable AI globally'
    );
    await act(async () => click(confirm!));
    await flushReact();
    expect(patchValues).toEqual([false]);
    expect(
      container.querySelector('[role="switch"]')?.getAttribute('aria-checked')
    ).toBe('false');
    expect(container.textContent).toContain('AI has been disabled globally');

    await act(async () => click(container!.querySelector('[role="switch"]')!));
    await flushReact();
    expect(patchValues).toEqual([false, true]);
    expect(
      container.querySelector('[role="switch"]')?.getAttribute('aria-checked')
    ).toBe('true');
  });
});
