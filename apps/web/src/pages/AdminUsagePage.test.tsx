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
        daily: daily.map((day) => ({ date: day.date, requests: 0 })),
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

  it('renders a 30-day daily request breakdown for each user', async () => {
    const usage = makeUsageResponse();
    usage.users[0]!.daily[29]!.requests = 3;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/admin/usage')) {
        return new Response(JSON.stringify(usage), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          requirePasswordChangeAtFirstLogin: true,
          voiceRanges: DEFAULT_VOICE_RANGES,
          aiGlobalEnabled: true,
          aiDefaultDailyLimit: 20,
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(<AdminUsagePage />));
    await flushReact();

    const dailyTable = container.querySelector('.admin-usage-daily__table');
    expect(dailyTable?.querySelector('caption')?.textContent).toBe(
      'Daily AI requests for @admin'
    );
    const dailyRows = dailyTable?.querySelectorAll('tbody > tr');
    expect(dailyRows).toHaveLength(30);
    expect(dailyRows?.[0]?.querySelector('th')?.textContent).toBe('2026-09-11');
    expect(dailyRows?.[29]?.querySelector('th')?.textContent).toBe(
      '2026-10-10'
    );
    expect(dailyRows?.[29]?.querySelector('td')?.textContent).toBe('3');
  });

  it('renders the empty state, requires disable confirmation, and restores switch focus after cancel and save', async () => {
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
    expect(container.textContent).toContain(
      'Provider readiness: unavailable in this slice.'
    );
    expect(container.textContent).toContain(
      'Accepted jobs fail with a generic processing error and still consume the user’s daily quota.'
    );
    expect(container.textContent).toContain(
      'at most 2 queued + running jobs globally and 1 queued + running job per user'
    );
    expect(container.textContent).toContain(
      'This is separate from worker concurrency'
    );
    expect(container.textContent).not.toContain('AI is enabled');
    expect(
      container.querySelector('[role="switch"]')?.getAttribute('aria-checked')
    ).toBe('true');

    await act(async () => click(container!.querySelector('[role="switch"]')!));
    expect(container.textContent).toContain(
      'Block new AI submissions for everyone?'
    );
    expect(
      container
        .querySelector('#confirm-disable-actions')
        ?.getAttribute('aria-live')
    ).toBe('polite');
    expect(document.activeElement).toBe(
      container.querySelector('#confirm-disable-title')
    );
    expect(patchValues).toEqual([]);

    const cancel = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cancel'
    );
    await act(async () => click(cancel!));
    expect(container.textContent).not.toContain(
      'Block new AI submissions for everyone?'
    );
    expect(document.activeElement).toBe(
      container.querySelector('[role="switch"]')
    );
    expect(patchValues).toEqual([]);

    await act(async () => click(container!.querySelector('[role="switch"]')!));
    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) =>
        button.textContent?.trim() === 'Block new submissions globally'
    );
    await act(async () => click(confirm!));
    await flushReact();
    expect(patchValues).toEqual([false]);
    expect(document.activeElement).toBe(
      container.querySelector('[role="switch"]')
    );
    expect(
      container.querySelector('[role="switch"]')?.getAttribute('aria-checked')
    ).toBe('false');
    expect(container.textContent).toContain(
      'The global submission switch is off.'
    );

    await act(async () => click(container!.querySelector('[role="switch"]')!));
    await flushReact();
    expect(patchValues).toEqual([false, true]);
    expect(
      container.querySelector('[role="switch"]')?.getAttribute('aria-checked')
    ).toBe('true');
  });
});
